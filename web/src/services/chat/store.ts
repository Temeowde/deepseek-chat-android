import { describeReadAloudError, stopReadAloud, toggleReadAloud, useReadAloud } from '../speech/readAloud.js'
import { showToast } from '../../components/base/toastState.js'
import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { ApiError, streamMessage } from '../api/client.js'
import type { ChatModel, CreateMessageRequest } from '../api/types.js'
import { getCustomConfig } from '../custom/bridge.js'
import { streamCustom } from '../custom/stream.js'
import { streamWorkBuddy } from '../workbuddy/stream.js'
import { extractFileIds, getFileErrorCode, isRetryableApiError } from '../api/errors.js'
import { StorageReadError, cancelUpload, describeUploadError, uploadAttachment, useUploads } from '../attachments.js'
import { MAX_IMAGE_EDGE, blobToBase64, downscaleImage, INLINE_IMAGE_EDGE, isImageWithinLimit } from '../vision.js'
import { isBinaryDocument, MAX_INLINE_TEXT_CHARS, readBlobText } from '../textfile.js'
import { canParseLocally, localParseKind, parseDocument } from '../docparse/index.js'
import { useSettings } from '../settings.js'
import { appendBranch, getVisibleMessages, normalizeSession, repairVisibleTail, selectPathToMessage, selectVersion } from './branches.js'
import {
  readContextMemory,
  estimateTokens,
  CHARS_PER_TOKEN,
  clearContextMemory,
  clearAllContextMemories,
} from './contextMemory.js'
import { getContextLimit, isInputTooLong } from './describe.js'
import * as db from './db.js'
import { BackupError } from './history/errors.js'
import {
  clearAllDrafts,
  clearDraft,
  clearSentDraft,
  getDraft,
  prepareDraftMessage,
} from './drafts.js'
import { createLatestReminder } from './latestReminder.js'
import {
  applyEvent,
  canContinueReply,
  getContextRounds,
  selectRequestImageIds,
  settleReply,
  toRequestMessages,
} from './reply.js'
import {
  toSessionSummary,
  type AssistantMessage,
  type FileAttachment,
  type HistoryLocation,
  type HistorySearchTarget,
  type Message,
  type Session,
  type SessionSummary,
  type UserMessage,
} from './types.js'

/** deepseek-flash 同时支持深度思考与图片输入 */
const MODEL: ChatModel = 'deepseek-flash'
/** 所有生成请求统一携带的助手身份说明 */
const SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'
/** WorkBuddy 不是 DeepSeek 官方通道，用中性身份，避免网关按客户端指纹误判 */
const WORKBUDDY_SYSTEM_PROMPT = 'You are a helpful assistant.'
/** 保留最近打开的详情；当前会话、生成中及尚未成功保存的会话不淘汰。 */
const SESSION_CACHE_LIMIT = 5
/** 用户开启安全审核时发送 high；关闭时省略 safety_check */
const SAFETY_CHECK = { level: 'high' } as const
/** 服务端判定 file_id 失效后，重新补传并重发的最多次数（不含首次请求） */
const FILE_RETRY_LIMIT = 2
/** 退避基数，第 n 次重试等待 2^n 倍；连续失败达到上限就放弃，把原始报错展示出来 */
const FILE_RETRY_BASE_DELAY = 1000

/** 阅读链接始终开启，智能搜索开关控制是否另行声明搜索工具（含边想边搜）。 */
const serverTools = (search: boolean): CreateMessageRequest['tools'] => {
  const tools: CreateMessageRequest['tools'] = [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
  ]
  if (search) {
    tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })
  }
  return tools
}

/** 允许自动补标题的请求；手动重命名后取消本轮标题写入，包含主动清空标题的情况。 */
const titleRequests = new Set<AbortController>()

/** WorkBuddy 通道没有独立的标题模型，用首轮提问截一段作为会话标题。 */
const titleFromQuestion = (question: UserMessage): string => {
  const text = question.content.replace(/\s+/g, ' ').trim()
  return text.length > 24 ? `${text.slice(0, 24)}…` : text
}

type ChatState = {
  ready: boolean
  initError: boolean
  /** 历史导入或全部删除期间锁定交互，提交成功前仍展示原有记录。 */
  importingHistory: boolean
  /** 仅列表元数据，按 updatedAt 降序；流式消息更新不会改变此数组。 */
  sessions: SessionSummary[]
  sessionCache: Record<string, Session>
  sessionLoadErrors: Record<string, boolean>
  sessionSaveErrors: Record<string, boolean>
  /** null 表示新对话（欢迎页） */
  activeId: string | null
  /** 一次性定位请求，界面滚到对应消息后清除。 */
  historyLocation: HistoryLocation | null
  /** 正在生成回复的会话 */
  streaming: Record<string, AbortController>
  /** 重新读取本地摘要列表（官方会话同步后调用）。 */
  reloadSummaries: () => Promise<void>
  /** 官方会话的按需加载器，由 official 模块注册。 */
  setOfficialLoader: (loader: ((id: string) => Promise<Session | undefined>) | null) => void
}

export const useChatStore = create<ChatState>(() => ({
  ready: false,
  initError: false,
  importingHistory: false,
  sessions: [],
  sessionCache: {},
  sessionLoadErrors: {},
  sessionSaveErrors: {},
  activeId: null,
  historyLocation: null,
  streaming: {},
  reloadSummaries: async () => {
    const summaries = await db.loadSessionSummaries()
    set({ sessions: sortSessions(summaries) })
  },
  setOfficialLoader: (loader) => {
    officialLoader = loader
  },
}))

const { getState: get, setState: set } = useChatStore

const sortSessions = (sessions: SessionSummary[]) =>
  [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

const getSession = (id: string) => {
  const cache = get().sessionCache
  return Object.hasOwn(cache, id) ? cache[id] : undefined
}

/**
 * 官方会话的后台刷新。
 *
 * 之前是在打开会话时 await 官方接口：即使本地已有缓存也一定要等网络回来，
 * 于是每次点开都要等、还会和正在进行的滚动/渲染抢 CPU（感觉「特别卡」）。
 * 现在缓存秒开，只有在服务端看得出更新时才后台拉一次，回来再静默替换。
 */
const refreshOfficialInBackground = (id: string, force = false): void => {
  const epoch = historyEpoch
  void (async () => {
    try {
      const remote = await officialLoader?.(id)
      if (!remote || epoch !== historyEpoch) {
        return
      }
      const current = getSession(id)
      const summary = get().sessions.find((session) => session.id === id)
      // 服务端没有比本地更新时不动，避免覆盖本地刚发的消息；
      // 但附件结构过期时必须强制重拉，否则升级前的旧会话永远补不出图片。
      if (!force && current && remote.updatedAt < current.updatedAt) {
        return
      }
      if (remote.messages.length === 0 && current && current.messages.length > 0) {
        return
      }
      const settled = repairVisibleTail(settleInterrupted(normalizeSession(remote)))
      /*
       * 摘要覆盖会话时，updatedAt 不能被旧值盖回去：
       * 本地 API 续聊的时间官方服务器不认，用 ...summary 直接展开会把
       * 「今天」的会话打回「7 天内」。其它字段（标题/置顶/创建时间）仍以摘要为准。
       */
      const session =
        summary && !sameSummary(settled, summary)
          ? { ...settled, ...summary, updatedAt: Math.max(settled.updatedAt, summary.updatedAt) }
          : settled
      set((state) => ({ sessionCache: { ...state.sessionCache, [id]: session } }))
      await db.saveSession(session)
    } catch {
      // 后台刷新失败就继续用缓存，不打扰用户
    }
  })()
}

const getStreamController = (id: string) => {
  const streams = get().streaming
  return Object.hasOwn(streams, id) ? streams[id] : undefined
}

const sameSummary = (a: SessionSummary, b: SessionSummary) =>
  a.title === b.title && !!a.pinned === !!b.pinned && a.createdAt === b.createdAt && a.updatedAt === b.updatedAt

const sessionAccess = new Map<string, number>()
const unsavedSessions = new Set<string>()
/** 保存失败时保留原件，重试成功后才释放。 */
const pendingFiles = new Map<string, db.StoredFile[]>()
const deletingSessions = new Set<string>()
const deletionTasks = new Set<Promise<boolean>>()
const streamFlushes = new Map<string, () => void>()
let accessSequence = 0
let historyEpoch = 0
let initTask: Promise<void> | undefined
const sessionLoads = new Map<string, { promise: Promise<void> }>()

const touchSession = (id: string) => sessionAccess.set(id, ++accessSequence)

const trimSessionCache = () => {
  const state = get()
  const ids = Object.keys(state.sessionCache)
  if (ids.length <= SESSION_CACHE_LIMIT) {
    return
  }
  const removable = ids
    .filter(
      (id) =>
        id !== state.activeId &&
        !Object.hasOwn(state.streaming, id) &&
        !unsavedSessions.has(id) &&
        !deletingSessions.has(id)
    )
    .sort((a, b) => (sessionAccess.get(a) ?? 0) - (sessionAccess.get(b) ?? 0))
  const evicted = new Set(removable.slice(0, ids.length - SESSION_CACHE_LIMIT))
  for (const id of evicted) {
    sessionAccess.delete(id)
  }
  if (evicted.size > 0) {
    set({
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([id]) => !evicted.has(id))
      ),
    })
  }
}

