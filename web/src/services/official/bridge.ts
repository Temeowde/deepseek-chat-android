/**
 * 官方账号通道的原生桥。
 *
 * 登录在原生 LoginActivity 里用官方网页完成；令牌由原生 Keystore 加密保存。
 * 网页侧只发 /api/v0/ 路径，由原生带上令牌去请求，再把响应按 id 回传。
 */

export type OfficialResponse = { status: number; body: string }

type Deliver = (id: string, payload: string) => void

declare global {
  interface Window {
    __officialBridgeDeliver?: Deliver
  }
}

const pending = new Map<string, (response: OfficialResponse) => void>()
let sequence = 0

const install = () => {
  if (typeof window === 'undefined' || window.__officialBridgeDeliver) {
    return
  }
  window.__officialBridgeDeliver = (id, payload) => {
    const resolve = pending.get(id)
    if (!resolve) {
      return
    }
    pending.delete(id)
    try {
      const parsed = JSON.parse(payload) as Partial<OfficialResponse>
      resolve({ status: Number(parsed.status ?? -1), body: String(parsed.body ?? '') })
    } catch {
      resolve({ status: -1, body: '' })
    }
  }
}

install()

const bridge = () => (typeof window === 'undefined' ? undefined : window.DeepSeekAndroid)

/** 当前运行环境是否带官方账号通道（安卓 App）。 */
export const officialAvailable = (): boolean => typeof bridge()?.officialRequest === 'function'

export const officialHasToken = (): boolean => {
  try {
    return bridge()?.officialHasToken?.() === true
  } catch {
    return false
  }
}

export const officialLogin = () => {
  bridge()?.officialLogin?.()
}

export const officialLogout = () => {
  bridge()?.officialLogout?.()
}

/** 用账号密码登录；成功返回 true，失败时把服务端原文作为错误抛出。 */
export const officialPasswordLogin = (account: string, password: string): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const api = bridge()
    if (typeof api?.officialPasswordLogin !== 'function') {
      reject(new Error('official bridge unavailable'))
      return
    }
    const id = `p${++sequence}`
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('official login timeout'))
    }, 30000)
    pending.set(id, (response) => {
      clearTimeout(timer)
      if (response.body.includes('"ok":true')) {
        resolve(true)
        return
      }
      let message = ''
      try {
        const root = JSON.parse(response.body) as { data?: { biz_msg?: string }; error?: string }
        message = root?.data?.biz_msg ?? root?.error ?? ''
      } catch {
        message = response.body.slice(0, 200)
      }
      const friendly: Record<string, string> = {
        PASSWORD_OR_USER_NAME_IS_WRONG: '账号或密码不正确',
        INVALID_TOKEN: '登录已失效，请重新登录',
        NEED_VERIFICATION: '需要安全验证，请改用验证码登录',
      }
      reject(new Error(friendly[message] ?? message ?? '登录失败'))
    })
    try {
      api.officialPasswordLogin(id, account, password)
    } catch (error) {
      clearTimeout(timer)
      pending.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })

/** 请求一个 /api/v0/ 路径；超时或桥不可用时抛出。 */
export const officialGet = (path: string, timeout = 30000): Promise<OfficialResponse> =>
  new Promise((resolve, reject) => {
    const api = bridge()
    if (typeof api?.officialRequest !== 'function') {
      reject(new Error('official bridge unavailable'))
      return
    }
    const id = `o${++sequence}`
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('official request timeout'))
    }, timeout)
    pending.set(id, (response) => {
      clearTimeout(timer)
      resolve(response)
    })
    try {
      api.officialRequest(id, path)
    } catch (error) {
      clearTimeout(timer)
      pending.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
