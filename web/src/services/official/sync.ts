import * as db from '../chat/db.js'
import { useChatStore } from '../chat/store.js'
import type { AssistantMessage, Message, ReplyBlock, Session, SessionSummary } from '../chat/types.js'
import { officialAvailable, officialGet, officialHasToken, officialLogin, officialLogout, officialPasswordLogin } from './bridge.js'

/** 官方会话在本地用固定前缀区分，例如 off_<官方 id>。 */
export const OFFICIAL_PREFIX = 'off_'
export const isOfficialSessionId = (id: string): boolean => id.startsWith(OFFICIAL_PREFIX)
const officialIdOf = (id: string): string => id.slice(OFFICIAL_PREFIX.length)

type OfficialSession = {
  id: string
  title?: string
  updated_at?: number
  pinned?: boolean
}

type OfficialFragment = {
  id?: number
  type?: string
  content?: string
}

type OfficialMessage = {
  message_id?: string | number
  parent_id?: string | number | null
  role?: string
  inserted_at?: number
  status?: string
  fragments?: OfficialFragment[]
  content?: string
}

const signed = (value: string | number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value)

/** 接口统一包一层 data.biz_data，取不到时退回 data 本身。 */
const bizData = (body: string): Record<string, unknown> | null => {
  try {
    const root = JSON.parse(body) as { code?: number; data?: { biz_data?: unknown } }
    if (root && root.code !== undefined && root.code !== 0) {
      return null
    }
    const data = root?.data
    if (data && typeof data === 'object' && data.biz_data && typeof data.biz_data === 'object') {
      return data.biz_data as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

const fetchSessionPage = async (pinned: boolean, cursor = nowSeconds()): Promise<OfficialSession[]> => {
  const response = await officialGet(
    `/api/v0/chat_session/fetch_page?count=100&lte_cursor.pinned=${pinned}` +
      `&lte_cursor.updated_at=${cursor}`
  )
  const data = bizData(response.body)
  const sessions = data?.chat_sessions
  return Array.isArray(sessions) ? (sessions as OfficialSession[]) : []
}

const summariesFrom = (sessions: OfficialSession[]): SessionSummary[] =>
  sessions
    .filter((session) => session && session.id)
    .map((session) => {
      const updatedAt = (session.updated_at ?? 0) * 1000
      return {
        id: OFFICIAL_PREFIX + session.id,
        title: (session.title || '新对话').trim(),
        pinned: session.pinned === true,
        createdAt: updatedAt,
        updatedAt,
      }
    })

/** 拉取官方会话列表，把摘要写进本地列表；不下载消息。 */
export const syncOfficialSummaries = async (): Promise<boolean> => {
  if (!officialHasToken()) {
    return false
  }
  try {
    const [unpinned, pinned] = await Promise.all([
      fetchSessionPage(false),
      fetchSessionPage(true),
    ])
    const summaries = summariesFrom([...unpinned, ...pinned])
    for (const summary of summaries) {
      await db.saveSummary(summary)
    }
    await useChatStore.getState().reloadSummaries()
    return true
  } catch {
    return false
  }
}

const fragmentText = (message: OfficialMessage, types: string[]): string =>
  (message.fragments ?? [])
    .filter((fragment) => types.includes(String(fragment.type ?? '')))
    .map((fragment) => (typeof fragment.content === 'string' ? fragment.content : ''))
    .filter(Boolean)
    .join('')

const messageIdOf = (message: OfficialMessage): string => 'o_' + signed(message.message_id)

const convertMessage = (message: OfficialMessage): Message | null => {
  const role = String(message.role ?? '').toUpperCase()
  const parentId = message.parent_id === null || message.parent_id === undefined
    ? undefined
    : 'o_' + signed(message.parent_id)
  const createdAt = (message.inserted_at ?? 0) * 1000 || Date.now()

  if (role === 'USER') {
    const content = fragmentText(message, ['REQUEST']) || message.content || ''
    return {
      id: messageIdOf(message),
      role: 'user',
      content,
      files: [],
      createdAt,
      ...(parentId ? { parentId } : {}),
    }
  }

  if (role === 'ASSISTANT') {
    const thinking = fragmentText(message, ['THINK'])
    const text = fragmentText(message, ['RESPONSE', 'TEMPLATE_RESPONSE'])
    const blocks: ReplyBlock[] = []
    if (thinking) {
      blocks.push({ type: 'thinking', thinking })
    }
    if (text) {
      blocks.push({ type: 'text', text })
    }
    const reply: AssistantMessage = {
      id: messageIdOf(message),
      role: 'assistant',
      createdAt,
      model: null,
      prefix: true,
      status: 'done',
      blocks,
      ...(parentId ? { parentId } : {}),
    }
    return reply
  }

  return null
}

const convertSession = (officialId: string, data: Record<string, unknown>, summary?: SessionSummary): Session => {
  const messages = (Array.isArray(data.chat_messages) ? (data.chat_messages as OfficialMessage[]) : [])
    .map(convertMessage)
    .filter((message): message is Message => message !== null)
  const first = messages[0]?.createdAt ?? Date.now()
  const last = messages[messages.length - 1]?.createdAt ?? first
  return {
    id: OFFICIAL_PREFIX + officialId,
    title: summary?.title ?? '新对话',
    pinned: summary?.pinned,
    createdAt: summary?.createdAt ?? first,
    updatedAt: summary?.updatedAt ?? last,
    messages,
  }
}

/** 打开官方会话时调用：拉取完整消息，保留本地 API 续聊的内容。 */
export const loadOfficialSession = async (id: string): Promise<Session | undefined> => {
  const officialId = officialIdOf(id)
  const response = await officialGet(
    `/api/v0/chat/history_messages?chat_session_id=${encodeURIComponent(officialId)}`
  )
  const data = bizData(response.body)
  if (!data) {
    return undefined
  }
  const existing = await db.loadSession(id)
  const summary = useChatStore.getState().sessions.find((item) => item.id === id)
  const session = convertSession(officialId, data, summary)
  if (existing) {
    const known = new Set(session.messages.map((message) => message.id))
    const localOnly = existing.messages.filter((message) => !known.has(message.id))
    // 官方消息保持服务器返回的顺序；本地 API 续聊按时间插到对应位置。
    const merged = [...session.messages]
    for (const message of localOnly) {
      let index = merged.length
      for (let i = merged.length - 1; i >= 0; i--) {
        if (merged[i].createdAt <= message.createdAt) {
          index = i + 1
          break
        }
        index = i
      }
      merged.splice(index, 0, message)
    }
    session.messages = merged
    session.updatedAt = Math.max(session.updatedAt, existing.updatedAt)
  }
  await db.saveSession(session)
  return session
}

const PROFILE_KEY = 'chat-demo:official-profile'

export type OfficialProfile = { name: string; avatar: string }

export const loadOfficialProfile = (): OfficialProfile => {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<OfficialProfile>) : null
    return { name: String(parsed?.name ?? ''), avatar: String(parsed?.avatar ?? '') }
  } catch {
    return { name: '', avatar: '' }
  }
}

const pickProfile = (value: unknown, out: OfficialProfile, depth: number) => {
  if (depth > 8 || value === null || typeof value !== 'object') {
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) pickProfile(item, out, depth + 1)
    return
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const name = key.toLowerCase()
    if (typeof child === 'string' && child) {
      if (!out.avatar && /avatar|picture|portrait|icon_url/.test(name) && /^https?:/.test(child)) {
        out.avatar = child
      }
      if (!out.name && /^(name|nickname|display_name|given_name)$/.test(name) && child.length < 60) {
        out.name = child
      }
    } else if (typeof child === 'string' && !out.name && name === 'email') {
      out.name = child.split('@')[0]
    } else {
      pickProfile(child, out, depth + 1)
    }
  }
}

