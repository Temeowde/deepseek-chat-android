/**
 * 自定义 OpenAI 兼容供应商的原生桥。
 *
 * 第三方 Base URL 在 WebView 里会被 CORS/流式读取限制，所以聊天与模型列表
 * 都交给原生执行，再把 SSE 行通过 window.__customBridgeDeliver 回传。
 */

export type CustomProviderConfig = {
  name: string
  baseUrl: string
  model: string
  hasKey: boolean
  keyLength: number
  /** 本地/局域网地址（通常不需要 Key） */
  local?: boolean
}

export type CustomSaveResult = { ok: boolean; error?: string }

export type CustomBridgeEvent =
  | { type: 'chunk'; data: string }
  | { type: 'done'; status?: number; complete?: boolean }
  | { type: 'error'; status?: number; message?: string }

type CustomAndroid = {
  getConfig?: () => string
  saveConfig?: (json: string) => string
  clear?: () => void
  clearKey?: () => void
  chat?: (id: string, body: string) => void
  cancel?: (id: string) => void
  listModels?: (id: string, baseUrl: string, apiKey: string) => void
}

type Sink = {
  push: (event: CustomBridgeEvent) => void
  close: () => void
}

type ModelRequest = {
  resolve: (models: string[]) => void
  reject: (error: Error) => void
}

declare global {
  interface Window {
    CustomAndroid?: CustomAndroid
    __customBridgeDeliver?: (id: string, payload: string) => void
  }
}

/** 原生事件迟迟不来（WebView 重建/桥丢失）时的前端兜底，避免一直转圈 */
const CHAT_IDLE_TIMEOUT_MS = 300_000

const sinks = new Map<string, Sink>()
const modelRequests = new Map<string, ModelRequest>()
let sequence = 0

const install = () => {
  if (typeof window === 'undefined' || window.__customBridgeDeliver) {
    return
  }
  window.__customBridgeDeliver = (id, payload) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      const sink = sinks.get(id)
      sink?.push({ type: 'error', message: '自定义 API 桥回了无法解析的数据' })
      sink?.close()
      return
    }
    const sink = sinks.get(id)
    if (sink) {
      sink.push(parsed as CustomBridgeEvent)
      if ((parsed as CustomBridgeEvent).type !== 'chunk') {
        sink.close()
      }
      return
    }
    const request = modelRequests.get(id)
    if (!request) {
      return
    }
    modelRequests.delete(id)
    const event = parsed as { type?: string; data?: unknown; message?: string }
    if (event.type === 'error') {
      request.reject(new Error(event.message?.trim() || '自定义 API 请求失败'))
      return
    }
    const models = Array.isArray(event.data)
      ? event.data.filter((item): item is string => typeof item === 'string')
      : []
    request.resolve(models)
  }
}

install()

const bridge = () => (typeof window === 'undefined' ? undefined : window.CustomAndroid)

export const customAvailable = (): boolean => typeof bridge()?.chat === 'function'

const readConfig = (): CustomProviderConfig => {
  const empty: CustomProviderConfig = { name: '', baseUrl: '', model: '', hasKey: false, keyLength: 0 }
  try {
    const raw = bridge()?.getConfig?.()
    if (!raw) {
      return empty
    }
    const parsed = JSON.parse(raw) as Partial<CustomProviderConfig>
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      hasKey: parsed.hasKey === true,
      local: parsed.local === true,
      keyLength:
        typeof parsed.keyLength === 'number' && Number.isFinite(parsed.keyLength)
          ? parsed.keyLength
          : 0,
    }
  } catch {
    return empty
  }
}

export const getCustomConfig = (): CustomProviderConfig => readConfig()

export const saveCustomConfig = (config: {
  name: string
  baseUrl: string
  model: string
  apiKey: string
}): CustomSaveResult => {
  try {
    const raw = bridge()?.saveConfig?.(JSON.stringify(config))
    if (!raw) {
      return { ok: false, error: '自定义 API 桥不可用' }
    }
    const parsed = JSON.parse(raw) as CustomSaveResult
    return { ok: parsed.ok === true, error: parsed.error }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export const clearCustomConfig = (): void => {
  try {
    bridge()?.clear?.()
  } catch {
    // 忽略
  }
}

export const clearCustomKey = (): void => {
  try {
    bridge()?.clearKey?.()
  } catch {
    // 忽略
  }
}

export const listCustomModels = (baseUrl: string, apiKey: string): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const api = bridge()
    if (typeof api?.listModels !== 'function') {
      reject(new Error('自定义 API 只在安卓 App 内可用'))
      return
    }
    const id = `custom-models-${Date.now()}-${++sequence}`
    const timer = window.setTimeout(() => {
      modelRequests.delete(id)
      reject(new Error('连接超时'))
    }, 20000)
    modelRequests.set(id, {
      resolve: (models) => {
        window.clearTimeout(timer)
        resolve(models)
      },
      reject: (error) => {
        window.clearTimeout(timer)
        reject(error)
      },
    })
    try {
      api.listModels(id, baseUrl, apiKey)
    } catch (error) {
      window.clearTimeout(timer)
      modelRequests.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })

/** 发起一次自定义供应商流式聊天；与 WorkBuddy 的桥事件形状一致。 */
export const openCustomStream = (
  body: unknown
): AsyncIterableIterator<CustomBridgeEvent> & { cancel: () => void } => {
  const api = bridge()
  if (typeof api?.chat !== 'function') {
    throw new Error('自定义 API 只在安卓 App 内可用')
  }
  const id = `custom${Date.now()}_${++sequence}`
  const queue: CustomBridgeEvent[] = []
  let wake: (() => void) | null = null
  let closed = false

  const sink: Sink = {
    push: (event) => {
      queue.push(event)
      wake?.()
      wake = null
    },
    close: () => {
      closed = true
      window.clearTimeout(idleTimer)
      sinks.delete(id)
      wake?.()
      wake = null
    },
  }
  sinks.set(id, sink)

  const cancel = () => {
    if (closed) {
      return
    }
    closed = true
    window.clearTimeout(idleTimer)
    sinks.delete(id)
    wake?.()
    wake = null
    try {
      api.cancel?.(id)
    } catch {
      // 忽略
    }
  }

  /* 兜底：连续 5 分钟没有任何事件就报错收尾，并顺手取消原生请求 */
  let idleTimer = 0
  const armTimer = () => {
    window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => {
      if (closed) {
        return
      }
      sink.push({
        type: 'error',
        message: '请求超时：迟迟没有收到供应商的数据，请检查网络或 Base URL 后重试',
      })
      try {
        api.cancel?.(id)
      } catch {
        // 忽略
      }
      sink.close()
    }, CHAT_IDLE_TIMEOUT_MS)
  }
  armTimer()
  // 每个事件到达都重新计时（否则长回答会在 5 分钟后被误判超时）
  const originalPush = sink.push
  sink.push = (event) => {
    if (!closed) {
      armTimer()
    }
    originalPush(event)
  }

  try {
    api.chat(id, JSON.stringify(body))
  } catch (error) {
    window.clearTimeout(idleTimer)
    sinks.delete(id)
    throw error
  }

  const iterator: AsyncIterableIterator<CustomBridgeEvent> & { cancel: () => void } = {
    cancel,
    async next() {
      for (;;) {
        const event = queue.shift()
        if (event) {
          return { value: event, done: false }
        }
        if (closed) {
          return { value: undefined, done: true }
        }
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
    async return() {
      cancel()
      return { value: undefined, done: true }
    },
    [Symbol.asyncIterator]() {
      return iterator
    },
  }

  return iterator
}
