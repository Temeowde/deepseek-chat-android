import { streamMessage } from '../api/client.js'
import type { ChatModel, MessageParam, MessageStreamEvent } from '../api/types.js'
import { getCustomConfig } from '../custom/bridge.js'
import { streamCustom } from '../custom/stream.js'
import { streamWorkBuddy } from '../workbuddy/stream.js'
import { useSettings } from '../settings.js'
import { getVisibleMessages } from './branches.js'
import {
  estimateTokens,
  memorySummaryTokens,
  readContextMemory,
  writeContextMemory,
  type ContextMemory,
  type ContextSegment,
} from './contextMemory.js'
import { getContextRounds } from './reply.js'
import { useChatStore } from './store.js'
import type { AssistantMessage, UserMessage } from './types.js'

/**
 * 长对话上下文压缩（滚动分段摘要）。
 *
 * 两种触发：
 *   1. 手动：服务端返回「上下文超限」后，用户点「压缩上下文并继续」；
 *   2. 自动省钱：每轮结束后，如果本轮实际 prompt 很大（> AUTO_PROMPT_TOKENS），
 *      在后台把较早的对话压成摘要，下一轮起请求就小很多。正常短对话完全不触发。
 *
 * 质量控制（避免「压得越多越差」）：
 *   - 每段摘要只根据「原始消息」生成一次，生成后不再改写；
 *   - 请求里放的是多段独立摘要，绝不对摘要再摘要（压缩深度恒为 1）；
 *   - 段数超上限时，合并最早两段也必须回到原始消息重新生成；
 *   - 最近 KEEP_RECENT 轮原文永远保留。
 */

const SUMMARIZE_MODEL: ChatModel = 'deepseek-flash'
/** 每段摘要请求最多覆盖的估算 token（官方通道单次输入 32768，留足余量） */
const CHUNK_TOKEN_BUDGET = 14000
/** 一次点击最多调用多少次摘要（超过就把进度存下来，让用户再点一次继续） */
const MAX_CHUNKS_PER_CLICK = 24
/** 手动压缩：最近保留的原文轮次（压缩后仍原样发送） */
const KEEP_RECENT_ROUNDS = 8
/** 实在装不下时，最多把保留的原文轮次一路压到 2 轮 */
const KEEP_MIN_RECENT_ROUNDS = 2
/** 压缩目标：压到上限的 45%，给估算误差和后续对话都留出余量 */
const TARGET_RATIO = 0.45
/** 未知上限时的保守默认值（DeepSeek 官方 1M，但旧模型可能更小） */
const DEFAULT_LIMIT_TOKENS = 131072
/** 每段摘要的硬上限（字符），防止模型超写 */
const SEGMENT_MAX_CHARS = 1200
/** 单条消息进入摘要文本时的截断长度（字符） */
const MESSAGE_CLIP_CHARS = 4500
/** 段数上限：超过后合并最早两段（重新从原文生成） */
const MAX_SEGMENTS = 12

const COMPRESS_SYSTEM =
  'You are a context-compression assistant. Summarize the provided conversation faithfully and compactly. Keep all identifiers, codes, passwords, IDs, numbers, dates, names, decisions, agreements, pending tasks, user preferences and open questions verbatim. Never invent information.'

const buildInstruction = (transcript: string): string =>
  [
    '你是对话压缩助手。下面是一段较早的对话原文，请把它压缩成一份中文摘要，供后续对话继续使用。',
    '要求：',
    '1. 【必须原样保留】所有编号、暗号、代码、密码、ID、账号、链接、日期、金额、数字和名称；',
    '   例如原文出现 NO.0007-紫藤，摘要里必须一字不差写出 NO.0007-紫藤，',
    '   不能省略编号、不能改写成“紫藤色暗号”、不能概括成“某个暗号”。',
    '2. 先输出【关键事实】清单：把原文里的编号/暗号/数字/名称逐条列出，每条一行；',
    '3. 再输出【其他要点】：事实、结论、决定、约定、待办事项、用户偏好和未解决的问题；',
    '4. 保留关键的上下文指代关系（谁说了什么、在讨论什么任务、称呼/设定关系）；',
    '5. 删除寒暄、重复、语气词、思考过程和无关细节；',
    '6. 不要编造对话中没有的信息；',
    '7. 【关键事实】逐条保留、不受字数限制，【其他要点】用紧凑列表。',
    '',
    '【对话原文】',
    transcript,
    '',
    '请直接输出摘要，不要额外解释。',
  ].join('\n')

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

/** 调用当前通道做一次「非流式」收集（内部用流式接口收集正文） */
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
    return clip(summary, SEGMENT_MAX_CHARS)
  } catch (error) {
    if (signal.aborted) {
      throw new Error('压缩超时，请稍后重试')
    }
    throw error instanceof Error ? error : new Error(String(error))
  } finally {
    clearTimeout(timer)
  }
}