/** 拉取官方账号的头像与昵称，失败时保留旧值。 */
export const syncOfficialProfile = async (): Promise<OfficialProfile> => {
  const current = loadOfficialProfile()
  if (!officialHasToken()) {
    return current
  }
  try {
    const response = await officialGet('/api/v0/users/current')
    const data = bizData(response.body)
    if (data) {
      const found: OfficialProfile = { name: '', avatar: '' }
      pickProfile(data, found, 0)
      const next = {
        name: found.name || current.name,
        avatar: found.avatar || current.avatar,
      }
      if (next.name || next.avatar) {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(next))
        return next
      }
    }
  } catch {
    // 网络失败时继续用旧资料。
  }
  return current
}

export type OfficialFacade = {
  supported: boolean
  hasToken: () => boolean
  login: () => void
  logout: () => void
  sync: () => Promise<boolean>
  passwordLogin: (account: string, password: string) => Promise<boolean>
  profile: () => OfficialProfile
}

/** 供原生壳里的旧脚本（mobile-history.js）调用。 */
if (typeof window !== 'undefined') {
  window.__official = {
    supported: officialAvailable(),
    hasToken: officialHasToken,
    login: officialLogin,
    logout: officialLogout,
    sync: async () => {
      const ok = await syncOfficialSummaries()
      if (ok) await syncOfficialProfile()
      return ok
    },
    passwordLogin: async (account: string, password: string) => {
      const ok = await officialPasswordLogin(account, password)
      if (ok) {
        await syncOfficialProfile()
        await syncOfficialSummaries()
        window.dispatchEvent(new Event('official-account-changed'))
      }
      return ok
    },
    profile: loadOfficialProfile,
  }
}

/** 绑定官方会话加载器；返回注销函数。 */
export const registerOfficialSync = () => {
  useChatStore.getState().setOfficialLoader(loadOfficialSession)
  if (officialHasToken()) {
    void syncOfficialSummaries()
    void syncOfficialProfile()
  }
}
