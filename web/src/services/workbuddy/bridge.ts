/**
 * WorkBuddy 账号通道的原生桥。
 *
 * WorkBuddy 的 HTTPS 接口在 WebView 里会被 CORS 拦掉，所以登录、token 刷新和
 * 聊天请求都由原生的 `WorkBuddyAndroid` 接口执行，再把结果按 id 回传给网页。
 * 网页只负责把 OpenAI 风格的 SSE 翻译成应用使用的 Anthropic 事件。
 */

export type WorkBuddyAccountInfo = {
  nickname?: string
  uid?: string
  domain?: string
  expiresAt?: number
}

export type WorkBuddyBridgeEvent =
  | { type: 'chunk'; data: string }
  | { type: 'done'; status?: number }
  | { type: 'error'; status?: number; message?: string }

type Sink = {
  push: (event: WorkBuddyBridgeEvent) => void
  close: () => void
}

type WorkBuddyAndroid = {
  login?: () => void
  hasToken?: () => boolean
  logout?: () => void
  account?: () => string
  refreshAccount?: () => void
  billing?: (id: string) => void
  claimCheckin?: (id: string) => void
  autoCheckin?: () => boolean
  setAutoCheckin?: (value: boolean) => void
  lastAutoCheckin?: () => string
  setLastAutoCheckin?: (date: string) => void
  chat?: (id: string, body: string) => void
  cancel?: (id: string) => void
}

declare global {
  interface Window {
    WorkBuddyAndroid?: WorkBuddyAndroid
    __workbuddyBridgeDeliver?: (id: string, payload: string) => void
  }
}

const sinks = new Map<string, Sink>()
let sequence = 0

const install = () => {
  if (typeof window === 'undefined' || window.__workbuddyBridgeDeliver) {
    return
  }
  window.__workbuddyBridgeDeliver = (id, payload) => {
    const sink = sinks.get(id)
    if (!sink) {
      return
    }
    try {
      sink.push(JSON.parse(payload) as WorkBuddyBridgeEvent)
    } catch {
      sink.push({ type: 'error', message: 'WorkBuddy 桥回了无法解析的数据' })
      sink.close()
    }
  }
}

install()

const bridge = () => (typeof window === 'undefined' ? undefined : window.WorkBuddyAndroid)

/** 当前运行环境是否带 WorkBuddy 通道（安卓 App）。 */
export const workbuddyAvailable = (): boolean => typeof bridge()?.chat === 'function'

export const workbuddyHasToken = (): boolean => {
  try {
    return bridge()?.hasToken?.() === true
  } catch {
    return false
  }
}

export const workbuddyLogin = (): void => {
  bridge()?.login?.()
}

export const workbuddyLogout = (): void => {
  try {
    bridge()?.logout?.()
  } finally {
    // 退出后清掉仍在等待的流，避免旧请求的回包串到下一次登录。
    for (const sink of sinks.values()) {
      sink.push({ type: 'error', message: '已退出 WorkBuddy' })
      sink.close()
    }
    sinks.clear()
  }
}

export const workbuddyAccount = (): WorkBuddyAccountInfo | null => {
  try {
    const raw = bridge()?.account?.()
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as WorkBuddyAccountInfo
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * 发起一次原生流式聊天。原生按 SSE 的 `data:` 行回调，每次一个 JSON 字符串。
 * 调用方通过返回的异步迭代器消费；`cancel()` 会断开原生连接。
 */
export const openWorkBuddyStream = (
  body: unknown
): AsyncIterableIterator<WorkBuddyBridgeEvent> & { cancel: () => void } => {
  const api = bridge()
  if (typeof api?.chat !== 'function') {
    throw new Error('WorkBuddy 只在安卓 App 内可用')
  }
  const id = `wb${Date.now()}_${++sequence}`
  const queue: WorkBuddyBridgeEvent[] = []
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
    sinks.delete(id)
    wake?.()
    wake = null
    try {
      api.cancel?.(id)
    } catch {
      // 原生已经结束或还没注册连接，忽略。
    }
  }

  try {
    api.chat(id, JSON.stringify(body))
  } catch (error) {
    sinks.delete(id)
    throw error
  }

  const iterator: AsyncIterableIterator<WorkBuddyBridgeEvent> & { cancel: () => void } = {
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
