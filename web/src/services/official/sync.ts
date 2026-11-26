import * as db from '../chat/db.js'
import { useChatStore } from '../chat/store.js'
import type { AssistantMessage, FileAttachment, Message, ReplyBlock, Session, SessionSummary } from '../chat/types.js'
import { officialAvailable, officialGet, officialHasToken, officialLogin, officialLogout, officialPasswordLogin } from './bridge.js'
import { useSettings } from '../settings.js'

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

/*
 * 官方消息片段。FILE 片段承载附件：schema 见 APK 反编译的
 * StaticChatMessageFileFragmentSerializer.FileFragmentSurrogate（type/id/files）
 * 与 AppChatFile（file_name/file_size/is_image/signed_path）。
 */
type OfficialFile = {
  id?: string | number
  status?: string
  file_name?: string
  file_size?: number
  is_image?: boolean
  /** 官方 CDN 上的原件地址，只有带令牌的原生通道拿不到；前端用普通 fetch / img 取。 */
  signed_path?: string
}

type OfficialFragment = {
  id?: number
  type?: string
  content?: string
  files?: OfficialFile[]
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

const fetchSessionPage = async (
  pinned: boolean,
  cursor = nowSeconds()
): Promise<{ sessions: OfficialSession[]; hasMore: boolean }> => {
  const response = await officialGet(
    `/api/v0/chat_session/fetch_page?count=100&lte_cursor.pinned=${pinned}` +
      `&lte_cursor.updated_at=${cursor}`
  )
  const data = bizData(response.body)
  const sessions = Array.isArray(data?.chat_sessions) ? (data.chat_sessions as OfficialSession[]) : []
  return { sessions, hasMore: data?.has_more === true }
}

/** 单次同步最多翻多少页（每页 100 条），防止异常数据无限翻页 */
const MAX_SESSION_PAGES = 100

/**
 * 翻页拉完所有官方会话。
 *
 * 官方接口一页只给 100 条 —— 以前只请求第一页，所以「登录后只看到最近一个月」。
 * 这里用 `lte_cursor.updated_at` 取上一页最旧的时间戳继续往外翻，按 id 去重，
 * 直到 has_more=false 或没有新会话为止。
 */
const fetchAllSessionPages = async (pinned: boolean): Promise<OfficialSession[]> => {
  const collected = new Map<string, OfficialSession>()
  let cursor = nowSeconds()
  for (let page = 0; page < MAX_SESSION_PAGES; page += 1) {
    const { sessions, hasMore } = await fetchSessionPage(pinned, cursor)
    let oldest = cursor
    let fresh = 0
    for (const session of sessions) {
      if (!session || !session.id) {
        continue
      }
      if (!collected.has(session.id)) {
        collected.set(session.id, session)
        fresh += 1
      }
      const updatedAt = Number(session.updated_at ?? 0)
      if (updatedAt > 0 && updatedAt < oldest) {
        oldest = updatedAt
      }
    }
    if (!hasMore || fresh === 0 || oldest >= cursor) {
      break
    }
    cursor = oldest
    // 翻页之间留间隔，避免把官方接口打满
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  return [...collected.values()]
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

/** 最近一次官方同步失败原因（供 UI / 导出提示），成功后清空。 */
let lastSyncError = ''
export const lastOfficialSyncError = (): string => lastSyncError

/** 拉取官方会话列表，把摘要写进本地列表；不下载消息。 */
export const syncOfficialSummaries = async (): Promise<boolean> => {
  if (!officialHasToken()) {
    return false
  }
  try {
    const [unpinned, pinned] = await Promise.all([
      fetchAllSessionPages(false),
      fetchAllSessionPages(true),
    ])
    const summaries = summariesFrom([...unpinned, ...pinned])
    for (const summary of summaries) {
      await db.saveSummary(summary)
    }
    await collapseDuplicateSummaries()
    await useChatStore.getState().reloadSummaries()
    // 后台把会话内容补进本地缓存：只补缺的/有更新的，不阻塞界面
    void warmOfficialCache()
    lastSyncError = ''
    return true
  } catch (error) {
    lastSyncError = error instanceof Error ? error.message : String(error)
    return false
  }
}

/**
 * 折叠重复会话。
 *
 * 同一个官方会话在本地可能有两个 id：导入归档带来的裸 id，和官方同步写的 off_<id>。
 * 列表按 id 一行一条，所以会并排出现两个同名会话。这里按"去掉 off_ 前缀后的身份"分组，
 * 保留官方那一份，删掉导入的裸 id 副本（内容是同一段对话，官方会在打开时重新拉取完整消息）。
 */
const collapseDuplicateSummaries = async (): Promise<boolean> => {
  const summaries = await db.loadSessionSummaries()
  const groups = new Map<string, string[]>()
  for (const summary of summaries) {
    const identity = summary.id.startsWith(OFFICIAL_PREFIX)
      ? summary.id.slice(OFFICIAL_PREFIX.length)
      : summary.id
    const ids = groups.get(identity)
    if (ids) {
      ids.push(summary.id)
    } else {
      groups.set(identity, [summary.id])
    }
  }
  const { sessionsEquivalent } = await import('../chat/history/mergeSession.js')
  let removed = false
  for (const ids of groups.values()) {
    if (ids.length < 2) {
      continue
    }
    const official = ids.find((id) => id.startsWith(OFFICIAL_PREFIX))
    if (!official) {
      continue
    }
    /*
     * 只有「所有消息逐条完全一致」才把导入的裸 id 副本删掉。
     *
     * 之前是见到同名就删 —— 如果导入的存档里比官方账号多聊了几轮
     * （导出的官方会话 + 导入后继续聊），这些多出来的消息会随副本一起消失。
     * 现在多一轮都不一样就保留两份，宁可列表里两条也不丢内容。
     */
    const officialSession = await db.loadSession(official)
    if (!officialSession) {
      continue
    }
    for (const id of ids) {
      if (id === official) {
        continue
      }
      const duplicate = await db.loadSession(id)
      if (!duplicate) {
        // 没有消息体的空壳副本，可以直接清理
        await db.deleteSession(id)
        removed = true
        continue
      }
      if (!sessionsEquivalent(officialSession, duplicate)) {
        continue
      }
      await db.deleteSession(id)
      removed = true
    }
  }
  return removed
}

const fragmentText = (message: OfficialMessage, types: string[]): string =>
  (message.fragments ?? [])
    .filter((fragment) => types.includes(String(fragment.type ?? '')))
    .map((fragment) => (typeof fragment.content === 'string' ? fragment.content : ''))
    .filter(Boolean)
    .join('')

const messageIdOf = (message: OfficialMessage): string => 'o_' + signed(message.message_id)

/*
 * 官方附件的本地 id 前缀。官方 file id 与我们 DeepSeek Files API 的 file_id 不是一套，
 * 所以：id 加 of_ 前缀避免和本地/归档附件撞；serverId 一律 null（不能混用）。
 * 前缀固定，重复同步同一张图得到的 id 不变，原件可以继续命中 IndexedDB。
 */
const OFFICIAL_FILE_PREFIX = 'of_'

/** 官方 CDN 主机（APK 里的 files_host 默认值）；signed_path 只有路径时按它拼完整地址。 */
const OFFICIAL_FILES_HOST = 'files.deepseeksvc.com'

/** 官方附件常见扩展名的 MIME；识别不出时留空，图片身份仍由 is_image 决定。 */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
}

const mimeByName = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? (MIME_BY_EXT[name.slice(dot + 1).toLowerCase()] ?? '') : ''
}

/** URL 加查询参数（官方 cl()：已带 ? 就用 &）。 */
const withQuery = (url: string, key: string, value: string): string =>
  url + (url.includes('?') ? '&' : '?') + key + '=' + value

/** 官方 web 端 d6()：WebView 支持 webp 时不传 fmt，否则退回 jpeg。 */
const thumbFormat = (): string | undefined => {
  try {
    const canvas = document.createElement('canvas')
    return canvas.toDataURL('image/webp').startsWith('data:image/webp') ? undefined : 'jpeg'
  } catch {
    return undefined
  }
}

/**
 * signed_path → 可直接访问的 CDN 地址。
 *
 * 官方 web 端 cu({signedPath, type}) 的逻辑（bundle 里逐字对照）：
 *   https://{files_host}/api{signed_path}?ty={t|p}[&fmt=jpeg]
 * 注意两点，之前没对上所以图片 403/无法打开：
 *   1. 域名后面有 /api 前缀
 *   2. 查询参数名是 ty（不是 type），t=缩略图、p=原图
 */
const signedUrl = (value: string, kind: 't' | 'p'): string => {
  const path = value.trim()
  if (!path) {
    return ''
  }
  const base = /^https?:\/\//i.test(path)
    ? path
    : path.startsWith('//')
      ? 'https:' + path
      : 'https://' +
        OFFICIAL_FILES_HOST +
        '/api' +
        (path.startsWith('/') ? path : '/' + path)
  let url = withQuery(base, 'ty', kind)
  const fmt = thumbFormat()
  if (fmt) {
    url = withQuery(url, 'fmt', fmt)
  }
  return url
}

/** 官方文件 id 缺失时用文件名+地址生成稳定标识，保证重复同步得到同一 id。 */
const stableFileKey = (file: OfficialFile): string => {
  const raw = signed(file.id) || signed(file.file_name) + '|' + signed(file.signed_path)
  let hash = 0
  for (let index = 0; index < raw.length; index++) {
    hash = (hash * 31 + raw.charCodeAt(index)) | 0
  }
  return (hash >>> 0).toString(36) + '_' + raw.length
}

/** FILE 片段 -> 本地附件。signed_path 留在 remoteUrl，供打开会话时懒下载原件。 */
const toFileAttachment = (file: OfficialFile): FileAttachment | null => {
  const name = String(file.file_name ?? '').trim()
  const signedPath = String(file.signed_path ?? '')
  // 原图用于补下原件 / 发送；缩略图用于列表展示（官方也是分开的）。
  const remoteUrl = signedUrl(signedPath, 'p')
  const remoteThumbUrl = signedUrl(signedPath, 't')
  const id = signed(file.id)
  if (!name && !remoteUrl && !id) {
    return null
  }
  const localId = OFFICIAL_FILE_PREFIX + (id || stableFileKey(file))
  const size = typeof file.file_size === 'number' && file.file_size > 0 ? file.file_size : 0
  return {
    id: localId,
    serverId: null,
    name: name || localId,
    size,
    isImage: file.is_image === true,
    mimeType: mimeByName(name),
    ...(remoteUrl ? { remoteUrl } : {}),
    ...(remoteThumbUrl ? { remoteThumbUrl } : {}),
  }
}

/** 一条消息里所有 FILE 片段的附件。 */
const messageFiles = (message: OfficialMessage): FileAttachment[] => {
  const files: FileAttachment[] = []
  for (const fragment of message.fragments ?? []) {
    if (String(fragment.type ?? '').toUpperCase() !== 'FILE') {
      continue
    }
    for (const entry of fragment.files ?? []) {
      const attachment = toFileAttachment(entry)
      if (attachment && !files.some((item) => item.id === attachment.id)) {
        files.push(attachment)
      }
    }
  }
  return files
}

const convertMessage = (message: OfficialMessage): Message | null => {
  const role = String(message.role ?? '').toUpperCase()
  /*
   * 根消息的 parent_id 是 null。本地模型（branches.normalizeSession、归档导入）统一写 null，
   * 这里以前省略成 undefined，导致官方会话的根分支切换/搜索定位判断不到「根」。
   */
  const parentId = message.parent_id === null || message.parent_id === undefined
    ? null
    : 'o_' + signed(message.parent_id)
  const createdAt = (message.inserted_at ?? 0) * 1000 || Date.now()

  if (role === 'USER') {
    const content = fragmentText(message, ['REQUEST']) || message.content || ''
    return {
      id: messageIdOf(message),
      role: 'user',
      content,
      // 以前硬编码 []，官方会话里的图片/附件整段丢失；现在从 FILE 片段还原。
      files: messageFiles(message),
      createdAt,
      parentId,
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
      parentId,
    }
    return reply
  }

  return null
}

/*
 * 官方历史消息是「树」：每条消息只有 message_id 和 parent_id，
 * 同一个 parent 下有多条 child 就代表「重新生成」出来的多个分支。
 * 会话的 chat_session.current_message_id 指向用户当前停留的那条消息，
 * 从它沿 parent 链上溯就是应该显示的那条路径。
 *
 * 不稳着建树的话，messages 会退化成一条线性列表（我们的 normalizeSession 也会按顺序重写
 * parentId），于是官方 App 里的分支在这里变成一段一段平铺出来的"重新生成的回答"。
 */
const buildBranchTree = (messages: Message[], startId?: string): { messages: Message[]; rootMessageId?: string } => {
  const ids = new Set(messages.map((message) => message.id))
  const children = new Map<string, string[]>()
  // 多个根消息 = 会话第一问的多个版本（官方编辑第一条提问后就是这种树）。
  // 这里按服务器数组顺序收集根，默认显示第一个，current_message_id 落在那条根分支时再改。
  const roots: string[] = []
  for (const message of messages) {
    const parentId =
      message.parentId && ids.has(message.parentId) ? message.parentId : undefined
    if (!parentId) {
      roots.push(message.id)
      continue
    }
    const siblings = children.get(parentId)
    if (siblings) {
      siblings.push(message.id)
    } else {
      children.set(parentId, [message.id])
    }
  }
  let rootMessageId = roots[0]
  if (!rootMessageId) {
    return { messages }
  }
  const selected = new Map<string, string | undefined>()
  // 默认选中第一个子消息（服务器按创建顺序返回，第一个就是最早生成的那条）。
  for (const [parentId, siblings] of children) {
    selected.set(parentId, siblings[0])
  }
  const byId = new Map(messages.map((message) => [message.id, message]))
  const start = startId
  if (start && byId.has(start)) {
    let cursor: string | undefined = start
    while (cursor) {
      const message = byId.get(cursor)
      if (!message) {
        break
      }
      const parentId: string | undefined =
        message.parentId && ids.has(message.parentId) ? message.parentId : undefined
      if (parentId) {
        selected.set(parentId, cursor)
      } else {
        // 官方 current_message_id 属于哪条根分支，就显示哪条根分支；
        // 其余根版本由分支切换器提供（以前固定取第一个根，点和显示会对不上）。
        rootMessageId = cursor
      }
      cursor = parentId
    }
    /*
     * 当前消息之后的子消息不显示：停在当前节点上。
     *
     * 但有一个例外，也是「最后只同步过来一句用户消息、没有 AI 回复」的根因：
     * 官方的 chat_session.current_message_id 在「用户发问、AI 已回复」之后仍可能停在
     * 那条用户消息上（它记录的是会话游标，不是最后一条消息）。此时直接停在用户消息上，
     * 它下面的 assistant 回复就被当成"未选中的子分支"隐藏了 —— 表现为最后一轮只有提问。
     *
     * 所以：当前节点是用户消息时，继续下钻到它最新的那条回复（用户消息永远不会是
     * 一个合理的显示终点）。若当前节点是 assistant，则说明用户主动停留在这里看分支，
     * 保持不动。
     */
    let tail: string | undefined = start
    while (tail) {
      const node = byId.get(tail)
      if (!node || node.role !== 'user') {
        break
      }
      const kids = children.get(tail)
      if (!kids || kids.length === 0) {
        break
      }
      // 多条回复 = 重新生成出来的分支，取最新那条（服务器按创建顺序返回）
      const next = kids[kids.length - 1]
      selected.set(tail, next)
      tail = next
    }
    selected.set(tail ?? start, undefined)
  } else {
    // 没有 current_message_id 时取最长的路径：从根一路跟着默认选中的子消息走到底。
    // 这里先把链走完、最后只在叶子节点停下；以前边走边清空选择，走两步就断了，
    // 于是没有 current_message_id 的会话只显示第一问一答。
    let cursor: string | undefined = rootMessageId
    let next = selected.get(cursor)
    while (next) {
      cursor = next
      next = selected.get(cursor)
    }
    selected.set(cursor, undefined)
  }
  return {
    messages: messages.map((message) =>
      selected.has(message.id)
        ? { ...message, selectedChildId: selected.get(message.id) }
        : message
    ),
    rootMessageId,
  }
}

const convertSession = (officialId: string, data: Record<string, unknown>, summary?: SessionSummary): Session => {
  const rawMessages = Array.isArray(data.chat_messages) ? (data.chat_messages as OfficialMessage[]) : []
  const messages = rawMessages
    .map(convertMessage)
    .filter((message): message is Message => message !== null)
  const first = messages[0]?.createdAt ?? Date.now()
  const last = messages[messages.length - 1]?.createdAt ?? first
  const chatSession = data.chat_session as { current_message_id?: number | null } | undefined
  // 官方 web 客户端的 sa()：current_message_id 缺失时取最大的 message_id，
  // 否则整棵树的「当前分支」没法定，显示的会和官方 App 对不上。
  const currentMessageId =
    typeof chatSession?.current_message_id === 'number'
      ? chatSession.current_message_id
      : rawMessages.reduce<number | undefined>((max, message) => {
          const id = typeof message.message_id === 'number' ? message.message_id : Number(message.message_id)
          return Number.isFinite(id) && (max === undefined || id > max) ? id : max
        }, undefined)
  const tree = buildBranchTree(
    messages,
    currentMessageId === undefined ? undefined : 'o_' + signed(currentMessageId)
  )
  return {
    id: OFFICIAL_PREFIX + officialId,
    title: summary?.title ?? '新对话',
    pinned: summary?.pinned,
    createdAt: summary?.createdAt ?? first,
    /*
     * 时间戳取「摘要」和「最后一条消息」的较大值：
     * 本地 API 续聊的消息官方服务器不认识，摘要里的 updated_at 会落后于真实最后活动时间。
     */
    updatedAt: Math.max(summary?.updatedAt ?? 0, last),
    messages: tree.messages,
    ...(tree.rootMessageId ? { rootMessageId: tree.rootMessageId } : {}),
  }
}

/** 一次最多补下多少张图片；失败/超限的留给下次打开，不阻塞会话展示。 */
const IMAGE_DOWNLOAD_LIMIT = 6
/** 单张图片下载超时：官方 CDN 慢或不可达时不能挂住后台任务。 */
const IMAGE_DOWNLOAD_TIMEOUT = 15000
/** 同一会话正在补下时不重复发起。 */
const downloading = new Set<string>()

/**
 * 懒下载官方会话里的图片原件。
 *
 * 官方历史消息只给 signed_path（CDN 地址），原件不在本地；这里在会话打开后，
 * 对「有 remoteUrl 但 IndexedDB 里没有原件」的图片用普通 fetch 取回并入库。
 * 限量、失败静默、不 await —— 拿不到就退回 remoteUrl 直接显示，不影响打开会话。
 */
const downloadSessionImages = async (session: Session): Promise<void> => {
  if (typeof window === 'undefined' || downloading.has(session.id)) {
    return
  }
  downloading.add(session.id)
  try {
    const pending: FileAttachment[] = []
    for (const message of session.messages) {
      if (message.role !== 'user') {
        continue
      }
      for (const file of message.files) {
        if (!file.isImage || !file.remoteUrl || pending.some((item) => item.id === file.id)) {
          continue
        }
        pending.push(file)
      }
    }
    let saved = 0
    for (const file of pending) {
      if (saved >= IMAGE_DOWNLOAD_LIMIT) {
        break
      }
      if (await db.loadFile(file.id)) {
        continue
      }
      const remoteUrl = file.remoteUrl
      if (!remoteUrl) {
        continue
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT)
      try {
        const response = await fetch(remoteUrl, { signal: controller.signal })
        if (!response.ok) {
          continue
        }
        const blob = await response.blob()
        if (blob.size === 0) {
          continue
        }
        const type = blob.type || file.mimeType
        await db.saveFiles([{ id: file.id, blob: type && blob.type !== type ? blob.slice(0, blob.size, type) : blob }])
        saved += 1
      } catch {
        // 单张失败不影响其它图片，也不影响会话展示
      } finally {
        clearTimeout(timer)
      }
    }
  } catch {
    // 补下是加分项，整体失败就算了
  } finally {
    downloading.delete(session.id)
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
    /*
     * 这里不能再静默 return undefined。
     * 服务端返回 40002/40003（登录失效）时 bizData 为空，旧代码把它当"没有内容"，
     * 导出侧于是统计成几百个「本地没有内容」，用户完全看不出是登录问题。
     */
    throw new Error(
      response.status === 200
        ? '官方接口返回空内容（可能是登录已失效或请求被拦截）'
        : `官方接口返回 HTTP ${response.status}`
    )
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
    /*
     * 合并完本地续聊消息后重建一次分支选中链：
     * 本地续聊挂在官方最后一条消息下面，用户回到会话时应该停在最新那条上。
     */
    const newest = merged.reduce<Message | undefined>(
      (best, message) => (!best || message.createdAt >= best.createdAt ? message : best),
      undefined
    )
    if (newest) {
      const tree = buildBranchTree(merged, newest.id)
      session.messages = tree.messages
      if (tree.rootMessageId) {
        session.rootMessageId = tree.rootMessageId
      }
    }
    session.updatedAt = Math.max(session.updatedAt, existing.updatedAt)
  }
  await db.saveSession(session)
  // 图片原件走普通 fetch 从 CDN 补下，后台进行，不阻塞本次打开。
  void downloadSessionImages(session)
  return session
}

/**
 * 缓存预热：把官方会话的消息抓下来存本地。
 *
 * 官方同步以前只拿「会话列表摘要」，消息体要等用户点开才去服务器拉 ——
 * 所以列表能看、点进去每次都要等。这里在同步完成后，按更新时间从新到旧，
 * 只补「本地没有或服务端更新」的会话，串行并留间隔，避免一次性打满网络/存储。
 */
/**
 * 补齐「只有摘要没有正文」的官方会话。
 *
 * 官方同步默认只写列表摘要，正文要打开会话才拉取 —— 于是导出、离线、搜索都是空的。
 * 这里在后台按更新时间从新到旧慢慢补，限流 300ms/次、每轮最多 limit 个，
 * 已经在本地有正文的跳过。失败静默（下次启动继续）。
 */
export const backfillMissingBodies = async (limit = 120): Promise<void> => {
  if (!officialHasToken()) {
    return
  }
  try {
    const summaries = await db.loadSessionSummaries()
    const targets = summaries
      .filter((summary) => summary.id.startsWith(OFFICIAL_PREFIX))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, limit)
    /*
     * 并发 3 补齐：串行 300ms 一个，735 个会话要 20+ 分钟太慢。
     * 官方接口是普通 REST，3 路并发 + 每个任务起步间隔 120ms 比较稳。
     */
    const workers = 3
    let cursor = 0
    const runWorker = async () => {
      while (true) {
        const index = cursor
        cursor += 1
        const summary = targets[index]
        if (!summary) {
          return
        }
        try {
          const stored = await db.loadSession(summary.id)
          if (!stored || stored.messages.length === 0) {
            await loadOfficialSession(summary.id)
          }
        } catch {
          // 单个失败不影响其它，下次启动再补
        }
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
    }
    await Promise.all(Array.from({ length: workers }, () => runWorker()))
  } catch {
    // 补齐是后台加分项，失败就算了
  }
}

export const warmOfficialCache = async (limit = 400): Promise<void> => {
  try {
    const summaries = await db.loadSessionSummaries()
    const targets = summaries
      .filter((summary) => summary.id.startsWith(OFFICIAL_PREFIX))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit)
    for (const summary of targets) {
      try {
        const stored = await db.loadSession(summary.id)
        if (stored && stored.updatedAt >= summary.updatedAt) {
          continue
        }
        await loadOfficialSession(summary.id)
      } catch {
        // 单个会话失败不影响其它
      }
      await new Promise((resolve) => setTimeout(resolve, 80))
    }
  } catch {
    // 预热是加分项，失败就算了
  }
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
/**
 * 官方音色调色板。APK 里是 ServerTtsVoice.color_palette{c1,c2,c3}
 * （→ TtsVoicePalette(base, flow, highlight)），三个 hex 字符串。
 * 也兼容数组形式和 c1/c2/c3 直接挂在 voice 上的情况。
 */
const pickPalette = (record: Record<string, unknown>): string[] | undefined => {
  const raw = record['color_palette'] ?? record['colorPalette'] ?? record['palette']
  const collect = (value: unknown): string[] | undefined => {
    if (Array.isArray(value)) {
      const list = value.filter((item): item is string => typeof item === 'string' && item.length > 0)
      return list.length === 3 ? list : undefined
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined
    }
    const obj = value as Record<string, unknown>
    const c1 = obj['c1'] ?? obj['base'] ?? obj['1']
    const c2 = obj['c2'] ?? obj['flow'] ?? obj['2']
    const c3 = obj['c3'] ?? obj['highlight'] ?? obj['3']
    if (typeof c1 === 'string' && typeof c2 === 'string' && typeof c3 === 'string') {
      return [c1, c2, c3]
    }
    return undefined
  }
  const fromObject = collect(raw)
  if (fromObject) {
    return fromObject
  }
  const c1 = record['c1']
  const c2 = record['c2']
  const c3 = record['c3']
  if (typeof c1 === 'string' && typeof c2 === 'string' && typeof c3 === 'string') {
    return [c1, c2, c3]
  }
  return undefined
}

export type OfficialTtsVoice = {
  id: string
  name: string
  desc: string
  /** 官方下发的声音调色板 color_palette{c1,c2,c3}，拿不到时前端用内置色兜底 */
  palette?: string[]
  /** 官方每个音色的试听音频（按语言），切换音色时播放——官方 App 同款行为 */
  demoUrls?: Record<string, string>
}

const TTS_VOICES_KEY = 'chat-demo:official-tts-voices:v3'

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

/** 官方音色试听地址：demo_urls 是 {语言: mp3} 映射。 */
const pickDemoUrls = (record: Record<string, unknown>): Record<string, string> | undefined => {
  const raw = record['demo_urls'] ?? record['demoUrls']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  const out: Record<string, string> = {}
  for (const [lang, url] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof url === 'string' && /^https?:/.test(url)) {
      out[lang] = url
    }
  }
  return Object.keys(out).length ? out : undefined
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
      // 官方下发的三色调色板，缺失时前端按 id 回落到内置色
      palette: pickPalette(record),
      demoUrls: pickDemoUrls(record),
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

/* ---------------- 音色试听 ---------------- */

let demoAudio: HTMLAudioElement | null = null

const pickDemoUrl = (voice: OfficialTtsVoice): string | undefined => {
  const urls = voice.demoUrls
  if (!urls) {
    return undefined
  }
  const locale = (typeof window !== 'undefined' && window.chatDisplayPrefs?.read?.('locale', 'zh-CN')) || 'zh-CN'
  const order = String(locale).toLowerCase().startsWith('zh')
    ? ['zh', 'zh-CN', 'zh_cn', 'zh-Hans', 'zh-Hant', 'en', 'en-US']
    : ['en', 'en-US', 'zh', 'zh-CN']
  for (const key of order) {
    if (urls[key]) {
      return urls[key]
    }
  }
  return Object.values(urls)[0]
}

/**
 * 播放某个音色的官方试听句（切换音色时自动调用，和官方 App 一致）。
 * 音频是官方 CDN 上的 mp3，不需要登录态。
 */
export const playTtsVoiceDemo = async (voiceId: string): Promise<boolean> => {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    return false
  }
  if (demoAudio) {
    try {
      demoAudio.pause()
    } catch {
      // 忽略
    }
    demoAudio = null
  }
  let voice = loadCachedTtsVoices().find((item) => item.id === voiceId)
  if (!voice?.demoUrls) {
    // 缓存里没有试听地址（旧版本缓存）：拉一次最新的
    const list = await fetchTtsVoices(true)
    voice = list.find((item) => item.id === voiceId)
  }
  const url = voice ? pickDemoUrl(voice) : undefined
  if (!url) {
    return false
  }
  try {
    const audio = new Audio(url)
    audio.preload = 'auto'
    demoAudio = audio
    audio.onended = () => {
      if (demoAudio === audio) {
        demoAudio = null
      }
    }
    await audio.play()
    return true
  } catch {
    return false
  }
}

