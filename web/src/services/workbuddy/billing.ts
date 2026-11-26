/**
 * WorkBuddy 积分与签到。
 *
 * 接口在原生的 WorkBuddyAccount 里执行（WebView 无法直接跨域读 billing 域），
 * 这里只做请求/回调配对、缓存和自动签到判定。
 */

import { workbuddyAccount, workbuddyHasToken } from './bridge.js'

export type WorkBuddyCreditPackage = {
  name: string
  remain: number
  size: number
  monthly: boolean
  expiresAt: number
}

export type WorkBuddyCredits = {
  total: number
  expiringSoon: number
  packages: WorkBuddyCreditPackage[]
}

export type WorkBuddyCheckin = {
  active: boolean
  todayCheckedIn: boolean
  streakDays: number
  dailyCredit: number
  todayCredit: number
  totalCredits: number
  claimText: string
  endTime: string
}

export type WorkBuddyBilling = {
  credits?: WorkBuddyCredits
  checkin?: WorkBuddyCheckin
  warning?: string
}

export type WorkBuddyCheckinClaim = {
  credit: number
  streakDays: number
  isStreakDay: boolean
}

export type WorkBuddyCheckinResult = {
  claim: WorkBuddyCheckinClaim
  credits?: WorkBuddyCredits
  checkin?: WorkBuddyCheckin
}

type PendingSink = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

const pending = new Map<string, PendingSink>()
let sequence = 0

type Deliver = (id: string, payload: string) => void
const originalDeliver: Deliver | undefined =
  typeof window === 'undefined' ? undefined : window.__workbuddyBridgeDeliver

if (typeof window !== 'undefined') {
  window.__workbuddyBridgeDeliver = (id, payload) => {
    const sink = pending.get(id)
    if (!sink) {
      originalDeliver?.(id, payload)
      return
    }
    pending.delete(id)
    try {
      const parsed = JSON.parse(payload) as { type?: string; data?: unknown; message?: string }
      if (parsed.type === 'error') {
        sink.reject(new Error(parsed.message?.trim() || 'WorkBuddy 请求失败'))
        return
      }
      sink.resolve(parsed.data)
    } catch {
      sink.reject(new Error('WorkBuddy 回了无法解析的数据'))
    }
  }
}

const bridge = () => (typeof window === 'undefined' ? undefined : window.WorkBuddyAndroid)

export const billingAvailable = (): boolean => typeof bridge()?.billing === 'function'

const call = <T>(kind: 'billing' | 'checkin'): Promise<T> =>
  new Promise((resolve, reject) => {
    const api = bridge()
    const method = kind === 'billing' ? api?.billing : api?.claimCheckin
    if (typeof method !== 'function') {
      reject(new Error('WorkBuddy 积分功能只在安卓 App 内可用'))
      return
    }
    const id = `wb-${kind}-${Date.now()}-${++sequence}`
    const timer = window.setTimeout(() => {
      pending.delete(id)
      reject(new Error('WorkBuddy 请求超时'))
    }, 30000)
    pending.set(id, {
      resolve: (value) => {
        window.clearTimeout(timer)
        resolve(value as T)
      },
      reject: (error) => {
        window.clearTimeout(timer)
        reject(error)
      },
    })
    try {
      method.call(api, id)
    } catch (error) {
      window.clearTimeout(timer)
      pending.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })

/** 读积分与签到状态；失败抛错，调用方自行降级。 */
export const fetchWorkBuddyBilling = (): Promise<WorkBuddyBilling> =>
  call<WorkBuddyBilling>('billing')

/** 领取今日签到奖励，并返回领取后的积分与状态。 */
export const claimWorkBuddyCheckin = (): Promise<WorkBuddyCheckinResult> =>
  call<WorkBuddyCheckinResult>('checkin')

export const workbuddyAutoCheckin = (): boolean => {
  try {
    return bridge()?.autoCheckin?.() === true
  } catch {
    return false
  }
}

export const setWorkbuddyAutoCheckin = (value: boolean): void => {
  try {
    bridge()?.setAutoCheckin?.(value)
  } catch {
    // 桥不可用时仅本次会话不生效
  }
}

const todayKey = (): string => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const lastAutoCheckin = (): string => {
  try {
    return bridge()?.lastAutoCheckin?.() ?? ''
  } catch {
    return ''
  }
}

const setLastAutoCheckin = (date: string): void => {
  try {
    bridge()?.setLastAutoCheckin?.(date)
  } catch {
    // 忽略
  }
}

/**
 * 自动签到：只在开启、已登录、今日未签时执行一次；同一天不重复请求。
 * 任何失败都静默，不影响聊天。
 */
const runAutoCheckin = async (): Promise<WorkBuddyCheckinResult | null> => {
  try {
    if (!workbuddyAutoCheckin() || !workbuddyHasToken() || !billingAvailable()) {
      return null
    }
    const uid = workbuddyAccount()?.uid?.trim() || 'anon'
    const today = `${todayKey()}:${uid}`
    if (lastAutoCheckin() === today) {
      return null
    }
    const billing = await fetchWorkBuddyBilling()
    if (!billing.checkin) {
      return null
    }
    if (!billing.checkin.active) {
      setLastAutoCheckin(today)
      return null
    }
    if (billing.checkin.todayCheckedIn) {
      setLastAutoCheckin(today)
      return null
    }
    const result = await claimWorkBuddyCheckin()
    setLastAutoCheckin(today)
    return result
  } catch {
    return null
  }
}

let autoCheckinInflight: Promise<WorkBuddyCheckinResult | null> | null = null

export const maybeAutoCheckin = (): Promise<WorkBuddyCheckinResult | null> => {
  if (!autoCheckinInflight) {
    autoCheckinInflight = runAutoCheckin().finally(() => {
      autoCheckinInflight = null
    })
  }
  return autoCheckinInflight
}