const updateSession = (id: string, update: (session: Session) => Session) =>
  set((state) => {
    const previous = Object.hasOwn(state.sessionCache, id) ? state.sessionCache[id] : undefined
    if (!previous) {
      return state
    }
    const session = update(previous)
    if (session === previous) {
      return state
    }
    return {
      sessionCache: { ...state.sessionCache, [id]: session },
      sessions: sameSummary(previous, session)
        ? state.sessions
        : sortSessions(
            state.sessions.map((summary) =>
              summary.id === id ? toSessionSummary(session) : summary
            )
          ),
    }
  })

const updateReply = (sessionId: string, reply: AssistantMessage) =>
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.id === reply.id
        ? { ...reply, parentId: message.parentId, selectedChildId: message.selectedChildId }
        : message
    ),
  }))

const persist = (sessionId: string) => {
  const session = getSession(sessionId)
  if (session) {
    unsavedSessions.add(sessionId)
    if (deletingSessions.has(sessionId)) return undefined
    const epoch = historyEpoch
    const files = pendingFiles.get(sessionId)
    return db
      .saveSession(session, files)
      .then(() => {
        if (epoch !== historyEpoch || !getSession(sessionId)) {
          return
        }
        if (pendingFiles.get(sessionId) === files) {
          pendingFiles.delete(sessionId)
        }
        if (getSession(sessionId) === session) {
          unsavedSessions.delete(sessionId)
          set((state) => ({
            sessionSaveErrors: Object.fromEntries(
              Object.entries(state.sessionSaveErrors).filter(([id]) => id !== sessionId)
            ),
          }))
          trimSessionCache()
        }
      })
      .catch((error: unknown) => {
        db.reportStorageError('save session')(error)
        if (epoch === historyEpoch && getSession(sessionId)) {
          set((state) => ({
            sessionSaveErrors: { ...state.sessionSaveErrors, [sessionId]: true },
          }))
        }
      })
  }
  return undefined
}

export const retrySaveSessions = () => {
  if (!get().importingHistory) {
    unsavedSessions.forEach(persist)
  }
}

/** 离开前先合并尚未绘制的增量；隐藏期间浏览器可能暂停动画帧。 */
export const bindChatPersistence = () => {
  const save = () => {
    if (get().importingHistory) {
      return
    }
    for (const [id, flush] of streamFlushes) {
      flush()
      persist(id)
    }
    for (const id of unsavedSessions) {
      if (!streamFlushes.has(id)) {
        persist(id)
      }
    }
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      save()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', save)
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', save)
  }
}

/** 当前通道实际请求的模型名：官方通道看回复里的模型，第三方通道用各自设置里的模型名。 */
const currentProviderModel = (replyModel?: string | null): string => {
  const { provider, workbuddyModel } = useSettings.getState()
  if (provider === 'workbuddy') {
    return workbuddyModel
  }
  if (provider === 'custom') {
    return getCustomConfig()?.model ?? ''
  }
  return replyModel ?? MODEL
}

/** 按当前开关创建回复：深度思考对应 thinking，智能搜索控制 deepseek_web_search。 */
const createReply = (): AssistantMessage => {
  const { thinking, search } = useSettings.getState()
  return {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model: currentProviderModel(),
    provider: useSettings.getState().provider,
    thinking,
    search,
    prefix: true,
    status: 'pending',
    blocks: [],
  }
}

/** 仍在生成中的回复（页面关闭或导出时未结束）按「已停止」处理 */
const settleInterrupted = (session: Session): Session => {
  if (
    !session.messages.some(
      (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
    )
  ) {
    return session
  }
  return {
    ...session,
    messages: session.messages.map((m) =>
      m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
        ? settleReply(m, 'stopped', session.updatedAt)
        : m
    ),
  }
}

export const initChat = (): Promise<void> => {
  if (get().ready) {
    return Promise.resolve()
  }
  if (initTask) {
    return initTask
  }
  const epoch = historyEpoch
  set({ initError: false })
  initTask = (async () => {
    try {
      const summaries = await db.loadSessionSummaries()
      if (epoch === historyEpoch) {
        set({ ready: true, sessions: sortSessions(summaries) })
      }
    } catch (error) {
      if (epoch === historyEpoch) {
        set({ initError: true })
        db.reportStorageError('read local sessions')(error)
      }
    } finally {
      if (epoch === historyEpoch) {
        initTask = undefined
      }
    }
  })()
  return initTask
}

const resolveHistoryLocation = (session: Session, location: HistoryLocation | null) => {
  if (!location || location.sessionId !== session.id) return { session, location }
  const branch = selectPathToMessage(session, location.messageId)
  if (!branch) {
    showToast({ key: 'historyHitUnavailable' })
    return { session, location: null }
  }
  if (branch !== session && getStreamController(session.id)) {
    showToast({ key: 'historyHitBusy' })
    return { session, location: null }
  }
  return { session: branch, location }
}

/** 同一会话合并并发读取，旧请求仅更新各自缓存。 */
/** 官方账号会话按需从服务端拉取，由账号模块注册。 */
let officialLoader: ((id: string) => Promise<Session | undefined>) | null = null

const ensureSessionLoaded = (id: string): Promise<void> => {
  // 官方会话每次打开都重新拉取，才能看到官方 App 里新增的消息。
  if (getSession(id) && !id.startsWith('off_')) {
    return Promise.resolve()
  }
  const pending = sessionLoads.get(id)
  if (pending) {
    return pending.promise
  }
  const epoch = historyEpoch
  set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: false } }))
  const load = { promise: Promise.resolve() }
  sessionLoads.set(id, load)
  load.promise = (async () => {
    try {
      let stored = await db.loadSession(id)
      const isOfficial = id.startsWith('off_')
      /*
       * 旧缓存的会话可能还是「图片字段缺失/URL 拼错」的旧结构（升级前同步的）。
       * 用 schema 版本标记：缓存里没有任何 of_ 前缀附件、但会话又是官方来源时，
       * 无法判断是"真的没图"还是"旧结构"，一律强制重拉一次。
       * 否则用户必须删除会话重新同步才能修好（这正是上一版的问题）。
       */
      const staleAttachmentSchema =
        stored !== undefined &&
        isOfficial &&
        !stored.messages.some(
          (message) =>
            message.role === 'user' &&
            message.files.some((file) => file.remoteUrl !== undefined || file.id.startsWith('of_'))
        )
      // 官方会话：先用手上的缓存秒开。
      if (stored && isOfficial && epoch === historyEpoch) {
        const cached = repairVisibleTail(settleInterrupted(normalizeSession(stored)))
        set((state) => ({ sessionCache: { ...state.sessionCache, [id]: cached } }))
      }
      if (officialLoader && isOfficial) {
        const summary = get().sessions.find((session) => session.id === id)
        const cachedIsCurrent = !stored || (summary ? summary.updatedAt <= stored.updatedAt : false)
        if (!stored) {
          // 本地完全没有内容，只能等网络拉一次
          const remote = await officialLoader(id)
          if (remote) {
            stored = remote
          }
        } else if (!cachedIsCurrent || staleAttachmentSchema) {
          // 有缓存但服务端可能更新（或缓存还是旧附件结构）：后台刷新，不阻塞打开和滚动
          refreshOfficialInBackground(id, staleAttachmentSchema)
        }
      }
      if (epoch !== historyEpoch || sessionLoads.get(id) !== load) {
        return
      }
      const summary = get().sessions.find((session) => session.id === id)
      if (!summary) {
        return
      }
      if (!stored) {
        throw new Error(`Session ${id} is missing from local storage`)
      }
      const settled = repairVisibleTail(settleInterrupted(normalizeSession(stored)))
      // 读取期间可能已在列表重命名，保留最新元数据，不能让旧读取覆盖它。
      const session = sameSummary(settled, summary) ? settled : { ...settled, ...summary }
      touchSession(id)
      const selected = resolveHistoryLocation(session, get().historyLocation)
      set((state) => ({
        sessionCache: { ...state.sessionCache, [id]: selected.session },
        historyLocation: selected.location,
      }))
      if (selected.session !== stored) {
        persist(id)
      }
      trimSessionCache()
    } catch (error) {
      if (epoch === historyEpoch && sessionLoads.get(id) === load) {
        set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: true } }))
        db.reportStorageError('read session')(error)
      }
    } finally {
      if (sessionLoads.get(id) === load) {
        sessionLoads.delete(id)
      }
    }
  })()
  return load.promise
}

