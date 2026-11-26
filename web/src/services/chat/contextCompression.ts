import { streamMessage } from '../api/client.js'
import type { ChatModel, MessageParam, MessageStreamEvent } from '../api/types.js'
import { getCustomConfig } from '../custom/bridge.js'
import { streamCustom } from '../custom/stream.js'
import { streamWorkBuddy } from '../workbuddy/stream.js'
import { useSettings } from '../settings.js'
import { getVisibleMessages } from './branches.js'
import {
  estimateTokens,
  readContextMemory,
  writeContextMemory,
  type ContextMemory,
} from './contextMemory.js'
import { getContextRounds } from './reply.js'
import { useChatStore } from './store.js'
import type { AssistantMessage, UserMessage } from './types.js'

/**
 * 上下文爆满后的「压缩并继续」。
 *
 * 触发条件只有一个：服务端已经返回"上下文超限"错误，用户在提示上点了压缩。
 * 平时聊天不会走到这里，也不会多任何一次模型调用。
 *
 * 压缩策略（滚动摘要）：
 * - 把最早的若干轮对话（保留最近 KEEP_RECENT_ROUNDS 轮原文不动）交给当前通道做中文要点摘要；
 * - 摘要结果存到本地（contextMemory），下次发请求时用「摘要 + 未覆盖历史」替代旧历史；
 * - 单次摘要请求最多覆盖 CHUNK_TOKEN_BUDGET 个 token，超长对话会分多段滚动压缩，避免自己撞单次输入上限。
 */

const SUMMARIZE_MODEL: ChatModel = 'deepseek-flash'
/** 每段摘要请求最多覆盖的估算 token（官方通道单次输入 32768，留足余量） */
const CHUNK_TOKEN_BUDGET = 14000
/** 一次点击最多压缩多少段，避免长对话压缩时间过久 */
const MAX_CHUNKS = 10
/** 最近保留的原文轮次（压缩后仍原样发送） */
const KEEP_RECENT_ROUNDS = 6
/** 压缩目标：压到上限的 55%，给后续对话留出增长空间 */
const TARGET_RATIO = 0.55
/** 未知上限时的保守默认值（DeepSeek 官方 128K） */
const DEFAULT_LIMIT_TOKENS = 131072
/** 摘要硬上限（字符），防止模型超写 */
const SUMMARY_MAX_CHARS = 4000
/** 单条消息进入摘要文本时的截断长度（字符） */
const MESSAGE_CLIP_CHARS = 4500

const COMPRESS_SYSTEM =
  'You are a context-compression assistant. Summarize the provided conversation faithfully and compactly, keeping all facts, numbers, names, decisions, agreements, pending tasks, user preferences and open questions. Never invent information.'

