/**
 * 自定义 OpenAI 兼容供应商的流式聊天：复用 WorkBuddy 的 OpenAI → 应用事件翻译，
 * 只把底层桥换成 CustomAndroid。
 *
 * 第三方供应商五花八门，这里额外做几件事提高成功率：
 *   1. 报错翻译成中文人话（401/429/404/400 等常见情况给出具体原因）；
 *   2. 限流 / 5xx / 网络抖动自动重试一次；
 *   3. 模型不支持图片（历史里带图会 400）时，去掉图片重试一次；
 *   4. 思考参数按已知厂商补，被拒时自动退回。
 */

import { ApiError } from '../api/client.js'
import { translate } from '../../i18n/index.js'
import { showToast } from '../../components/base/toastState.js'
import type { MessageStreamEvent } from '../api/types.js'
import {
  openAIBody,
  StreamTranslator,
  type WorkBuddyRequest,
} from '../workbuddy/stream.js'
import { customAvailable, getCustomConfig, openCustomStream } from './bridge.js'

/* 同一页面会话里这两类降级提示只弹一次，避免历史带图时每条消息都弹 */
let imageSkipToastShown = false
let thinkingSkipToastShown = false

/**
 * 不少 OpenAI 兼容厂商默认不开思考，要在请求体里显式打开，而且各家的字段名都不一样。
 * 这里只对认识的域名追加参数：不认识的域名原样发送，免得严格校验的服务端拒收未知字段。
 */
const thinkingBodyExtras = (baseUrl: string): Record<string, unknown> => {
  let host = ''
  try {
    host = new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return {}
  }
  if (host.endsWith('openrouter.ai')) {
    return { reasoning: { enabled: true } }
  }
  if (host.endsWith('deepseek.com') || host.endsWith('bigmodel.cn') || host.endsWith('moonshot.cn') || host.endsWith('moonshot.ai')) {
    return { thinking: { type: 'enabled' } }
  }
  if (host.endsWith('volces.com')) {
    // 火山方舟用的是 thinking.type（不是 enable_thinking）
    return { thinking: { type: 'enabled' } }
  }
  if (host.endsWith('siliconflow.cn') || host.endsWith('siliconflow.com') || host.endsWith('aliyuncs.com')) {
    return { enable_thinking: true }
  }
  return {}
}

/** 从供应商返回的错误文本里挖出可读信息（常见是 {"error":{"message":"..."}}） */
const errorDetail = (raw: string): string => {
  const text = raw.trim()
  const jsonStart = text.indexOf('{')
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart)) as {
        error?: { message?: string; code?: string } | string
        message?: string
        msg?: string
      }
      const error = parsed.error
      if (error && typeof error === 'object') {
        const detail = (error.message || error.code || '').trim()
        if (detail) {
          return detail
        }
      }
      if (typeof error === 'string' && error.trim()) {
        return error.trim()
      }
      const direct = (parsed.message || parsed.msg || '').trim()
      if (direct) {
        return direct
      }
    } catch {
      // 不是 JSON，继续用原文
    }
  }
  return text
}

const sanitizeDetail = (detail: string): string => {
  // 只有看起来真是 HTML（以 < 开头或含闭合标签）才剥，避免把 "max tokens < 4096 >" 这类文案吃掉
  if (!detail.trimStart().startsWith('<') && !detail.includes('</')) {
    return detail
  }
  const text = detail
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, 160) || '（供应商返回了网页错误页）'
}

/**
 * 把原始报错翻译成用户能看懂的一句话。
 * status 优先使用桥事件里的真实 HTTP 状态码：原生只把响应体放进 message，
 * 很多供应商的 body 里根本没有状态码，只能靠关键字猜。
 */