/** 等所有回复的收尾（落盘）完成 */
const waitForIdle = (sessionId?: string) =>
  new Promise<void>((resolve) => {
    const isIdle = (state: ChatState) =>
      sessionId === undefined
        ? Object.keys(state.streaming).length === 0
        : !Object.hasOwn(state.streaming, sessionId)
    if (isIdle(get())) {
      resolve()
      return
    }
    const unsubscribe = useChatStore.subscribe((state) => {
      if (isIdle(state)) {
        unsubscribe()
        resolve()
      }
    })
  })

export type HistoryImportMode = 'merge' | 'replace'

/** 先写入暂存，校验完毕后一次提交。空归档的覆盖模式用于删除全部历史。 */
export const applyHistory = async (write: () => Promise<void>, mode: HistoryImportMode) => {
  const state = get()
  if (state.importingHistory) throw new Error('History import is already in progress')
  if (mode === 'merge' && Object.keys(state.streaming).length > 0) {
    throw new BackupError('backupReplyInProgress')
  }
  set({ importingHistory: true })
  try {
    if (mode === 'replace') {
      for (const controller of Object.values(state.streaming)) controller.abort()
    }
    // 等待已开始的改名、置顶和删除同步到本地存储。
    await Promise.all(deletionTasks)
    historyEpoch += 1
    initTask = undefined
    sessionLoads.clear()
    await waitForIdle()
    if (mode === 'merge') {
      // 合并基于已落盘的分支，先把尚未保存的本地修改写入。
      await Promise.all([...unsavedSessions].map(persist))
      if (unsavedSessions.size > 0) throw new BackupError('backupUnsavedHistory')
    }
    await db.clearStaging()
    try {
      await write()
      if (mode === 'merge') {
        const { summaries, loaded, added, updated } = await db.mergeStaging(new Set(Object.keys(get().sessionCache)))
        // 合并/替换历史后，旧摘要可能对不上新历史：全部丢弃，等下次爆满再压。
        clearAllContextMemories()
        set((current) => ({
          ready: true,
          initError: false,
          sessions: sortSessions(summaries),
          sessionCache: { ...current.sessionCache, ...Object.fromEntries(loaded) },
        }))
        return { added, updated }
      }

      const summaries = await db.commitStaging()
      clearAllContextMemories()
      sessionAccess.clear()
      unsavedSessions.clear()
      pendingFiles.clear()
      clearAllDrafts()
      set({
        ready: true,
        initError: false,
        sessions: sortSessions(summaries),
        sessionCache: {},
        sessionLoadErrors: {},
        sessionSaveErrors: {},
        activeId: null,
        historyLocation: null,
      })
      return { added: summaries.length, updated: 0 }
    } catch (error) {
      await db.clearStaging().catch(db.reportStorageError('clear unfinished history import'))
      throw error
    }
  } finally {
    set({ importingHistory: false })
    retrySaveSessions()
    const { activeId, ready } = get()
    if (activeId !== null) {
      void ensureSessionLoaded(activeId)
    } else if (!ready) {
      void initChat()
    }
  }
}

/** 回到前台时刷新当前官方会话（如果正在看的是官方会话）。 */
export const refreshActiveSession = () => {
  const id = get().activeId
  if (id && id.startsWith('off_')) {
    void ensureSessionLoaded(id)
  }
}

export const newChat = () => {
  if (!get().importingHistory) {
    set({ activeId: null, historyLocation: null })
    trimSessionCache()
  }
}

export const selectSession = (id: string, target?: HistorySearchTarget) => {
  const state = get()
  if (state.importingHistory || deletingSessions.has(id) || !state.sessions.some((session) => session.id === id)) return
  touchSession(id)
  const location = target ? { ...target, sessionId: id } : null
  const session = getSession(id)
  if (session && location) {
    const selected = resolveHistoryLocation(session, location)
    set({
      activeId: id,
      historyLocation: selected.location,
      sessionCache: selected.session === session ? state.sessionCache : { ...state.sessionCache, [id]: selected.session },
    })
    if (selected.session !== session) persist(id)
  } else {
    set({ activeId: id, historyLocation: location })
    void ensureSessionLoaded(id)
  }
  trimSessionCache()
}

export const consumeHistoryLocation = (location: HistoryLocation) => {
  if (get().historyLocation === location) set({ historyLocation: null })
}

export const renameSession = (id: string, title: string) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  const controller = getStreamController(id)
  if (controller) {
    titleRequests.delete(controller)
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, title }))
    persist(id)
  } else {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, title } : session
      ),
    }))
    void db.renameSession(id, title).catch(db.reportStorageError('rename session'))
  }
}

/**
 * 删除会话；本地原件仅在没有其他会话引用时清理。远端文件不删：导入、编辑、重新生成都会复用同一个附件，
 * 同一服务端文件可能被多个会话引用，不维护引用计数。
 */
const setHistoryMetadata = window.chatHistoryMetadata({
  epoch: () => historyEpoch,
  get,
  deleting: id => deletingSessions.has(id),
  keepTitle: id => {
    const controller = getStreamController(id)
    if (controller) titleRequests.delete(controller)
  },
  publish: (id, fields) => {
    if (getSession(id)) updateSession(id, session => ({ ...session, ...fields }))
    else set(state => ({ sessions: state.sessions.map(session => session.id === id ? { ...session, ...fields } : session) }))
  },
  write: db.updateMetadata,
})

export const updateSessionMetadata = (id: string, fields: Partial<Pick<Session, 'title' | 'pinned'>>) => {
  const task = setHistoryMetadata(id, fields).finally(() => deletionTasks.delete(task))
  deletionTasks.add(task)
  return task
}

export const removeSession = (id: string): Promise<boolean> => {
  const task = removeSessionData(id).finally(() => deletionTasks.delete(task))
  deletionTasks.add(task)
  return task
}

