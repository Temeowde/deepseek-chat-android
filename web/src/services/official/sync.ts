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

export type OfficialProfile = { name: string; avatar: string; account?: string; accountKind?: 'phone' | 'email' }

export const loadOfficialProfile = (): OfficialProfile => {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Partial<OfficialProfile>) : null
    return {
      name: String(parsed?.name ?? ''),
      avatar: String(parsed?.avatar ?? ''),
      account: String(parsed?.account ?? ''),
      accountKind: parsed?.accountKind === 'phone' || parsed?.accountKind === 'email' ? parsed.accountKind : undefined,
    }
  } catch {
    return { name: '', avatar: '' }
  }
}

const maskEmail = (value: string): string => {
  const at = value.indexOf('@')
  if (at <= 0) return value
  const local = value.slice(0, at)
  const shown = local.length <= 3 ? local.slice(0, 1) : local.slice(0, 3)
  return shown + '*****' + local.slice(-2) + value.slice(at)
}

const maskPhone = (value: string): string => {
  const digits = value.replace(/[^0-9+]/g, '')
  if (digits.length < 7) return value
  return digits.slice(0, 3) + '******' + digits.slice(-2)
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
      if (!out.name && /^(name|nickname|display_name|given_name)$/.test(name) && child.length < 60 && child.indexOf('@') < 0) {
        out.name = child
      }
      if (!out.account && /^(email|mail)$/.test(name) && child.indexOf('@') > 0) {
        out.account = maskEmail(child)
        out.accountKind = 'email'
      }
      if (!out.account && /^(mobile|mobile_number|phone|phone_number|telephone|tel)$/.test(name)
          && child.replace(/[^0-9]/g, '').length >= 7) {
        out.account = maskPhone(child)
        out.accountKind = 'phone'
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
        account: found.account || current.account,
        accountKind: found.accountKind || current.accountKind,
      }
      if (next.name || next.avatar || next.account) {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(next))
        return next
      }
    }
  } catch {
    // 网络失败时继续用旧资料。
  }
  return current
}

/**
 * 官方朗读音色清单。
 *
 * 官方 app 的音色不是写死的：它把 /api/v0/chat/tts/voices 的结果缓存在
 * key_tts_voice_list 里（这两条都能从官方 APK 的 dex 字符串表确认）。
 * 我们之前只硬编码了 stella（海星）和 tide（暗潮）两个，所以设置页一直少两个——
 * 官方是 4 个（官方设置页「朗读音色」面板底部就是 4 个圆点）。
 *
 * 这里做三件事：
 *  1. 有官方登录态时调接口拿真实清单；
 *  2. 结果缓存到 localStorage，下次启动先用缓存立即渲染（不阻塞首屏）；
 *  3. 接口返回结构做防御式解析（官方字段名可能是 voices / voice_list，
 *     id 可能是 voice_id / id），解析不出就退回内置默认项。
 */
export type OfficialTtsVoice = { id: string; name: string; desc: string }

const TTS_VOICES_KEY = 'chat-demo:official-tts-voices:v2'

/** 内置兜底：接口拿不到时至少这两项可用（对应 /v1/tools/tts 的 voice_id）。 */
export const BUILTIN_TTS_VOICES: OfficialTtsVoice[] = [
  { id: 'mira', name: '贝壳', desc: '百变活泼' },
  { id: 'echo', name: '白浪', desc: '明朗坚定' },
  { id: 'stella', name: '海星', desc: '俏皮甜美' },
  { id: 'tide', name: '暗潮', desc: '低沉浑厚' },
]

/*
 * 公开 TTS API（api.deepseek.com/v1/tools/tts，用用户自己的 API Key）
 * 的 voice_id 枚举只有 stella / tide。mira、echo 是官方 App 内部链路
 * （/api/v0/chat/tts/ + 一次性 ticket）才有的音色。
 * 所以设置页四个都列出来（与官方一致），但朗读时要回退到可用的音色。
 */
export const API_KEY_TTS_VOICES: ReadonlyArray<string> = ['stella', 'tide']