/** 当前正在试听的音色（供 UI 高亮/停止）。 */
export const stopTtsVoiceDemo = () => {
  if (demoAudio) {
    try {
      demoAudio.pause()
    } catch {
      // 忽略
    }
    demoAudio = null
  }
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
  /** 播放某个音色的官方试听句（切换音色时自动调用；官方 CDN mp3，不需要登录）。 */
  playVoiceDemo: (voiceId: string) => Promise<boolean>
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
    playVoiceDemo: (voiceId: string) => playTtsVoiceDemo(voiceId),
  }
}

/**
 * 音色切换自动试听：官方 App 在设置里每切到一个音色就会说一句话。
 * 这里订阅设置状态，任何人（桌面设置页 / 手机设置页）改 ttsVoice 都会触发。
 */
let demoWatchStarted = false
export const registerVoiceDemoWatcher = () => {
  if (demoWatchStarted) {
    return
  }
  demoWatchStarted = true
  let last = useSettings.getState().ttsVoice
  useSettings.subscribe((state) => {
    if (state.ttsVoice === last) {
      return
    }
    last = state.ttsVoice
    void playTtsVoiceDemo(state.ttsVoice)
  })
}

/** 绑定官方会话加载器；返回注销函数。 */
export const registerOfficialSync = () => {
  useChatStore.getState().setOfficialLoader(loadOfficialSession)
  if (officialHasToken()) {
    void syncOfficialSummaries()
    void syncOfficialProfile()
  }
}