const removeSessionData = async (id: string): Promise<boolean> => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return false
  }
  const epoch = historyEpoch
  deletingSessions.add(id)
  try {
    getStreamController(id)?.abort()
    // 等本会话的流收尾，避免删除之后又被收尾保存写回来。
    await waitForIdle(id)
    if (epoch !== historyEpoch) {
      return false
    }
    await db.deleteSession(id)
    clearContextMemory(id)
    if (epoch !== historyEpoch) {
      return true
    }
    sessionLoads.delete(id)
    sessionAccess.delete(id)
    unsavedSessions.delete(id)
    pendingFiles.delete(id)
    clearDraft(id)
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== id),
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([key]) => key !== id)
      ),
      sessionLoadErrors: Object.fromEntries(
        Object.entries(state.sessionLoadErrors).filter(([key]) => key !== id)
      ),
      sessionSaveErrors: Object.fromEntries(
        Object.entries(state.sessionSaveErrors).filter(([key]) => key !== id)
      ),
      activeId: state.activeId === id ? null : state.activeId,
      historyLocation: state.historyLocation?.sessionId === id ? null : state.historyLocation,
    }))
    return true
  } catch (error) {
    db.reportStorageError('delete session')(error)
    return false
  } finally {
    deletingSessions.delete(id)
    // 删除失败时保留会话，并保存停止生成后的最新状态。
    if (getSession(id)) {
      if (get().importingHistory) {
        unsavedSessions.add(id)
      } else {
        persist(id)
      }
    }
  }
}

export const stopReply = (sessionId: string) => getStreamController(sessionId)?.abort()

/**
 * 提交指定会话的最新草稿；null 表示新建会话。
 * 同步接收成功才清空草稿，附件原件由会话接管；保存失败仍通过保存入口重试。
 */
export const sendMessage = (targetSessionId: string | null) => {
  if (get().importingHistory || !get().ready) {
    return false
  }
  const prepared = prepareDraftMessage(getDraft(targetSessionId), useUploads.getState().tasks)
  if (!prepared) {
    return false
  }
  const { text, files } = prepared
  const now = Date.now()
  let sessionId = targetSessionId
  if (
    sessionId !== null &&
    (deletingSessions.has(sessionId) || getStreamController(sessionId) || !getSession(sessionId))
  ) {
    return false
  }
  if (sessionId === null) {
    const session: Session = {
      id: createId(),
      title: '',
      createdAt: now,
      updatedAt: now,
      messages: [],
      rootMessageId: null,
    }
    sessionId = session.id
    touchSession(session.id)
    set((state) => ({
      sessions: [toSessionSummary(session), ...state.sessions],
      sessionCache: { ...state.sessionCache, [session.id]: session },
      activeId: session.id,
    }))
  }
  const current = getSession(sessionId)
  if (!current) {
    return false
  }
  const history = getVisibleMessages(current)
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: files.map(({ id, serverId, name, size, isImage, mimeType }) => ({
      id,
      serverId,
      name,
      size,
      isImage,
      mimeType,
    })),
    createdAt: now,
  }
  const reply = createReply()
  updateSession(sessionId, (session) => ({
    ...appendBranch(session, history.at(-1)?.id ?? null, [question, reply]),
    updatedAt: now,
  }))
  if (files.length > 0) {
    pendingFiles.set(sessionId, [
      ...(pendingFiles.get(sessionId) ?? []),
      ...files.map(({ id, blob }) => ({ id, blob })),
    ])
  }
  persist(sessionId)
  clearSentDraft(targetSessionId)
  void streamReply(sessionId, reply, { history, question })
  return true
}

/** 重新生成当前路径上的回答：在原问题下新增版本，不覆盖旧回答和后续对话。 */
export const regenerateReply = (sessionId: string, messageId?: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index =
    messageId === undefined ? path.length - 1 : path.findIndex((m) => m.id === messageId)
  const question = path[index - 1]
  if (question?.role !== 'user' || path[index]?.role !== 'assistant') {
    return
  }
  const history = path.slice(0, index - 1)
  const reply = createReply()
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, question.id, [reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history, question })
}

/**
 * 「截断后发送」：当前这条提问本身太大（单条超限）时，用户点一下，
 * 只把文本截到安全长度重新发一次，原消息和附件不动，不改历史。
 * 只在"当前这条太大"的错误上使用；历史太长请用压缩上下文。
 */
export const retryWithTruncatedQuestion = (sessionId: string, messageId: string): boolean => {
  if (get().importingHistory || deletingSessions.has(sessionId) || getStreamController(sessionId)) {
    return false
  }
  const session = getSession(sessionId)
  if (!session) {
    return false
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const failed = path[index]
  const question = path[index - 1]
  if (failed?.role !== 'assistant' || question?.role !== 'user') {
    return false
  }
  const limit = getContextLimit(failed.error?.message) ?? 32768
  // 留一半余量给历史与输出；写死范围，避免"截了还是超"
  const maxChars = Math.max(2000, Math.floor(limit * 0.5 * CHARS_PER_TOKEN))
  if (question.content.length <= maxChars) {
    return false
  }
  const truncated: UserMessage = {
    id: createId(),
    role: 'user',
    content: `${question.content.slice(0, maxChars)}\n\n（内容过长，已截断后重发）`,
    files: [],
    createdAt: Date.now(),
  }
  const reply = createReply()
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, path[index - 2]?.id ?? null, [truncated, reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, {
    history: path.slice(0, index - 1),
    question: truncated,
  })
  return true
}

/**
 * 编辑提问后新增同父版本，保留原文件；旧问题的所有回答与后续对话仍可切回。
 *
 * 这是官方行为，不是 bug：官方 web 客户端的编辑用例（EditMessage.initFakeMessages）
 * 取被编辑消息的父节点，新建一条用户消息通过 addMessageIdToParent 追加进父节点的 childIds
 * 并切换过去；父节点为空时走 addMessageIdToRootBranch（会话根分支）。
 * 旧消息只清掉 isEditing 标记、不删不改，所以官方编辑后同样会出现「1 / 2」分支切换器
 * （官方在用户消息的操作栏用 getMessageBranchCount > 1 决定是否渲染这个切换器）。
 * 另外官方端点是 /api/v0/chat/edit_message，与我们这里发一次普通 completion 等价。
 */
export const editMessage = (sessionId: string, messageId: string, content: string): boolean => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return false
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return false
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const previous = path[index]
  const text = content.trim()
  if (previous?.role !== 'user' || (!text && previous.files.length === 0)) {
    return false
  }
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: previous.files,
    createdAt: Date.now(),
  }
  const reply = createReply()
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, path[index - 1]?.id ?? null, [question, reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index), question })
  return true
}

export const rateReply = (sessionId: string, id: string, localFeedback: AssistantMessage['localFeedback']) => {
  if (get().importingHistory || deletingSessions.has(sessionId) || get().activeId !== sessionId) return
  const message = getSession(sessionId)?.messages.find(item => item.id === id)
  if (message?.role === 'assistant' && message.status === 'done') {
    updateReply(sessionId, { ...message, localFeedback })
    persist(sessionId)
  }
}

export const selectMessageVersion = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  if (getStreamController(sessionId)) {
    return
  }
  updateSession(sessionId, (session) => selectVersion(session, messageId))
  persist(sessionId)
}

/** 继续最后一条未完成的回答：保留原消息与开关，仅将新流的内容追加到原块之后。 */
export const continueReply = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const question = path.at(-2)
  const previous = path.at(-1)
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.id !== messageId ||
    !canContinueReply(previous)
  ) {
    return
  }
  const { thinking, search } = useSettings.getState()
  const reply: AssistantMessage = {
    ...previous,
    // 未记录请求配置的回复，续写时使用默认模型和当前开关。
    model: previous.model ?? MODEL,
    thinking: previous.thinking ?? thinking,
    search: previous.search ?? search,
    status: 'pending',
    stopReason: undefined,
    stopDetails: undefined,
    error: undefined,
  }
  updateReply(sessionId, reply)
  updateSession(sessionId, (s) => ({ ...s, updatedAt: Date.now() }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, -2), question, prefix: previous })
}