const buildInstruction = (existingSummary: string, transcript: string) => {
  const parts: string[] = []
  parts.push(
    '你是对话压缩助手。请把下面的对话内容压缩成一份中文要点摘要，供后续对话继续使用。',
    '要求：',
    '1. 保留事实、数字、日期、名称、结论、决定、约定、待办事项、用户偏好和未解决的问题；',
    '2. 保留关键的上下文指代关系（谁说了什么、在讨论什么任务）；',
    '3. 删除寒暄、重复、语气词、思考过程和无关细节；',
    '4. 不要编造对话中没有的信息；',
    '5. 用紧凑的要点列表输出，不超过 1200 字。'
  )
  if (existingSummary) {
    parts.push('', '【已有摘要】', existingSummary)
  }
  parts.push('', '【对话内容】', transcript)
  parts.push('', '请直接输出更新后的完整摘要（包含已有摘要的要点和新对话的要点），不要额外解释。')
  return parts.join('\n')
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text

const roundText = (round: [UserMessage, AssistantMessage]): string => {
  const [user, reply] = round
  const question = clip((user.content ?? '').trim(), MESSAGE_CLIP_CHARS)
  const answer = clip(
    reply.blocks
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
      .trim(),
    MESSAGE_CLIP_CHARS
  )
  if (!question && !answer) {
    return ''
  }
  return `【用户】${question || '(无文字内容)'}\n【助手】${answer || '(无文字内容)'}`
}

const roundsTokens = (rounds: [UserMessage, AssistantMessage][]): number =>
  rounds.reduce((sum, round) => sum + estimateTokens(roundText(round)) + 8, 0)

/** 按 token 预算把待压缩轮次分组；单轮超预算时单独成一组 */
const chunkRounds = (
  rounds: [UserMessage, AssistantMessage][]
): [UserMessage, AssistantMessage][][] => {
  const chunks: [UserMessage, AssistantMessage][][] = []
  let current: [UserMessage, AssistantMessage][] = []
  let currentTokens = 0
  for (const round of rounds) {
    const tokens = estimateTokens(roundText(round)) + 8
    if (current.length > 0 && currentTokens + tokens > CHUNK_TOKEN_BUDGET) {
      chunks.push(current)
      current = []
      currentTokens = 0
    }
    current.push(round)
    currentTokens += tokens
  }
  if (current.length > 0) {
    chunks.push(current)
  }
  return chunks
}

/** 调用当前通道做一次"非流式"收集（内部用流式接口收集正文） */
const summarizeOnce = async (prompt: string): Promise<string> => {
  const settings = useSettings.getState()
  const provider = settings.provider
  const messages: MessageParam[] = [{ role: 'user', content: prompt }]
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)
  const signal = controller.signal
  try {
    let events: AsyncGenerator<MessageStreamEvent>
    if (provider === 'deepseek' || settings.search === true) {
      if (!settings.apiKey) {
        throw new Error('需要先在设置里填写 DeepSeek API Key')
      }
      events = streamMessage(
        settings.apiKey,
        {
          model: SUMMARIZE_MODEL,
          system: COMPRESS_SYSTEM,
          messages,
          thinking: { type: 'disabled' },
          tools: [],
        },
        signal
      )
    } else if (provider === 'workbuddy') {
      events = streamWorkBuddy(
        {
          model: settings.workbuddyModel,
          system: COMPRESS_SYSTEM,
          messages,
          thinking: false,
        },
        signal
      )
    } else {
      const custom = getCustomConfig()
      if (!custom?.baseUrl || !custom.model) {
        throw new Error('请先在设置里配置自定义 API（Base URL 和模型）')
      }
      events = streamCustom(
        {
          model: custom.model,
          system: COMPRESS_SYSTEM,
          messages,
          thinking: false,
        },
        signal
      )
    }
    let text = ''
    for await (const event of events) {
      if (event.type === 'content_block_start' && event.content_block.type === 'text') {
        text += event.content_block.text ?? ''
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text
      }
    }
    const summary = text.trim()
    if (!summary) {
      throw new Error('摘要结果为空，请重试')
    }
    return clip(summary, SUMMARY_MAX_CHARS)
  } catch (error) {
    if (signal.aborted) {
      throw new Error('压缩超时，请稍后重试')
    }
    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    clearTimeout(timer)
  }
}

export type CompressResult = {
  /** 本次新压缩掉的轮次数 */
  coveredRounds: number
  /** 压缩后累计覆盖的轮次数 */
  totalCoveredRounds: number
  /** 摘要估算 token 数 */
  summaryTokens: number
}

/**
 * 压缩指定会话的早期上下文（滚动摘要）。只应在"上下文已满"错误后由用户点击触发。
 * @param sessionId 会话 id
 * @param limitTokens 服务端返回的上下文上限（从错误文案里解析；未知时用 128K 保守值）
 */
