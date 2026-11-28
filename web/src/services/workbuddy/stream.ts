/**
 * 把应用内部的 Anthropic Messages 请求翻译成 WorkBuddy 的 OpenAI 风格请求，
 * 再把 OpenAI SSE 增量翻译回应用认识的事件序列。
 *
 * 支持纯文本 + 内联图片（image_url/base64）；服务端工具、文档附件仍不在本通道实现。
 */

import { ApiError } from '../api/client.js'
import type {
  ContentBlockDelta,
  CreateMessageRequest,
  MessageParam,
  MessageStreamEvent,
  MessageUsage,
  OutputBlockStart,
  StopReason,
} from '../api/types.js'
import { openWorkBuddyStream, workbuddyAvailable } from './bridge.js'

export type WorkBuddyRequest = {
  model: string
  system: string
  messages: MessageParam[]
  thinking: boolean
  /** 新会话首轮自动标题；不需要时省略 */
  title?: string
}

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | OpenAIContentPart[]
}

const ZERO_USAGE: MessageUsage = {
  input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  output_tokens: 0,
}

/** WorkBuddy/OpenAI 的 assistant 历史只放正文；思考、工具块不回传。 */
const assistantText = (content: Extract<MessageParam, { role: 'assistant' }>['content']): string =>
  content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')

/**
 * 把一条用户消息转成 OpenAI 内容：纯文本走字符串，带图片时用 parts 数组。
 * 图片以 base64 data URL 内联（WorkBuddy 网关实测接受这个格式）；
 * 文档没有对应表示，直接报错而不是发一个无效引用。
 */
/**
 * 把一条用户消息转成 OpenAI 内容：纯文本走字符串，带图片时用 parts 数组。
 * 图片以 base64 data URL 内联；文档附件和「只有服务端 file_id 的历史附件」
 * 在这一通道没有对应表示，以前是直接抛错，结果整个历史会话都发不出去，
 * 现在改成：能内联的文本附件拼进正文，发不了的附件用一行文字说明后跳过。
 */
const userContent = (
  content: Extract<MessageParam, { role: 'user' }>['content']
): string | OpenAIContentPart[] => {
  if (typeof content === 'string') {
    return content
  }
  const parts: OpenAIContentPart[] = []
  const texts: string[] = []
  let hasImage = false
  let skipped = 0
  for (const block of content) {
    if (block.type === 'text') {
      texts.push(block.text)
      continue
    }
    if (block.type === 'image' && block.source.type === 'base64') {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
      })
      hasImage = true
      continue
    }
    if (block.type === 'document' && block.source.type === 'text') {
      // 文本附件（PDF/Word/PPT 本地解析出来的正文）直接并入正文，OpenAI 格式能收
      texts.push(block.source.data)
      continue
    }
    // 其余（只有 file_id 的历史图片/文档、官方通道专用块）这一通道发不了，跳过并说明
    skipped += 1
  }
  if (skipped > 0) {
    texts.push(`[这条历史消息里有 ${skipped} 个附件在当前通道发不出去，已跳过]`)
  }
  if (!hasImage) {
    return texts.join('\n')
  }
  // 图片在前、文字在后，和官方客户端的顺序一致
  const merged = [...parts, ...(texts.join('\n').trim() ? [{ type: 'text' as const, text: texts.join('\n') }] : [])]
  return merged
}
const toOpenAIMessages = (request: WorkBuddyRequest): OpenAIMessage[] => {
  const messages: OpenAIMessage[] = []
  if (request.system.trim()) {
    messages.push({ role: 'system', content: request.system })
  }
  for (const message of request.messages) {
    if (message.role === 'latest_reminder') {
      // DeepSeek 专用的位置/时间快照，WorkBuddy 不需要；丢弃比塞进用户正文更干净。
      continue
    }
    if (message.role === 'user') {
      const content = userContent(message.content)
      const empty =
        typeof content === 'string' ? !content.trim() : content.length === 0
      if (!empty) {
        messages.push({ role: 'user', content })
      }
      continue
    }
    const text = assistantText(message.content)
    if (text.trim()) {
      messages.push({ role: 'assistant', content: text })
    }
  }
  if (!messages.some((message) => message.role === 'user')) {
    throw new ApiError('protocol', 'WorkBuddy 请求里没有用户消息')
  }
  return messages
}