/** 附件补传失败后重试：保留原回答位置，重新补传并请求 */
export const retryUpload = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const question = path[index - 1]
  const previous = path[index]
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.error?.kind !== 'upload'
  ) {
    return
  }
  const reply: AssistantMessage = { ...previous, status: 'pending', error: undefined }
  updateReply(sessionId, reply)
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index - 1), question })
}

type Request = { history: Message[]; question: UserMessage; prefix?: AssistantMessage }

/** 把补传得到的 serverId 写回会话里所有引用同一附件的消息（编辑、重新生成会共用附件） */
const saveServerIds = (sessionId: string, serverIds: Map<string, string>) => {
  if (serverIds.size === 0) {
    return
  }
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.role === 'user' && message.files.some((file) => serverIds.has(file.id))
        ? {
            ...message,
            files: message.files.map((file) =>
              serverIds.has(file.id) ? { ...file, serverId: serverIds.get(file.id) ?? null } : file
            ),
          }
        : message
    ),
  }))
  persist(sessionId)
}

/**
 * 附件的服务端 id：已有直接用；正在上传的等待同一任务；否则读取本地原件补传。
 * 本地也没有原件（导入的文档附件只有元数据）时返回 null，该附件只展示、不进入请求。
 */
/** 已经确认过尺寸合规的图片，避免每次发送都读一遍原件（失败不标记，否则会一直复用坏 serverId） */
const verifiedImages = new Set<string>()

/** 本地原件读取：IndexedDB 故障不能再伪装成普通上传失败 */
const readLocalFile = async (file: { id: string; name: string }): Promise<Blob | null> => {
  try {
    return (await db.loadFile(file.id)) ?? null
  } catch {
    throw new StorageReadError(file.name)
  }
}

const ensureServerId = async (apiKey: string, file: FileAttachment): Promise<string | null> => {
  if (file.serverId) {
    /*
     * 旧版本上传的图片可能是原图（手机照片 4000~8000px），file_id 指向的文件本身超限，
     * 服务端在推理时才拒绝（400 image too large），报错会一路显示到消息气泡上。
     * 这里对这些历史 serverId 做一次性体检：本地有原件且超限就重传压缩版；
     * 本地没有原件时先从 remoteUrl 取回；连原件都无法确认尺寸的本次不发送（文字占位），
     * 避免整条消息因为一张老图而 400。
     */
    if (file.isImage && !verifiedImages.has(file.id)) {
      try {
        let blob = await readLocalFile(file)
        if (!blob && file.remoteUrl) {
          try {
            const response = await fetch(file.remoteUrl)
            if (response.ok) {
              const fetched = await response.blob()
              if (fetched.size > 0) {
                blob = fetched
                await db.saveFiles([{ id: file.id, blob: fetched }])
              }
            }
          } catch {
            // 取不回来，按"无法确认尺寸"处理
          }
        }
        if (blob) {
          if (!(await isImageWithinLimit(blob, MAX_IMAGE_EDGE))) {
            const reuploaded = await uploadAttachment(apiKey, file.id, blob, file.name, true)
            verifiedImages.add(file.id)
            return reuploaded
          }
          verifiedImages.add(file.id)
        } else {
          return null
        }
      } catch (error) {
        // 存储读失败、或重传本身失败（ApiError）都往上抛，避免拿旧 serverId 继续发
        if (error instanceof StorageReadError || error instanceof ApiError) {
          throw error
        }
        // 其它情况（如尺寸无法判断）就沿用原 file_id，按服务端行为收尾
      }
    }
    return file.serverId
  }
  // 纯文本附件本地读取拼进正文，永远不进 Files API。
  if (!file.isImage && !isBinaryDocument(file.name)) {
    return null
  }
  const task = useUploads.getState().tasks[file.id]
  if (task?.status === 'done') {
    return task.serverId
  }
  let blob = await readLocalFile(file)
  if (!blob && file.remoteUrl) {
    /*
     * 官方会话同步过来的图片：原件还在 CDN 上（signed_path），本地只有地址。
     * 先取回原件入库，再走上传 —— 否则这张历史图片永远不会进入请求。
     */
    try {
      const response = await fetch(file.remoteUrl)
      if (response.ok) {
        const fetched = await response.blob()
        if (fetched.size > 0) {
          blob = fetched
          await db.saveFiles([{ id: file.id, blob: fetched }])
        }
      }
    } catch {
      // 取不到就按"没有原件"处理，该附件不进入请求
    }
  }
  if (!blob) {
    return null
  }
  return uploadAttachment(apiKey, file.id, blob, file.name, file.isImage)
}

/** 用会话里的最新消息替换请求快照：重传前会重置附件的 serverId，快照必须跟着更新 */
const refreshRequest = (sessionId: string, request: Request): Request => {
  const session = getSession(sessionId)
  if (!session) {
    return request
  }
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const pick = <T extends Message>(message: T): T =>
    (byId.get(message.id) as T | undefined) ?? message
  return {
    history: request.history.map(pick),
    question: pick(request.question),
    prefix: request.prefix,
  }
}

/**
 * 发送前补齐附件的 serverId。
 * - 本轮提问的附件并行补齐，任一失败则整体失败，已成功的照常写回，重试时复用成功结果；
 * - 历史轮次（仅进入上下文的）中没有 serverId 的附件，多为导入的图片：从最新的消息往前逐张补传，
 *   失败静默跳过，该附件不进入本次请求，下次发送时再试。
 */
/**
 * 把附件转成内联图片：读本地原件转 base64，供 WorkBuddy / 自定义通道直接发送。
 * 没有本地原件（导入的旧附件且从未下载）时返回 null。
 */
const toInlineImage = async (
  file: FileAttachment
): Promise<{ mediaType: string; data: string } | null> => {
  try {
    const blob = await readLocalFile(file)
    if (!blob) {
      return null
    }
    /*
     * 内联图片先缩到长边 2048：base64 会把体积放大 4/3，
     * 历史里几十张大图原样内联会让整个请求体爆掉（服务端也会因 4096px 限制 400）。
     */
    const scaled = await downscaleImage(blob, INLINE_IMAGE_EDGE)
    const mediaType = scaled.type || file.mimeType || blob.type || 'image/png'
    return { mediaType, data: await blobToBase64(scaled) }
  } catch {
    return null
  }
}

/**
 * 把纯文本附件读成消息正文：本地读原件，拼成「文件名 + 内容」的文本块，
 * 供任意通道当普通文本发送。优先用内存里的原件，落库尚未完成时也能读到。
 */
const toInlineText = async (
  file: FileAttachment,
  blobs: Map<string, Blob>
): Promise<string | null> => {
  try {
    const blob = blobs.get(file.id) ?? (await readLocalFile(file))
    if (!blob) {
      return null
    }
    const { text, totalChars, truncated } = await readBlobText(blob)
    const head = truncated
      ? `【文件：${file.name}】（原 ${totalChars} 字符，截断至前 ${text.length} 字符）`
      : `【文件：${file.name}】`
    return `${head}\n\n${text}`
  } catch {
    return null
  }
}

/**
 * 把 PDF / Word / PPT 在本地解析成文本（仅非 DeepSeek 通道走这条，
 * 因为那些供应商没有 Files API，文档根本发不出去）。
 * 解析失败返回 null，由调用方提示用户；明确标注「图片图表未包含」，
 * 避免模型和用户误以为看全了原件。
 */