export const compressSessionContext = async (
  sessionId: string,
  limitTokens?: number | null,
  /** 本轮提问自身的估算 token（压缩目标要从总预算里扣掉它，否则压完仍会超限） */
  questionTokens = 0
): Promise<CompressResult> => {
  const state = useChatStore.getState()
  const session = state.sessionCache[sessionId]
  if (!session) {
    throw new Error('会话还没加载完成，请稍后重试')
  }
  const path = getVisibleMessages(session)
  const rounds = getContextRounds(path)
  const anchorId = rounds[0]?.[0]?.id
  const existingMemory = readContextMemory(sessionId)
  // 摘要必须仍然对得上当前分支：锚点不符（切分支/导入替换）或覆盖轮数超界时丢弃旧摘要，重新压。
  const existing =
    existingMemory &&
    (!existingMemory.anchorId || !anchorId || existingMemory.anchorId === anchorId) &&
    existingMemory.coveredRounds <= rounds.length
      ? existingMemory
      : null
  const start = existing ? Math.min(existing.coveredRounds, rounds.length) : 0
  if (rounds.length - start <= KEEP_RECENT_ROUNDS) {
    throw new Error('可压缩的早期对话太少，压缩也未必能继续，建议新开对话')
  }
  const keepFrom = rounds.length - KEEP_RECENT_ROUNDS
  const available = rounds.slice(start, keepFrom)
  const limit =
    limitTokens && limitTokens > 8000 ? limitTokens : DEFAULT_LIMIT_TOKENS
  const target = Math.floor(limit * TARGET_RATIO)
  const questionBudget = Math.max(0, questionTokens)
  if (questionBudget > limit * 0.45) {
    // 本轮提问自己就占掉快一半上限：再怎么压历史也装不下，直接给可行动作，别白花摘要调用。
    throw new Error('当前这条内容本身就太大，压缩历史也装不下；请用「截断后发送」或新开对话')
  }
  const chunks = chunkRounds(available)
  if (chunks.length === 0) {
    throw new Error('没有可压缩的内容')
  }

  let summary = existing?.summary ?? ''
  let covered = start
  let remaining = estimateTokens(summary) + roundsTokens(rounds.slice(start)) + questionBudget
  let chunkCount = 0
  for (const chunk of chunks) {
    if (chunkCount >= MAX_CHUNKS) {
      break
    }
    // 第一次必须压；之后压到目标以下就停
    if (chunkCount > 0 && remaining <= target) {
      break
    }
    const transcript = chunk.map(roundText).filter(Boolean).join('\n\n')
    if (!transcript) {
      covered += chunk.length
      continue
    }
    summary = await summarizeOnce(buildInstruction(summary, transcript))
    covered += chunk.length
    chunkCount += 1
    remaining = estimateTokens(summary) + roundsTokens(rounds.slice(covered)) + questionBudget
  }

  if (covered === start) {
    throw new Error('没有可压缩的内容')
  }
  const memory: ContextMemory = {
    summary,
    coveredRounds: covered,
    ...(anchorId ? { anchorId } : {}),
    updatedAt: Date.now(),
  }
  if (!writeContextMemory(sessionId, memory)) {
    throw new Error('压缩结果没能保存（存储空间可能不足），请清理空间后重试')
  }
  // 压完仍超限（历史远超上限）：先把进度存下来，让用户再点一次接着压；不要谎报成功、不要重发。
  if (remaining > limit * 0.95) {
    throw new Error(
      `已压缩前 ${covered} 轮，但仍约 ${Math.max(1, Math.round(remaining / 1000))}k tokens，还超上限；请再点一次「压缩上下文并继续」继续压缩`
    )
  }
  return {
    coveredRounds: covered - start,
    totalCoveredRounds: covered,
    summaryTokens: estimateTokens(summary),
  }
}

/** 供将来调试/测试用：估算某个会话当前请求的大致 token 数（不含本轮提问） */
export const estimateSessionTokens = (sessionId: string): number | null => {
  const session = useChatStore.getState().sessionCache[sessionId]
  if (!session) {
    return null
  }
  const memory = readContextMemory(sessionId)
  const rounds = getContextRounds(getVisibleMessages(session))
  const start = memory ? Math.min(memory.coveredRounds, rounds.length) : 0
  return estimateTokens(memory?.summary ?? '') + roundsTokens(rounds.slice(start))
}