export const openAIBody = (request: WorkBuddyRequest) => ({
  model: request.model,
  messages: toOpenAIMessages(request),
  stream: true,
})

const stopReasonOf = (finishReason: string): StopReason => {
  if (finishReason === 'length') {
    return 'max_tokens'
  }
  if (finishReason === 'tool_calls' || finishReason === 'function_call') {
    return 'tool_use'
  }
  return 'end_turn'
}

const usageOf = (usage: unknown): MessageUsage => {
  if (!usage || typeof usage !== 'object') {
    return ZERO_USAGE
  }
  const record = usage as {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
  const cached = Number(record.prompt_tokens_details?.cached_tokens ?? 0)
  const prompt = Number(record.prompt_tokens ?? 0)
  return {
    input_tokens: Math.max(0, prompt - cached),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: Math.max(0, cached),
    output_tokens: Number(record.completion_tokens ?? 0),
  }
}

type OpenAIChunk = {
  id?: string
  model?: string
  error?: { message?: string; type?: string }
  choices?: Array<{
    delta?: {
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
      thinking?: string | null
      tool_calls?: unknown
    }
    finish_reason?: string | null
  }>
  usage?: unknown
}

/**
 * 一个有状态的翻译器：上游每个 chunk 进来，吐出 0..n 个应用事件；
 * 结束时补齐 content_block_stop / message_delta / message_stop。
 */
export class StreamTranslator {
  private started = false
  private nextIndex = 0
  private thinkingIndex = -1
  private textIndex = -1
  private id = ''
  private usage: MessageUsage = ZERO_USAGE
  private finishReason = ''

  constructor(
    private readonly model: string,
    private readonly thinkingEnabled: boolean,
    private readonly title?: string
  ) {}

  private start(): MessageStreamEvent[] {
    if (this.started) {
      return []
    }
    this.started = true
    return [
      {
        type: 'message_start',
        message: {
          id: this.id || `wb_${Date.now().toString(36)}`,
          model: this.model,
          usage: ZERO_USAGE,
        },
      },
    ]
  }

  private openThinking(): MessageStreamEvent[] {
    if (this.thinkingIndex >= 0) {
      return []
    }
    this.thinkingIndex = this.nextIndex++
    return [
      {
        type: 'content_block_start',
        index: this.thinkingIndex,
        content_block: { type: 'thinking', thinking: '', signature: '' } as OutputBlockStart,
      },
    ]
  }

  private openText(): MessageStreamEvent[] {
    if (this.textIndex >= 0) {
      return []
    }
    const events: MessageStreamEvent[] = []
    if (this.thinkingIndex >= 0) {
      events.push({ type: 'content_block_stop', index: this.thinkingIndex })
      this.thinkingIndex = -1
    }
    this.textIndex = this.nextIndex++
    events.push({
      type: 'content_block_start',
      index: this.textIndex,
      content_block: { type: 'text', text: '' } as OutputBlockStart,
    })
    return events
  }

  push(chunk: OpenAIChunk): MessageStreamEvent[] {
    const events = this.start()
    if (!this.id && typeof chunk.id === 'string' && chunk.id) {
      this.id = chunk.id
    }
    if (chunk.usage !== undefined) {
      this.usage = usageOf(chunk.usage)
    }
    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined
    const delta = choice?.delta ?? {}
    /*
     * 各家 OpenAI 兼容接口的思考字段名不统一：
     * - DeepSeek / 通义 / 硅基流动：reasoning_content
     * - OpenRouter 及部分网关：reasoning
     * - 少数实现：thinking
     * 以前只认 reasoning_content，别的厂商的思考过程就被整段丢掉了。
     */
    const reasoning =
      typeof delta.reasoning_content === 'string' && delta.reasoning_content
        ? delta.reasoning_content
        : typeof delta.reasoning === 'string' && delta.reasoning
          ? delta.reasoning
          : typeof delta.thinking === 'string'
            ? delta.thinking
            : ''
    const content = typeof delta.content === 'string' ? delta.content : ''

    if (this.thinkingEnabled && reasoning) {
      events.push(...this.openThinking())
      const thinkingDelta: ContentBlockDelta = { type: 'thinking_delta', thinking: reasoning }
      events.push({
        type: 'content_block_delta',
        index: this.thinkingIndex,
        delta: thinkingDelta,
      })
    }
    if (content) {
      events.push(...this.openText())
      const textDelta: ContentBlockDelta = { type: 'text_delta', text: content }
      events.push({ type: 'content_block_delta', index: this.textIndex, delta: textDelta })
    }
    if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
      this.finishReason = choice.finish_reason
    }
    return events
  }

  /**
   * 是否收到过 finish_reason。
   * OpenAI 兼容接口正常结束一定会给（stop/length/tool_calls）；
   * 没有就给完了通常意味着网关/网络把连接从中间掐断了。
   */
  /** 流被提前掐断（没有 [DONE] 也没有 finish_reason）：标成 max_tokens，让「继续生成」可用 */
  markIncomplete(): void {
    if (!this.finishReason) {
      this.finishReason = 'length'
    }
  }

  sawFinish(): boolean {
    return this.finishReason !== ''
  }

  finish(): MessageStreamEvent[] {
    const events = this.start()
    if (this.thinkingIndex >= 0) {
      events.push({ type: 'content_block_stop', index: this.thinkingIndex })
      this.thinkingIndex = -1
    }
    if (this.textIndex >= 0) {
      events.push({ type: 'content_block_stop', index: this.textIndex })
      this.textIndex = -1
    }
    events.push({
      type: 'message_delta',
      delta: {
        stop_reason: stopReasonOf(this.finishReason),
        stop_sequence: null,
        ...(this.title?.trim() ? { title: this.title.trim() } : {}),
      },
      usage: this.usage,
    })
    events.push({ type: 'message_stop' })
    return events
  }
}