const friendlyError = (raw: string, status?: number): string => {
  const detail = sanitizeDetail(errorDetail(raw))
  const lower = detail.toLowerCase()
  const code =
    typeof status === "number" && status > 0
      ? status
      : Number(/HTTP\s*(\d{3})/i.exec(raw)?.[1] ?? 0) || 0

  // 有真实状态码时先按状态码判断（HTML 网关页也可能带 413/5xx，不应一律说成地址填错）
  if (code === 0 && detail.trim().startsWith('<')) {
    return `供应商返回了网页错误页，通常是网关/防火墙拦截或地址填错：${detail.slice(0, 120)}`
  }

  if (code === 401 || code === 403) {
    return `API Key 无效或没有权限（HTTP ${code}）：${detail}`
  }
  if (code === 402) {
    return `账户余额或额度不足（HTTP 402）：${detail}`
  }
  if (code === 429) {
    return `请求太频繁，被供应商限流了（HTTP 429）：${detail}`
  }
  if (code === 404) {
    return `地址或模型名不对（HTTP 404）：${detail}。请确认 Base URL 是 OpenAI 兼容地址（一般以 /v1 结尾）且模型名拼写正确`
  }
  if (code === 413) {
    return `请求体太大（HTTP 413）：${detail}。可以新建对话或压缩上下文后再试`
  }
  if (code >= 500) {
    return `供应商服务端出错（HTTP ${code}），稍后重试：${detail}`
  }

  // 没有状态码时按更精确的关键词兜底
  if (/(invalid|incorrect|wrong).*(api[ _-]?key|token)|api[ _-]?key.*(invalid|expired|missing)|unauthorized|authentication failed/i.test(lower)) {
    return `API Key 无效或没有权限：${detail}`
  }
  if (/insufficient (balance|quota)|余额不足|额度不足|credit.*(exhausted|depleted)/i.test(lower)) {
    return `账户余额或额度不足：${detail}`
  }
  if (/rate limit|too many requests|requests per|限流|频率/i.test(lower)) {
    return `请求太频繁，被供应商限流了：${detail}`
  }
  if (/model.*(not found|does not exist|不存在)|no such model/i.test(lower)) {
    return `模型名不对：${detail}。请确认模型名拼写正确`
  }
  if (/maximum context length|context length|token limit|context.*(exceed|too long)|超出.{0,4}上下文|长度超限/i.test(lower)) {
    return `这轮上下文超出模型上限，先压缩上下文或新建对话再试：${detail}`
  }
  if (/timeout|timed out|连接失败|连接超时|failed to connect|network is unreachable|connection (reset|refused)|ssl/i.test(raw)) {
    return `连接不上供应商，检查网络或 Base URL：${detail}`
  }
  return detail || raw
}
const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

type ChatBody = ReturnType<typeof openAIBody> & Record<string, unknown>

const bodyHasImages = (body: ChatBody): boolean =>
  (body.messages as Array<{ content: unknown }>).some(
    (message) =>
      Array.isArray(message.content) &&
      (message.content as Array<{ type?: string }>).some((part) => part?.type === 'image_url')
  )

/** 把消息里的图片块去掉（模型不支持视觉时的兜底重试） */
const stripImages = (body: ChatBody): ChatBody => {
  const messages = (body.messages as Array<{ role: string; content: unknown }>).map((message): {
    role: string
    content: unknown
  } => {
    if (!Array.isArray(message.content)) {
      return message
    }
    const kept = (message.content as Array<{ type?: string; text?: string }>).filter(
      (part) => part?.type !== 'image_url'
    )
    const images = (message.content as Array<{ type?: string }>).filter(
      (part) => part?.type === 'image_url'
    ).length
    const texts = kept
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text ?? '')
      .join('\n')
      .trim()
    if (!texts && images > 0) {
      // OpenAI 兼容实现普遍拒绝空 content，纯图片消息必须补一句占位说明
      return {
        ...message,
        content: `[已忽略 ${images} 张图片：当前模型不支持图片]`,
      }
    }
    return { ...message, content: texts ? texts : kept }
  })
  return { ...body, messages: messages as unknown as ChatBody['messages'] }
}

const isTransient = (message: string, status?: number): boolean => {
  if (status === 429 || (typeof status === 'number' && status >= 500 && status < 600)) {
    return true
  }
  return /HTTP\s*(429|5\d\d)/i.test(message) ||
    /timeout|timed out|连接失败|连接超时|failed to connect|network is unreachable|connection (reset|refused|closed)|ssl|handshake/i.test(
      message
    )
}

/** 只把「模型/接口不支持图片」当成需要去图重试；「图片太大/拉取失败」不算 */
const isImageRejection = (message: string, status?: number): boolean => {
  if (status !== undefined && status !== 400 && status !== 415 && status !== 422) {
    return false
  }
  if (!/image|vision|multimodal|图片|视觉/i.test(message)) {
    return false
  }
  // 图片太大 / 下载失败不是「模型不支持图片」，不能去图重试
  if (/too large|too big|exceed.{0,12}(size|limit)|failed to (fetch|download)|cannot (fetch|download)|url.{0,16}(invalid|failed)/i.test(message)) {
    return false
  }
  return /not\s+support|unsupported|does\s+not\s+support|unknown\s+variant.{0,20}image|expected.{0,12}text|invalid.{0,20}(content|content[_-]?type|image)|image_url.*(not|unsupported|invalid)|不支持|无法识别/i.test(
    message
  )
}

/**
 * 把真实 HTTP 状态码挂在错误对象上。
 * 不写进 ApiError.status：那个字段会被 describe.ts 当成官方通道状态，
 * 给第三方错误套上「去 deepseek 平台充值」这类官方文案/链接。
 */
const markStatus = <T extends Error>(error: T, status?: number): T => {
  if (typeof status === 'number' && status > 0) {
    ;(error as unknown as { customStatus?: number }).customStatus = status
  }
  return error
}

/** 供应商拒绝未知参数（比如某些模型不支持 enable_thinking / thinking） */
const isParamRejection = (message: string): boolean =>
  /unknown (parameter|field)|unrecognized|invalid.{0,12}(parameter|field)|not support.{0,20}(parameter|field)|unsupported.{0,20}(parameter|field)|不支持.{0,8}(参数|字段)/i.test(
    message
  )