const toInlineDocument = async (
  file: FileAttachment,
  blobs: Map<string, Blob>
): Promise<string | null> => {
  try {
    const blob = blobs.get(file.id) ?? (await readLocalFile(file))
    if (!blob) {
      return null
    }
    const parsed = await parseDocument(blob, file.name, MAX_INLINE_TEXT_CHARS)
    if (!parsed) {
      return null
    }
    const kind = localParseKind(file.name)
    const head = parsed.truncated
      ? `【文件：${file.name}】（${kind} 本地解析，原 ${parsed.totalChars} 字符，截断至前 ${parsed.text.length} 字符；图片与图表未包含）`
      : `【文件：${file.name}】（${kind} 本地解析；图片与图表未包含）`
    return `${head}\n\n${parsed.text}`
  } catch {
    return null
  }
}

/**
 * 把纯文本附件读成正文拼进消息：DeepSeek 通道也走这条，避免为 txt/md 花钱解析。
 * 返回替换过 content 的历史与提问；没有纯文本附件时原样返回。
 */
const injectInlineTexts = async (
  history: Message[],
  question: UserMessage,
  signal: AbortSignal,
  blobs: Map<string, Blob>,
  /** DeepSeek 官方通道：不拼进正文，改为挂到附件上由 reply 层生成内联 document 块 */
  asDocument = false
): Promise<{ history: Message[]; question: UserMessage }> => {
  const targets = new Map<string, FileAttachment>()
  for (const [user] of getContextRounds(history)) {
    for (const file of user.files) {
      targets.set(file.id, file)
    }
  }
  for (const file of question.files) {
    targets.set(file.id, file)
  }
  const texts = new Map<string, string>()
  for (const file of targets.values()) {
    if (file.isImage || isBinaryDocument(file.name)) {
      continue
    }
    signal.throwIfAborted()
    const text = await toInlineText(file, blobs)
    if (text) {
      texts.set(file.id, text)
    }
  }
  if (texts.size === 0) {
    return { history, question }
  }
  const apply = <T extends Message>(message: T): T => {
    if (message.role !== 'user') {
      return message
    }
    const extra = message.files
      .map((file) => texts.get(file.id))
      .filter((value): value is string => typeof value === 'string')
    if (extra.length === 0) {
      return message
    }
    if (asDocument) {
      // 文本附件正文挂到附件上，由 reply.ts 生成内联 document 块：不占单条 32K 文本上限。
      const files = message.files.map((file) => {
        const text = texts.get(file.id)
        return text === undefined ? file : { ...file, documentText: text }
      })
      return { ...message, files }
    }
    const content = [message.content, ...extra].filter(Boolean).join('\n\n')
    return content === message.content ? message : { ...message, content }
  }
  return { history: history.map(apply), question: apply(question) }
}

const prepareFiles = async (sessionId: string, request: Request, signal: AbortSignal) => {
  const epoch = historyEpoch
  // 服务端判定 file_id 失效时会清掉会话里的 serverId，先用最新消息替换请求快照，
  // 否则快照里仍是旧 id，补传会直接复用它。
  request = refreshRequest(sessionId, request)
  const settings = useSettings.getState()
  const apiKey = settings.apiKey ?? ''
  /**
   * 纯文本附件在任意通道都本地读取，不进上传；
   * 图片在非 DeepSeek 通道 base64 内联；
   * PDF / Word / PPT 在非 DeepSeek 通道本地解析成文本（它们没有 Files API）；
   * 只有 Excel 与 .doc / .ppt / .xls 老格式必须走 DeepSeek。
   */
  const inlineImages = settings.provider !== 'deepseek' && settings.search !== true
  const serverIds = new Map<string, string>()
  // 刚发送的附件原件可能还没落库，优先用内存里的 pendingFiles
  const recentBlobs = new Map<string, Blob>()
  for (const stored of pendingFiles.get(sessionId) ?? []) {
    recentBlobs.set(stored.id, stored.blob)
  }

  if (inlineImages) {
    const targets = new Map<string, FileAttachment>()
    const collect = (files: FileAttachment[]) => {
      for (const file of files) {
        targets.set(file.id, file)
      }
    }
    collect(request.question.files)
    for (const [user] of getContextRounds(request.history)) {
      collect(user.files)
    }
    const documents = [...targets.values()].filter(
      (file) => !file.isImage && isBinaryDocument(file.name)
    )
    // .doc / .ppt / .xls / .xlsx 没有浏览器端解析器，只能走 DeepSeek。
    // 用户刚发的附件照旧报错；历史会话里的这类附件如果也报错，整个旧会话就永远发不出去，
    // 所以历史里的直接跳过，并在那条消息里留一句说明。
    const unsupported = documents.filter((file) => !canParseLocally(file.name))
    const unsupportedIds = new Set(unsupported.map((file) => file.id))
    const unsupportedInQuestion = request.question.files.some((file) => unsupportedIds.has(file.id))
    if (unsupportedInQuestion) {
      const names = unsupported
        .filter((file) => request.question.files.some((item) => item.id === file.id))
        .map((file) => file.name)
        .join('、')
      throw new ApiError(
        'protocol',
        `${names} 目前只能发到 DeepSeek 通道（Excel 和 .doc / .ppt / .xls 老格式暂不支持本地解析），请删除或切换到 DeepSeek`
      )
    }
    const inline = new Map<string, { mediaType: string; data: string }>()
    const texts = new Map<string, string>()
    const parseFailed: string[] = []
    // 历史消息里的附件：解析失败时跳过并留说明，不能因为一条老附件让整个历史会话永远发不出去
    const historyFileIds = new Set<string>()
    for (const [user] of getContextRounds(request.history)) {
      for (const file of user.files) {
        historyFileIds.add(file.id)
      }
    }
    const skippedParse = new Map<string, string>()
    for (const file of targets.values()) {
      signal.throwIfAborted()
      if (unsupportedIds.has(file.id)) {
        // 当前通道解析不了的老格式，历史里已经决定跳过，别再当文本整块 decode
        continue
      }
      if (file.isImage) {
        const image = await toInlineImage(file)
        if (image) {
          inline.set(file.id, image)
        }
      } else if (canParseLocally(file.name)) {
        // PDF / Word / PPT 本地解析成文本，这些供应商没有 Files API
        const text = await toInlineDocument(file, recentBlobs)
        if (text) {
          texts.set(file.id, text)
        } else if (historyFileIds.has(file.id)) {
          skippedParse.set(file.id, file.name)
        } else {
          parseFailed.push(file.name)
        }
      } else {
        const text = await toInlineText(file, recentBlobs)
        if (text) {
          texts.set(file.id, text)
        }
      }
    }
    if (parseFailed.length > 0) {
      throw new ApiError(
        'protocol',
        `${parseFailed.join('、')} 没能读取出文字（可能是扫描件、加密文件或体积过大），请换一份文件，或切换到 DeepSeek 通道让它来解析`
      )
    }
    const attach = <T extends Message>(message: T): T => {
      if (message.role !== 'user') {
        return message
      }
      // 当前通道处理不了的历史附件（老格式 / 解析失败）：直接去掉，避免整条历史会话都发不出去
      const skippedNames = message.files
        .filter((file) => unsupportedIds.has(file.id) || skippedParse.has(file.id))
        .map((file) => skippedParse.get(file.id) ?? file.name)
      const keptFiles = message.files.filter((file) => !unsupportedIds.has(file.id) && !skippedParse.has(file.id))
      const files = keptFiles.map((file) => {
        if (inline.has(file.id)) {
          return { ...file, serverId: null, inlineImage: inline.get(file.id) }
        }
        // 正文已经并进消息的文档（PDF/Word/PPT 本地解析）：附件块不再发送，清掉 serverId
        if (texts.has(file.id)) {
          return { ...file, serverId: null }
        }
        return file
      })
      const extra = keptFiles
        .map((file) => texts.get(file.id))
        .filter((value): value is string => typeof value === 'string')
      const skipNote = skippedNames.length > 0 ? `[这条历史消息里的 ${skippedNames.join('、')} 在当前通道解析不了，已跳过]` : ''
      const content = [message.content, ...extra, skipNote].filter(Boolean).join('\n\n')
      const filesChanged =
        message.files.length !== keptFiles.length || files.some((file, index) => file !== keptFiles[index])
      return filesChanged || content !== message.content
        ? { ...message, files, content }
        : message
    }
    return {
      history: request.history.map(attach),
      question: attach(request.question),
      prefix: request.prefix,
    }
  }

  // 停止生成立即生效；上传本身不取消（输入框与其他消息可能共用同一任务），完成后照常写回 serverId
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  /**
   * 只上传本次请求真正会发送的图片（最多 20 张，从最新往旧）。
   * 导入的历史会话可能有几百张图片；全部补传会等几分钟甚至超时，而且超出的图片最终也不会发。
   */
  const keptImageIds = selectRequestImageIds([
    ...getContextRounds(request.history).map(([user]) => user),
    request.question,
  ])
  const uploads = Promise.allSettled(
    request.question.files
      .filter((file) => !file.isImage || keptImageIds.has(file.id))
      .map(async (file) => {
        const serverId = await ensureServerId(apiKey, file)
        if (serverId) {
          serverIds.set(file.id, serverId)
        }
      })
  )
  void uploads.then(() => {
    if (epoch === historyEpoch) {
      saveServerIds(sessionId, serverIds)
    }
  })
  const results = await Promise.race([uploads, aborted])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) {
    throw failed.reason
  }

  const pending = new Map<string, FileAttachment>()
  for (const [user] of [...getContextRounds(request.history)].reverse()) {
    for (const file of user.files) {
      if (serverIds.has(file.id) || pending.has(file.id)) {
        continue
      }
      if (file.isImage) {
        // 只补传会进入本次请求的图片；更早的图片本次不发送（用文字占位）
        if (!keptImageIds.has(file.id)) {
          continue
        }
        // 已有 serverId 的图片只需体检一次（超限会重传压缩版）
        if (file.serverId && verifiedImages.has(file.id)) {
          continue
        }
        pending.set(file.id, file)
      } else if (!file.serverId) {
        pending.set(file.id, file)
      }
    }
  }
  /**
   * 历史图片补传并行化：上传队列本身限制最多 3 张同时传，这里一次把它们排进去，
   * 首次发送不用再"一张等一张"。失败仍静默跳过（该图本次不发送，用文字占位）。
   */
  const historyUploads = [...pending.values()].map(async (file) => {
    signal.throwIfAborted()
    try {
      const serverId = await ensureServerId(apiKey, file)
      if (serverId) {
        serverIds.set(file.id, serverId)
      }
    } catch {
      signal.throwIfAborted()
    }
  })
  await Promise.race([Promise.all(historyUploads), aborted])
  saveServerIds(sessionId, serverIds)

  // 用补齐后的会话重新取历史与提问，保证请求里都是 serverId
  const session = getSession(sessionId)
  const resolve = <T extends Message>(message: T): T =>
    (session?.messages.find((m) => m.id === message.id) as T | undefined) ?? message
  const resolvedHistory = request.history.map(resolve)
  const resolvedQuestion = resolve(request.question)
  const withText = await injectInlineTexts(
    [...resolvedHistory],
    resolvedQuestion,
    signal,
    recentBlobs,
    !inlineImages
  )
  return {
    history: withText.history,
    question: withText.question,
    prefix: request.prefix,
  }
}

