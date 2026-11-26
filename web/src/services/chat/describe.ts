import { isTranslationKey, translate } from '../../i18n/index.js'
import { classifyStatus } from '../api/errors.js'
import type { AssistantMessage } from './types.js'

export type Notice = {
  text: string
  /** 模板答复使用正文样式；其余统一为红色错误提示。 */
  presentation?: 'response'
  /** 需要用户处理的问题附带的操作 */
  action?: 'apiKey' | 'topUp' | 'compressContext' | 'trimInput'
}

/*
 * 服务端原生英文报错 → 本地化文案。
 *
 * 官方通道对单次输入有硬限制（目前 32768 tokens），超限时返回的是英文原文，例如：
 *   user input too long, 614602 tokens exceeds max 32768 tokens (request_id: ...)
 * 直接展示给用户看不懂，而且不知道该怎么办，所以在这里识别并翻译成可操作的提示。
 * 解析不出来的一律返回 null，走原来的原文兜底。
 */
const INPUT_TOO_LONG =
  /(?:user input too long|input (?:is )?too long)[^0-9]*(\d+)\s*tokens?[^0-9]*exceeds?\s*(?:the\s*)?max(?:imum)?(?:\s*(?:of|length))?\s*(\d+)\s*tokens?/i
const CONTEXT_TOO_LONG =
  /maximum context length(?: is| of|:)?\s*(\d+)(?:\.\d+)?\s*tokens/i

/** 是否"单次输入/请求"超限（区别于总上下文超限）。 */
export const isInputTooLong = (message: string): boolean => INPUT_TOO_LONG.test(message)

/**
 * 服务端图片数量/体积超限（单次请求最多 600 张，带 file_id 的图片合计最多 200 MiB）。
 * 正常路径下 App 已自动省略较早的图片、不该再触发；仍出现时说明单条消息里的图片也太多，
 * 给一句可操作的中文提示，而不是把英文原文甩给用户。
 */
const IMAGE_LIMIT =
  /(?:too many images|images?[^.\n]{0,60}(?:exceed|over ?limit|limit exceeded|maximum)|maximum (?:number of )?images|image (?:count|number)[^.\n]{0,40}(?:limit|exceed))/i

export const isImageLimitError = (message: string): boolean => IMAGE_LIMIT.test(message)

const imageLimitText = (): string => {
  const english =
    typeof document !== 'undefined' && document.documentElement.lang.startsWith('en')
  return english
    ? 'Too many images for one request. Remove some images from this message or start a new conversation.'
    : '图片太多，本次请求放不下。请减少这条消息里的图片，或新开一个对话再试。'
}

/**
 * 从服务端报错里解析"上下文/单次请求上限"。
 * - 总上下文超限（context length ...）→ 返回上下文上限；
 * - 官方通道单次输入上限（user input too long, N tokens exceeds max M tokens）→ 返回 M；
 *   这种情况通常也是历史太长把总请求撑爆了，压缩历史同样有效，所以也允许触发压缩。
 * 解析不到或数值不合理时返回 null（不显示压缩入口）。
 */
export const getContextLimit = (message?: string | null): number | null => {
  if (!message) {
    return null
  }
  const context = CONTEXT_TOO_LONG.exec(message)
  if (context) {
    const value = Number(context[1])
    return Number.isFinite(value) && value > 8000 ? value : null
  }
  const input = INPUT_TOO_LONG.exec(message)
  if (input) {
    const tokens = Number(input[1])
    const max = Number(input[2])
    if (Number.isFinite(max) && max > 8000 && tokens > max) {
      return max
    }
  }
  return null
}

const localizeServerMessage = (raw: string): string | null => {
  const tooLong = INPUT_TOO_LONG.exec(raw)
  if (tooLong) {
    return translate('replyInputTooLong', {
      tokens: Number(tooLong[1]).toLocaleString('en-US'),
      max: Number(tooLong[2]).toLocaleString('en-US'),
    })
  }
  const context = CONTEXT_TOO_LONG.exec(raw)
  if (context) {
    return translate('replyContextTooLong', {
      max: Number(context[1]).toLocaleString('en-US'),
    })
  }
  return null
}

const getTemplateText = (reply: AssistantMessage) =>
  reply.blocks
    .map((block) => (block.type === 'text' && block.isTemplate ? block.text : ''))
    .join('')

/** 回复出错或未正常结束时展示的提示 */
export const describeReply = (reply: AssistantMessage): Notice | null => {
  if (reply.status === 'error' && reply.error) {
    const { kind, status, localMessage } = reply.error
    // 导入的历史可能来自不同版本；不识别的文案沿用保存时的原文。
    const message =
      localMessage && isTranslationKey(localMessage.key)
        ? translate(localMessage.key, localMessage.params)
        : reply.error.message
    // 历史补传错误刷新后仍需说明原因，恢复沿用附件卡片或重新生成。
    if (kind === 'upload') {
      return { text: message || translate('uploadFileStatusFailed') }
    }
    if (kind === 'network') {
      return { text: translate('commonNetworkErrorToast') }
    }
    switch (classifyStatus(status)) {
      case 'unauthorized':
        return { text: translate('replyInvalidApiKey'), action: 'apiKey' }
      case 'insufficientBalance':
        return { text: translate('replyInsufficientBalance'), action: 'topUp' }
      case 'rateLimited':
        return { text: translate('replyRateLimited') }
      case 'serverBusy':
        return { text: translate('completionServerBusyToast') }
      default:
        if (!message) {
          return null
        }
        if (isImageLimitError(message)) {
          return { text: imageLimitText() }
        }
        {
          const limit = getContextLimit(message)
          if (limit) {
            // 只有 400/413（或无状态码的兼容错误）才可能是超限；410/422/5xx 等一律不显示按钮。
            const statusOk =
              !reply.error?.status ||
              reply.error.status === 400 ||
              reply.error.status === 413
            if (!statusOk) {
              return { text: localizeServerMessage(message) ?? message }
            }
            // input 类：优先用发送时记录的 overflow；旧数据没有记录时按错误文案回退。
            const inputLike =
              reply.error?.overflow === 'input' ||
              (!reply.error?.overflow && isInputTooLong(message))
            return {
              text: localizeServerMessage(message) ?? message,
              action: inputLike ? 'trimInput' : 'compressContext',
            }
          }
          return { text: localizeServerMessage(message) ?? message }
        }
    }
  }
  const template = getTemplateText(reply)
  // 归档不带结构化错误，错误文案保存在模板中，仍按错误提示展示。
  if (reply.status === 'error' && template) {
    return { text: template }
  }
  if (reply.stopReason === 'refusal') {
    // 导入的拒绝回复优先展示归档中的模板，普通正文仍不可展示。
    return { text: template || translate('replyRefused'), presentation: 'response' }
  }
  if (template) {
    return { text: template, presentation: 'response' }
  }
  return null
}