/** 摘要调用遇到限流/临时 5xx 时自动重试，减少长压缩中途断掉 */
const summarizeWithRetry = async (prompt: string): Promise<string> => {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await summarizeOnce(prompt)
    } catch (error) {
      lastError = error
      const status = (error as { status?: number }).status
      const retryable = status === 429 || (typeof status === 'number' && status >= 500)
      if (!retryable || attempt === 2) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
export type CompressResult = {
  /** 本次新压缩掉的轮次数 */
  coveredRounds: number
  /** 压缩后累计覆盖的轮次数 */
  totalCoveredRounds: number
  /** 多段摘要合计估算 token 数 */
  summaryTokens: number
}

const anchorOf = (rounds: [UserMessage, AssistantMessage][]): string | undefined =>
  rounds[0]?.[0]?.id

/** 旧摘要在切分支/导入/历史变短后必须失效，不能 clamp 后把全部历史顶掉 */
const validMemory = (
  rounds: [UserMessage, AssistantMessage][],
  memory: ContextMemory | null
): ContextMemory | null => {
  const anchor = anchorOf(rounds)
  if (!memory || memory.segments.length === 0 || memory.coveredRounds <= 0) {
    return null
  }
  if (memory.coveredRounds > rounds.length) {
    return null
  }
  if (
    !memory.segments.every(
      (segment) => segment.to <= rounds.length && segment.from >= 0 && segment.from < segment.to
    )
  ) {
    return null
  }
  if (memory.anchorId && anchor && memory.anchorId !== anchor) {
    return null
  }
  return memory
}

const coveredOf = (segments: ContextSegment[]): number =>
  segments.reduce((max, segment) => Math.max(max, segment.to), 0)

const saveMemory = (
  sessionId: string,
  rounds: [UserMessage, AssistantMessage][],
  segments: ContextSegment[]
): ContextMemory | null => {
  if (segments.length === 0) {
    return null
  }
  const memory: ContextMemory = {
    segments,
    coveredRounds: coveredOf(segments),
    ...(anchorOf(rounds) ? { anchorId: anchorOf(rounds) } : {}),
    updatedAt: Date.now(),
  }
  return writeContextMemory(sessionId, memory) ? memory : null
}

/**
 * 段数过多时合并最早两段：**回到这两段的原始消息**重新生成摘要，
 * 而不是把两份摘要合并（保证永远不会出现「摘要的摘要」）。
 */
const mergeOldestSegments = async (
  sessionId: string,
  rounds: [UserMessage, AssistantMessage][],
  segments: ContextSegment[]
): Promise<ContextSegment[]> => {
  let list = segments
  while (list.length > MAX_SEGMENTS) {
    const [first, second] = list
    if (
      !first ||
      !second ||
      first.to > rounds.length ||
      second.to > rounds.length ||
      second.from < first.from
    ) {
      break
    }
    const transcript = rounds
      .slice(first.from, second.to)
      .map(roundText)
      .filter(Boolean)
      .join('\n\n')
    if (!transcript) {
      break
    }
    const summary = await summarizeWithRetry(buildInstruction(transcript))
    list = [
      { summary, from: first.from, to: second.to },
      ...list.slice(2),
    ]
    saveMemory(sessionId, rounds, list)
  }
  return list
}

/**
 * 一次点击压到上限以内但还没压完时抛出。
 *
 * 这不是「失败」：进度已经存盘，再点一次会从上次的位置继续。
 * UI 不应该给它加「压缩失败：」前缀。
 */
export class CompressProgressError extends Error {
  readonly coveredRounds: number
  readonly totalCoveredRounds: number
  readonly remainingTokens: number

  constructor(coveredRounds: number, totalCoveredRounds: number, remainingTokens: number) {
    super(
      `已压缩前 ${totalCoveredRounds} 轮，还差约 ${Math.max(1, Math.round(remainingTokens / 1000))}k tokens；请再点一次「压缩上下文并继续」继续压缩`
    )
    this.name = 'CompressProgressError'
    this.coveredRounds = coveredRounds
    this.totalCoveredRounds = totalCoveredRounds
    this.remainingTokens = remainingTokens
  }
}

/**
 * 压缩指定会话的早期上下文（手动：上下文已满后由用户点击触发）。
 *
 * 策略：
 *   1. 先压最老的轮次（保留最近 6 轮原文）；
 *   2. 如果最近 6 轮本身就让请求超上限，再把保留轮次从 6 逐级降到 2（实在装不下才牺牲最近原文）；
 *   3. 一次点击最多 24 次摘要调用；没压完就存进度并抛 CompressProgressError，再点一次继续；
 *   4. 连「只保留最近 2 轮」都还超上限，说明是最近内容本身太大，给出可行动作而不是无意义的失败。
 *
 * @param sessionId 会话 id
 * @param limitTokens 服务端返回的上下文上限（从错误文案里解析；未知时用保守值）
 * @param questionTokens 本轮提问自身的估算 token（压缩目标要从总预算里扣掉它）
 */
export const compressSessionContext = async (
  sessionId: string,
  limitTokens?: number | null,
  questionTokens = 0
): Promise<CompressResult> => {
  const state = useChatStore.getState()
  const session = state.sessionCache[sessionId]
  if (!session) {
    throw new Error('会话还没加载完成，请稍后重试')
  }
  const path = getVisibleMessages(session)
  const rounds = getContextRounds(path)
  const existing = validMemory(rounds, readContextMemory(sessionId))
  let segments = existing?.segments ?? []
  const start = coveredOf(segments)
  if (rounds.length - start <= KEEP_MIN_RECENT_ROUNDS) {
    throw new Error('可压缩的早期对话太少，压缩也未必能继续，建议新开对话')
  }
  const limit = limitTokens && limitTokens > 8000 ? limitTokens : DEFAULT_LIMIT_TOKENS
  const target = Math.floor(limit * TARGET_RATIO)
  const questionBudget = Math.max(0, questionTokens)
  if (questionBudget > limit * 0.45) {
    // 本轮提问自己就占掉快一半上限：再怎么压历史也装不下，别白花摘要调用。
    throw new Error('当前这条内容本身就太大，压缩历史也装不下；请用「截断后发送」或新开对话')
  }

  let covered = start
  let chunkCount = 0
  let keepRecent = KEEP_RECENT_ROUNDS
  const remaining = () =>
    memorySummaryTokens({ segments, coveredRounds: covered, updatedAt: 0 }) +
    roundsTokens(rounds.slice(covered)) +
    questionBudget
  const persist = () => {
    if (!saveMemory(sessionId, rounds, segments)) {
      throw new Error('压缩结果没能保存（存储空间可能不足），请清理空间后重试')
    }
  }

  /** 压掉 covered..rounds.length-keep 之间的轮次；返回是否因为代价上限停下 */
  const compressAvailable = async (keep: number): Promise<boolean> => {
    const keepFrom = rounds.length - keep
    const available = rounds.slice(covered, keepFrom)
    for (const chunk of chunkRounds(available)) {
      if (chunkCount >= MAX_CHUNKS_PER_CLICK) {
        return true
      }
      // 第一次必须压；之后压到目标以下就停
      if (chunkCount > 0 && remaining() <= target) {
        return false
      }
      const transcript = chunk.map(roundText).filter(Boolean).join('\n\n')
      if (!transcript) {
        covered += chunk.length
        continue
      }
      let summary: string
      try {
        summary = await summarizeWithRetry(buildInstruction(transcript))
      } catch (error) {
        if (covered > start) {
          persist()
          const reason = error instanceof Error ? error.message : String(error)
          throw new Error(`${reason}（已保存前 ${covered} 轮进度，可再点一次继续）`)
        }
        throw error
      }
      segments = [...segments, { summary, from: covered, to: covered + chunk.length }]
      covered += chunk.length
      chunkCount += 1
      // 每压完一段就落盘：长对话中途失败也不会白花前面几段的钱
      persist()
    }
    return false
  }

  let hitCostCap = false
  while (true) {
    hitCostCap = await compressAvailable(keepRecent)
    const left = remaining()
    if (left <= limit * 0.95) {
      break
    }
    if (hitCostCap) {
      break
    }
    if (covered >= rounds.length - keepRecent && keepRecent > KEEP_MIN_RECENT_ROUNDS) {
      // 历史已经压完还超限：把保留的原文轮次再降一档，继续压
      keepRecent = Math.max(KEEP_MIN_RECENT_ROUNDS, keepRecent - 2)
      continue
    }
    break
  }

  if (covered === start) {
    throw new Error('没有可压缩的内容')
  }
  segments = await mergeOldestSegments(sessionId, rounds, segments)
  persist()

  if (remaining() > limit * 0.95) {
    if (hitCostCap) {
      // 进度已存，再点一次从当前位置继续；不是失败。
      throw new CompressProgressError(covered - start, covered, remaining())
    }
    // 连最近 2 轮都装不下：压缩历史确实帮不上忙，直接给可行动作。
    const recentTokens = roundsTokens(rounds.slice(covered)) + questionBudget
    throw new Error(
      `最近 ${rounds.length - covered} 轮对话本身就有约 ${Math.max(1, Math.round(recentTokens / 1000))}k tokens，已超过上限；压缩更早的历史帮不上忙，请截断最近这条内容后发送，或新开对话`
    )
  }
  return {
    coveredRounds: covered - start,
    totalCoveredRounds: covered,
    summaryTokens: memorySummaryTokens({ segments, coveredRounds: covered, updatedAt: 0 }),
  }
}

/** 供调试/测试用：估算某个会话当前请求的大致 token 数（不含本轮提问） */
export const estimateSessionTokens = (sessionId: string): number | null => {
  const session = useChatStore.getState().sessionCache[sessionId]
  if (!session) {
    return null
  }
  const memory = validMemory(
    getContextRounds(getVisibleMessages(session)),
    readContextMemory(sessionId)
  )
  const rounds = getContextRounds(getVisibleMessages(session))
  const start = memory ? Math.min(memory.coveredRounds, rounds.length) : 0
  return (
    (memory ? memorySummaryTokens(memory) : 0) + roundsTokens(rounds.slice(start))
  )
}