/** 本次请求实际会用到的服务端 file_id */
const collectServerFileIds = (request: Request): Set<string> => {
  const ids = new Set<string>()
  const add = (files: FileAttachment[]) => {
    for (const file of files) {
      if (file.serverId) {
        ids.add(file.serverId)
      }
    }
  }
  add(request.question.files)
  for (const [user] of getContextRounds(request.history)) {
    add(user.files)
  }
  return ids
}

/**
 * 服务端判定 file_id 失效时，清掉对应附件的 serverId 并丢弃旧的上传任务，
 * 下一次补齐会重新读取本地原件上传。报错里点名了 file_id 就只重置这些，
 * 没点名（如 invalid file_id）则重置本次请求用到的全部附件。
 */
const reuploadInvalidatedFiles = (sessionId: string, request: Request, error: unknown): boolean => {
  if (!(error instanceof ApiError) || !getFileErrorCode(error)) {
    return false
  }
  const mentioned = extractFileIds(error.message)
  // 重试时原始快照里还是上一轮已被清掉的 serverId，先换成会话里的最新消息
  const targets =
    mentioned.length > 0
      ? new Set(mentioned)
      : collectServerFileIds(refreshRequest(sessionId, request))
  const session = getSession(sessionId)
  if (targets.size === 0 || !session) {
    return false
  }
  const localIds: string[] = []
  const messages = session.messages.map((message) => {
    if (message.role !== 'user') {
      return message
    }
    let changed = false
    const files = message.files.map((file) => {
      if (!file.serverId || !targets.has(file.serverId)) {
        return file
      }
      localIds.push(file.id)
      changed = true
      return { ...file, serverId: null }
    })
    return changed ? { ...message, files } : message
  })
  if (localIds.length === 0) {
    return false
  }
  updateSession(sessionId, (current) => ({ ...current, messages }))
  // 上传任务里可能还留着同一个失效的 serverId，清掉后 ensureServerId 才会重新上传
  localIds.forEach(cancelUpload)
  persist(sessionId)
  return true
}

/** 重传前的退避等待；停止生成时立即返回，由调用方按已停止收尾 */
const waitForRetry = (attempt: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    function onAbort() {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      FILE_RETRY_BASE_DELAY * 2 ** attempt
    )
    signal.addEventListener('abort', onAbort, { once: true })
  })

/**
 * 请求并消费流：先补齐附件的 serverId，再发请求；流式增量按动画帧刷新内存，完成、失败或停止后落盘。
 * 补传失败时回复记为 upload 错误，可重试。
 * 服务端判定 file_id 失效时重新补传后重发，退避重试且次数有上限，超过则按原始报错收尾。
 */
export const autoRead = window.createChatAutoRead({
  storage: () => localStorage,
  foreground: () => window.matchMedia('(max-width: 767px)').matches && !document.hidden,
  active: () => get().activeId,
  play: (id, text) => {
    if (useReadAloud.getState().messageId !== id) {
      toggleReadAloud(id, text, error => showToast(describeReadAloudError(error)))
    }
  },
  stop: stopReadAloud,
})