/**
 * WorkBuddy 版 streamMessage：与 DeepSeek 通道返回同一套 `MessageStreamEvent`，
 * 因此 `store.ts` 的归并、落盘、UI 都不需要第二套逻辑。
 */
export async function* streamWorkBuddy(
  request: WorkBuddyRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  if (!workbuddyAvailable()) {
    throw new ApiError('network', 'WorkBuddy 只在安卓 App 内可用')
  }
  const body: CreateMessageRequest | Record<string, unknown> = openAIBody(request)
  const stream = openWorkBuddyStream(body)
  const onAbort = () => stream.cancel()
  signal.addEventListener('abort', onAbort, { once: true })
  const translator = new StreamTranslator(request.model, request.thinking, request.title)
  let completed = false

  try {
    for (;;) {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      const event = await stream.next()
      if (event.done) {
        break
      }
      const payload = event.value
      if (payload.type === 'error') {
        const status = payload.status ?? 0
        const message =
          status === 401 || status === 403
            ? 'WorkBuddy 登录已失效，请到设置里重新登录'
            : payload.message?.trim() || 'WorkBuddy 请求失败'
        // 协议类错误直接展示原文；否则 401 会被上层误判成 DeepSeek API Key 错误。
        throw status === 401 || status === 403
          ? new ApiError('protocol', message)
          : new ApiError('http', message, status || undefined)
      }
      if (payload.type === 'done') {
        break
      }
      let chunk: OpenAIChunk
      try {
        chunk = JSON.parse(payload.data) as OpenAIChunk
      } catch {
        continue
      }
      if (chunk.error) {
        throw new ApiError('stream', chunk.error.message?.trim() || 'WorkBuddy 返回了错误')
      }
      for (const out of translator.push(chunk)) {
        yield out
      }
    }
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    for (const out of translator.finish()) {
      yield out
    }
    completed = true
  } finally {
    signal.removeEventListener('abort', onAbort)
    if (!completed) {
      stream.cancel()
    }
  }
}