/** 统计本次请求产出了什么：visible=可见正文，any=可见正文或思考 */
const withCounter = async function* (
  events: AsyncGenerator<MessageStreamEvent>,
  counter: { visible: number; any: number }
): AsyncGenerator<MessageStreamEvent> {
  for await (const event of events) {
    if (event.type === 'content_block_delta') {
      counter.any += 1
      if (event.delta.type === 'text_delta') {
        counter.visible += 1
      }
    }
    yield event
  }
}

/** 跑一次请求（不重试） */
async function* runOnce(
  body: ChatBody,
  request: WorkBuddyRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const stream = openCustomStream(body)
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
        const raw = payload.message?.trim() || '自定义 API 请求失败'
        throw markStatus(new ApiError('protocol', friendlyError(raw, payload.status)), payload.status)
      }
      if (payload.type === 'done') {
        /*
         * 不把「没有 finish_reason」当成错误：部分网关/非流式兜底本来就不下发，
         * 一旦报错，这一轮 user+assistant 会被 getContextRounds 当无效轮次丢掉，上下文逐轮清零，
         * 比「可能截断」严重得多。真正的空流由下面的可见内容检查兜住。
         *
         * 但原生明确告诉我们「没收到 [DONE] 也没收到 finish_reason 就断开了」时，
         * 把 stop_reason 标成 max_tokens，让「继续生成」按钮出现（不报错、不丢上下文）。
         */
        if (payload.complete === false) {
          translator.markIncomplete()
        }
        break
      }
      let chunk: { error?: { message?: string } | string; choices?: unknown; usage?: unknown }
      try {
        chunk = JSON.parse(payload.data) as typeof chunk
      } catch {
        continue
      }
      if (!chunk || typeof chunk !== 'object') {
        continue
      }
      if (chunk.error) {
        const raw =
          typeof chunk.error === 'string'
            ? chunk.error
            : chunk.error.message?.trim() || '自定义 API 返回了错误'
        throw new ApiError('protocol', friendlyError(raw))
      }
      for (const out of translator.push(chunk as Parameters<StreamTranslator['push']>[0])) {
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

export async function* streamCustom(
  request: WorkBuddyRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  if (!customAvailable()) {
    throw new ApiError('network', '自定义 API 只在安卓 App 内可用')
  }
  const baseUrl = getCustomConfig().baseUrl
  const extras = request.thinking ? thinkingBodyExtras(baseUrl) : {}
  const plainBody: ChatBody = openAIBody(request)
  const body: ChatBody = { ...plainBody, ...extras }
  /** 记录本次是否真的产出了内容（空流 = 供应商异常） */
  const produced = { visible: 0, any: 0 }

  const run = async function* (target: ChatBody): AsyncGenerator<MessageStreamEvent> {
    const beforeVisible = produced.visible
    yield* withCounter(runOnce(target, request, signal), produced)
    /*
     * 无论是不是首条消息（首条消息会顺带请求会话标题），正文都必须有内容。
     * 标题由 message_delta.title 合成，不会产生 content_block_delta，
     * 所以以前用 !request.title 豁免会让「新会话第一条消息空流」静默通过，界面只剩空白。
     */
    if (produced.visible === beforeVisible) {
      /*
       * 只有思考没有正文：常见于「输出上限被思考吃满」（finish_reason=length）。
       * 这不能算失败 —— 按正常结束收尾，保留这一轮上下文，让「继续生成」按钮可用；
       * 只有真正一点内容都没有时才报空流错误。
       */
      if (produced.any > 0) {
        return
      }
      throw new ApiError(
        'protocol',
        '供应商没有返回任何内容（可能不兼容流式接口，或模型被限流），请换一个模型或稍后重试'
      )
    }
  }

  try {
    yield* run(body)
    return
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    const status =
      error instanceof Error ? (error as { customStatus?: number }).customStatus : undefined

    /*
     * 已经吐出过内容（正文或思考）就不能重试：
     * 重试会新建翻译器重新产出一整段回答，store 会把新块追加在旧块后面，
     * 用户看到「第一段：第二段完整回答」的重复内容，思考也会重复显示。
     */
    if (produced.any > 0) {
      throw error
    }

    // 1) 限流 / 5xx / 网络抖动：等 1.2s 重试一次
    if (isTransient(message, status)) {
      await delay(1200, signal)
      yield* run(body)
      return
    }

    // 2) 模型/接口不认图片：去掉图片再试一次（要排在参数错误前）
    if (bodyHasImages(body) && isImageRejection(message, status)) {
      yield* run(stripImages(body))
      // 用户得知道图没发出去，否则会以为模型答错了
      if (!imageSkipToastShown) {
        imageSkipToastShown = true
        showToast(translate('customImagesSkipped'))
      }
      return
    }

    // 3) 供应商不接受思考扩展参数：去掉这些字段重试一次
    if (Object.keys(extras).length > 0 && isParamRejection(message)) {
      yield* run(plainBody)
      if (!thinkingSkipToastShown) {
        thinkingSkipToastShown = true
        showToast(translate('customThinkingParamSkipped'))
      }
      return
    }
    throw error
  }
}