const streamReply = async (sessionId: string, initial: AssistantMessage, request: Request) => {
  const controller = new AbortController()
  const ticket = autoRead.begin(sessionId, initial.id)
  if (!getSession(sessionId)?.title) {
    titleRequests.add(controller)
  }
  set((state) => ({ streaming: { ...state.streaming, [sessionId]: controller } }))
  let reply = initial
  let frame = 0
  /**
   * 附件在 prepareFiles 里才把正文注入提问；超限分类要用"真正发出去的那份"，
   * 所以单独保存，不能再用外边传进来的 request.question（它看不到附件正文）。
   */
  let preparedQuestion: UserMessage = request.question
  let lastQuestionHasFiles = (request.question.files?.length ?? 0) > 0
  const flush = () => {
    cancelAnimationFrame(frame)
    frame = 0
    updateReply(sessionId, reply)
  }
  streamFlushes.set(sessionId, flush)

  try {
    for (let attempt = 0; ; attempt += 1) {
      /** 附件补齐前出错属于上传失败，请求还没有发出 */
      let preparing = true
      let receivedContent = false
      try {
        // 聊天供应商只负责聊天/深度思考；联网搜索走 DeepSeek 官方能力。
        // 图片在非 DeepSeek 通道改为内联，不需要 DeepSeek Key；文档仍需 DeepSeek。
        const settings = useSettings.getState()
        const provider = settings.provider
        const historyHasFiles = request.history.some((message) => {
          const files = (message as { files?: unknown[] }).files
          return Array.isArray(files) && files.length > 0
        })
        const questionHasFiles = (request.question.files?.length ?? 0) > 0
        const hasAttachments = questionHasFiles || historyHasFiles
        const inlineImages = provider !== 'deepseek' && settings.search !== true
        if (hasAttachments && !inlineImages && !settings.apiKey) {
          throw new ApiError(
            'protocol',
            '附件/识图需要 DeepSeek API Key，请到设置 → 数据管理填写'
          )
        }
        if (settings.search && !settings.apiKey) {
          throw new ApiError(
            'protocol',
            '联网搜索需要 DeepSeek API Key，请到设置 → 数据管理填写'
          )
        }
        const prepared = await prepareFiles(sessionId, request, controller.signal)
        preparing = false
        preparedQuestion = prepared.question
        lastQuestionHasFiles = (prepared.question.files?.length ?? 0) > 0
        // 附件就绪后获取本轮信息；续写沿用原回答快照，重新生成的快照独立保存。
        const latestReminder = prepared.prefix
          ? prepared.prefix.latestReminder
          : createLatestReminder(useSettings.getState())
        reply = { ...reply, latestReminder }
        updateReply(sessionId, reply)
        persist(sessionId)
        // 联网搜索只能由 DeepSeek 官方 API 执行；图片已在 prepareFiles 里内联，不需要切通道。
        const needsDeepSeek = provider === 'deepseek' || settings.search === true
        // 记录本轮真正使用的模型：第三方通道 / 被搜索或附件强制切到 DeepSeek 时都要如实记录，
        // 否则消耗面板会按错误模型的单价来算。
        const requestModel = needsDeepSeek ? (initial.model ?? MODEL) : currentProviderModel(initial.model)
        const requestProvider = needsDeepSeek ? 'deepseek' : provider
        if (reply.model !== requestModel || reply.provider !== requestProvider) {
          reply = { ...reply, model: requestModel, provider: requestProvider }
          updateReply(sessionId, reply)
          persist(sessionId)
        }
        const messages = toRequestMessages(
          prepared.history,
          prepared.question,
          prepared.prefix,
          initial.thinking ?? false,
          latestReminder,
          readContextMemory(sessionId),
          // 官方通道：超长用户文本/文本附件正文改用内联 document 块，绕开单条 32K 上限。
          needsDeepSeek
        )
        const wantsTitle = titleRequests.has(controller)
        const customConfig =
          provider === 'custom' && !needsDeepSeek ? getCustomConfig() : null
        if (!needsDeepSeek && provider === 'custom' && (!customConfig?.baseUrl || !customConfig.model)) {
          throw new ApiError('protocol', '请先在设置里配置自定义 API（Base URL 和模型）')
        }
        const title = wantsTitle ? titleFromQuestion(prepared.question) : undefined
        const events = needsDeepSeek
          ? streamMessage(
              settings.apiKey ?? '',
              {
                // 附件/搜索切到 DeepSeek 时不能用 WorkBuddy/自定义的模型名。
                model: requestModel as ChatModel,
                system: SYSTEM_PROMPT,
                messages,
                thinking: { type: initial.thinking ? 'enabled' : 'disabled' },
                /* 内容安全：用户开启时才发送 high（关闭则不发送，回落到 API 默认的 low 检查） */
        ...(settings.safetyCheck ? { safety_check: SAFETY_CHECK } : {}),
                tools: serverTools(initial.search ?? false),
                ...(title ? { title: { enabled: true } } : {}),
              },
              controller.signal
            )
          : provider === 'workbuddy'
            ? streamWorkBuddy(
                {
                  model: settings.workbuddyModel,
                  system: WORKBUDDY_SYSTEM_PROMPT,
                  messages,
                  thinking: initial.thinking ?? false,
                  ...(title ? { title } : {}),
                },
                controller.signal
              )
            : streamCustom(
                {
                  model: customConfig?.model ?? '',
                  system: WORKBUDDY_SYSTEM_PROMPT,
                  messages,
                  thinking: initial.thinking ?? false,
                  ...(title ? { title } : {}),
                },
                controller.signal
              )
        const blockIndexes = new Map<number, number>()
        for await (const event of events) {
          receivedContent ||= event.type === 'content_block_start'
          if (
            event.type === 'message_delta' &&
            (event.delta.stop_reason === 'end_turn' || event.delta.stop_reason === 'max_tokens') &&
            event.delta.title?.trim() &&
            titleRequests.has(controller) &&
            !controller.signal.aborted &&
            !get().importingHistory
          ) {
            const title = event.delta.title.trim()
            updateSession(sessionId, (session) => (session.title ? session : { ...session, title }))
            titleRequests.delete(controller)
          }
          reply = applyEvent(reply, event, Date.now(), blockIndexes)
          if (document.visibilityState === 'hidden') {
            flush()
          } else {
            frame ||= requestAnimationFrame(flush)
          }
        }
        reply = settleReply(reply, 'done', Date.now())
        break
      } catch (error) {
        if (controller.signal.aborted) {
          reply = settleReply(reply, 'stopped', Date.now())
          break
        }
        if (preparing) {
          // 自己抛的 protocol 错误（比如当次附件格式当前通道处理不了）要把原因显示出来，
          // 否则所有准备阶段失败都被统一成「上传失败」，用户不知道该删哪条消息。
          const protocolError = error instanceof ApiError && error.kind === 'protocol'
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'upload',
            message: protocolError ? error.message : '',
            localMessage: protocolError ? undefined : describeUploadError(error),
            retryable: isRetryableApiError(error),
          })
          break
        }
        // 附件失效：重新补传后重发。收到过内容块（含丢弃的客户端工具）后不自动重发。
        if (
          attempt < FILE_RETRY_LIMIT &&
          !receivedContent &&
          reuploadInvalidatedFiles(sessionId, request, error)
        ) {
          await waitForRetry(attempt, controller.signal)
          if (controller.signal.aborted) {
            reply = settleReply(reply, 'stopped', Date.now())
            break
          }
          continue
        }
        if (error instanceof ApiError && error.kind === 'interrupted' && reply.stopReason) {
          // 已收到 message_delta 的结束原因，只是缺了结尾的 message_stop
          reply = settleReply(reply, 'done', Date.now())
        } else if (error instanceof ApiError) {
          /**
           * 上下文/输入超限时区分原因：
           * - 当前这条本身太大 → overflow='input'，提示截断重发；
           * - 历史太长把总请求撑爆 → overflow='history'，提示压缩历史。
           * 只在报错这一刻计算，正常聊天没有任何额外开销。
           */
          const limit = getContextLimit(error.message)
          const questionTokens = estimateTokens(preparedQuestion.content)
          const overflow =
            limit === null
              ? undefined
              : lastQuestionHasFiles && (isInputTooLong(error.message) || questionTokens > limit * 0.5)
                ? ('input' as const)
                : questionTokens > limit * 0.8
                  ? ('input' as const)
                  : ('history' as const)
          reply = settleReply(reply, 'error', Date.now(), {
            kind: error.kind,
            message: error.message,
            status: error.status,
            localMessage: error.localMessage,
            overflow,
            ...(limit !== null ? { questionTokens } : {}),
          })
        } else {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'protocol',
            message: error instanceof Error ? error.message : String(error),
          })
        }
        break
      }
    }
  } finally {
    titleRequests.delete(controller)
    streamFlushes.delete(sessionId)
    cancelAnimationFrame(frame)
    updateReply(sessionId, reply)
    set((state) => ({
      streaming: Object.fromEntries(
        Object.entries(state.streaming).filter(([id]) => id !== sessionId)
      ),
    }))
    persist(sessionId)
    autoRead.finish(ticket, reply)
  }
}