const pickString = (obj: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

/**
 * 官方音色接口把名字和描述放在 i18n 对象里，例如
 *   name_i18n: { zh: '贝壳', en: 'Mira', ... }
 * 所以不能只按字符串取，要先按语言优先级找中文，再退化到任意语言。
 */
const pickI18n = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const order = ['zh', 'zh-CN', 'zh_cn', 'zh-Hans', 'zh-Hant', 'zh-TW', 'en', 'en-US']
    for (const key of order) {
      const text = record[key]
      if (typeof text === 'string' && text.trim()) {
        return text.trim()
      }
    }
    for (const text of Object.values(record)) {
      if (typeof text === 'string' && text.trim()) {
        return text.trim()
      }
    }
  }
  return ''
}

/** 从接口返回体里尽力抽出音色数组；抽不到返回 null。 */
const parseVoices = (body: string): OfficialTtsVoice[] | null => {
  let root: unknown
  try {
    root = JSON.parse(body)
  } catch {
    return null
  }
  if (!root || typeof root !== 'object') {
    return null
  }
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

  const top = asRecord(root)
  const data = top ? asRecord(top.data) : null
  const biz = data ? asRecord(data.biz_data) : null
  const holders = [biz, data, top].filter((item): item is Record<string, unknown> => item !== null)
  const arrayKeys = ['voices', 'voice_list', 'voiceList', 'tts_voices', 'list']
  let raw: unknown = null
  for (const holder of holders) {
    for (const key of arrayKeys) {
      if (Array.isArray(holder[key])) {
        raw = holder[key]
        break
      }
    }
    if (raw) {
      break
    }
  }
  if (!Array.isArray(raw)) {
    return null
  }
  const voices: OfficialTtsVoice[] = []
  for (const item of raw) {
    const record = asRecord(item)
    if (!record) {
      continue
    }
    const id = pickString(record, ['voice_id', 'voiceId', 'id', 'key'])
    if (!id) {
      continue
    }
    voices.push({
      id,
      name:
        pickI18n(record['name_i18n']) ||
        pickI18n(record['display_name_i18n']) ||
        pickString(record, ['name', 'display_name', 'displayName', 'title', 'label']) ||
        id,
      desc:
        pickI18n(record['description_i18n']) ||
        pickI18n(record['desc_i18n']) ||
        pickString(record, ['description', 'desc', 'subtitle', 'sub_title', 'tagline']),
    })
  }
  return voices.length ? voices : null
}

/** 读缓存（同步，供首屏立即渲染）。 */
export const loadCachedTtsVoices = (): OfficialTtsVoice[] => {
  try {
    const raw = localStorage.getItem(TTS_VOICES_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    if (Array.isArray(parsed)) {
      const voices = parsed.filter(
        (item): item is OfficialTtsVoice =>
          !!item && typeof item === 'object' && typeof (item as OfficialTtsVoice).id === 'string'
      )
      if (voices.length) {
        return voices
      }
    }
  } catch {
    /* 缓存坏了就当没有 */
  }
  return BUILTIN_TTS_VOICES
}

let voicesPromise: Promise<OfficialTtsVoice[]> | null = null

/** 拉官方音色清单；失败时退回缓存/内置，不会抛。 */
export const fetchTtsVoices = (force = false): Promise<OfficialTtsVoice[]> => {
  if (!force && voicesPromise) {
    return voicesPromise
  }
  voicesPromise = (async () => {
    const fallback = loadCachedTtsVoices()
    if (!officialHasToken()) {
      return fallback
    }
    try {
      const response = await officialGet('/api/v0/chat/tts/voices')
      const voices = parseVoices(response.body)
      if (voices && voices.length) {
        try {
          localStorage.setItem(TTS_VOICES_KEY, JSON.stringify(voices))
        } catch {
          /* 存不下也不影响本次使用 */
        }
        return voices
      }
    } catch {
      /* 网络/桥失败就用缓存 */
    }
    return fallback
  })()
  return voicesPromise
}

export type OfficialFacade = {
  supported: boolean
  hasToken: () => boolean
  login: () => void
  logout: () => void
  sync: () => Promise<boolean>
  passwordLogin: (account: string, password: string) => Promise<boolean>
  profile: () => OfficialProfile
  /** 官方 TTS 音色清单（从 /api/v0/chat/tts/voices 拉，带缓存）。 */
  ttsVoices: () => Promise<OfficialTtsVoice[]>
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
    ttsVoices: () => fetchTtsVoices(),
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
