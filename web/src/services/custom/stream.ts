/**
 * 自定义 OpenAI 兼容供应商的流式聊天：复用 WorkBuddy 的 OpenAI → 应用事件翻译，
 * 只把底层桥换成 CustomAndroid。
 */

import { ApiError } from '../api/client.js'
import type { MessageStreamEvent } from '../api/types.js'
import {
  openAIBody,
  StreamTranslator,
  type WorkBuddyRequest,
} from '../workbuddy/stream.js'
import { customAvailable, openCustomStream } from './bridge.js'

export async function* streamCustom(
  request: WorkBuddyRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  if (!customAvailable()) {
    throw new ApiError('network', '自定义 API 只在安卓 App 内可用')
  }
  const stream = openCustomStream(openAIBody(request))
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
        // 自定义供应商的 401 是它自己的 Key 问题，不能显示成 DeepSeek API Key 错误。
        throw new ApiError(
          'protocol',
          payload.message?.trim() || '自定义 API 请求失败'
        )
      }
      if (payload.type === 'done') {
        break
      }
      let chunk: { error?: { message?: string } } & Record<string, unknown>
      try {
        chunk = JSON.parse(payload.data) as typeof chunk
      } catch {
        continue
      }
      if (chunk.error) {
        throw new ApiError('stream', chunk.error.message?.trim() || '自定义 API 返回了错误')
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
