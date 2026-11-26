import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { toSessionSummary, type Session, type SessionSummary } from './types.js'

/** 官方同步会话的 id 前缀；导入归档里的会话用裸 id，两者指同一条会话。 */
const OFFICIAL_PREFIX = 'off_'

/** IndexedDB 存储结构版本；新增或调整存储、索引时递增。 */
const DB_VERSION = 11

/** 后台补下附件原件后广播，消息里的附件据此重新读取本地原件（原件缺失 -> 可显示）。 */
export const FILE_SAVED_EVENT = 'chat-demo:file-saved'

/** 文件原件按附件的本地 id 存储，所有引用同一 id 的消息共用一份；用于缩略图、打开查看，以及没有 serverId 时补传。 */
export type StoredFile = {
  id: string
  blob: Blob
}

/** 文件引用留在摘要中，删除会话时通过索引判断原件是否仍被引用。 */
type StoredSessionSummary = SessionSummary & { fileIds: string[] }

interface ChatDB extends DBSchema {
  /** 当前使用的会话，界面读写都在这里 */
  sessions: { key: string; value: Session }
  sessionSummaries: {
    key: string
    value: StoredSessionSummary
    indexes: { fileIds: string }
  }
  /** 当前使用的文件原件 */
  files: { key: string; value: StoredFile }
  /**
   * 历史导入的暂存：导入过程中会话与原件只写入这两个存储，`sessions` / `files` 保持不变；
   * 全部校验通过后用一个事务提交正式数据并清空暂存。
   */
  sessionsStaging: { key: string; value: Session }
  filesStaging: { key: string; value: StoredFile }
}

let dbPromise: Promise<IDBPDatabase<ChatDB>> | null = null

const storedSummary = (session: Session): StoredSessionSummary => ({
  ...toSessionSummary(session),
  fileIds: [
    ...new Set(
      session.messages.flatMap((message) =>
        message.role === 'user' ? message.files.map((file) => file.id) : []
      )
    ),
  ],
})

const abortTransaction = (tx: { abort(): void }) => {
  try {
    tx.abort()
  } catch {
    // 事务已因请求失败中止。
  }
}

// 每个操作拿到连接后立即创建事务；IndexedDB 按创建顺序执行范围重叠的事务，读取总能看到之前发起的写入。
const getDB = () =>
  (dbPromise ??= openDB<ChatDB>('chat-demo', DB_VERSION, {
    upgrade(db, _oldVersion, _newVersion, tx) {
      // 初始化当前格式需要的存储与索引，不迁移旧消息。
      for (const name of ['sessions', 'files', 'sessionsStaging', 'filesStaging'] as const) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' })
        }
      }
      const summaries = db.objectStoreNames.contains('sessionSummaries')
        ? tx.objectStore('sessionSummaries')
        : db.createObjectStore('sessionSummaries', { keyPath: 'id' })
      if (!summaries.indexNames.contains('fileIds')) {
        summaries.createIndex('fileIds', 'fileIds', { multiEntry: true })
      }
    },
  }).catch((error: unknown) => {
    // 打开失败后允许界面重试，避免一直复用已拒绝的 Promise。
    dbPromise = null
    throw error
  }))

export const loadSessionSummaries = async (): Promise<SessionSummary[]> =>
  (await (await getDB()).getAll('sessionSummaries')).map(toSessionSummary)

export const loadSession = async (id: string): Promise<Session | undefined> =>
  (await getDB()).get('sessions', id)

/** 只登记摘要（例如官方账号同步来的会话），消息在打开时再拉取。 */
export const saveSummary = async (summary: SessionSummary): Promise<void> => {
  const db = await getDB()
  const existing = await db.get('sessionSummaries', summary.id)
  const tx = db.transaction('sessionSummaries', 'readwrite')
  /*
   * updatedAt 只增不减（关键修复）：
   * 用 API 续聊产生的消息只存在本地，官方服务器的 updated_at 还是旧的。
   * 直接覆盖会让「刚聊过的会话」在下次同步时退回旧分组（今天 → 7天内）。
   * 标题/置顶仍按服务端为准，只有时间戳做单调保护。
   */
  const updatedAt = Math.max(existing?.updatedAt ?? 0, summary.updatedAt)
  await tx.store.put({ ...summary, updatedAt, fileIds: existing?.fileIds ?? [] })
  await tx.done
}

export const saveSession = async (session: Session, files: StoredFile[] = []): Promise<void> => {
  const summary = storedSummary(session)
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries', 'files'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        for (const file of files) {
          await tx.objectStore('files').put(file)
        }
        await tx.objectStore('sessions').put(session)
        await tx.objectStore('sessionSummaries').put(summary)
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

/** 未打开的会话也可重命名，只读取该会话，原子更新详情和列表。 */
export const updateMetadata = async (id: string, fields: Partial<Pick<Session, 'title' | 'pinned'>>): Promise<boolean> => {
  let found = false
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        const sessions = tx.objectStore('sessions')
        const session = await sessions.get(id)
        if (session) {
          Object.assign(session, fields)
          found = true
          await sessions.put(session)
          await tx.objectStore('sessionSummaries').put(storedSummary(session))
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
  return found
}

export const renameSession = (id: string, title: string) => updateMetadata(id, { title })

/** 删除会话，仅清理已无会话引用的本地原件；远端文件不删。 */
export const deleteSession = async (sessionId: string): Promise<void> => {
  const tx = (await getDB()).transaction(['sessions', 'sessionSummaries', 'files'], 'readwrite')
  await Promise.all([
    (async () => {
      try {
        const summaries = tx.objectStore('sessionSummaries')
        const summary = await summaries.get(sessionId)
        await tx.objectStore('sessions').delete(sessionId)
        await summaries.delete(sessionId)
        for (const id of summary?.fileIds ?? []) {
          if ((await summaries.index('fileIds').count(id)) === 0) {
            await tx.objectStore('files').delete(id)
          }
        }
      } catch (error) {
        abortTransaction(tx)
        throw error
      }
    })(),
    tx.done,
  ])
}

const putFiles = async (store: 'files' | 'filesStaging', files: StoredFile[]) => {
  const tx = (await getDB()).transaction(store, 'readwrite')
  await Promise.all([...files.map((file) => tx.store.put(file)), tx.done])
}

export const saveFiles = async (files: StoredFile[]): Promise<void> => {
  await putFiles('files', files)
  if (typeof window !== 'undefined' && files.length > 0) {
    window.dispatchEvent(new Event(FILE_SAVED_EVENT))
  }
}

export const loadFile = async (id: string): Promise<Blob | undefined> =>
  (await (await getDB()).get('files', id))?.blob

/** 清空导入暂存：开始导入前清除上次中断（如关闭页面）遗留的数据，导入失败后清除本次写入。 */
export const clearStaging = async (): Promise<void> => {
  const tx = (await getDB()).transaction(['sessionsStaging', 'filesStaging'], 'readwrite')
  await Promise.all([
    tx.objectStore('sessionsStaging').clear(),
    tx.objectStore('filesStaging').clear(),
    tx.done,
  ])
}

export const addStagingSession = async (session: Session): Promise<void> => {
  await (await getDB()).add('sessionsStaging', session)
}

export const saveStagingFiles = (files: StoredFile[]): Promise<void> =>
  putFiles('filesStaging', files)

export const loadStagingFile = async (id: string): Promise<Blob | undefined> =>
  (await (await getDB()).get('filesStaging', id))?.blob

/** 图片位于会话 JSON 之后；全部读完后回填具体 MIME，保留归档给出的 isImage 标识。 */
export const updateStagingFileTypes = async (types: ReadonlyMap<string, string>, pins: ReadonlyMap<string, boolean>): Promise<void> => {
  const tx = (await getDB()).transaction('sessionsStaging', 'readwrite')
  await Promise.all([
    (async () => {
      for (let cursor = await tx.store.openCursor(); cursor; cursor = await cursor.continue()) {
        const session = cursor.value
        let changed = false
        if (session.pinned === undefined && pins.has(session.id)) {
          session.pinned = pins.get(session.id)
          changed = true
        }
        for (const message of session.messages) {
          if (message.role !== 'user') {
            continue
          }
          for (const file of message.files) {
            const type = types.get(file.id) ?? ''
            if (file.mimeType !== type) {
              file.mimeType = type
              changed = true
            }
          }
        }
        if (changed) {
          await cursor.update(session)
        }
      }
    })(),
    tx.done,
  ])
}

/**
 * 导入完成后用暂存替换正式数据：同一事务中替换会话、摘要和原件，并清空暂存。
 * 逐条游标复制，同一时间只读取一条记录；事务失败时整体回滚，正式数据不变。
 */
export const commitStaging = async (): Promise<SessionSummary[]> => {
  const summaries: SessionSummary[] = []
  const tx = (await getDB()).transaction(
    ['sessions', 'sessionSummaries', 'files', 'sessionsStaging', 'filesStaging'],
    'readwrite'
  )
  const move = async (from: 'sessionsStaging' | 'filesStaging', to: 'sessions' | 'files') => {
    try {
      const target = tx.objectStore(to)
      await target.clear()
      if (to === 'sessions') {
        await tx.objectStore('sessionSummaries').clear()
      }
      for (
        let cursor = await tx.objectStore(from).openCursor();
        cursor;
        cursor = await cursor.continue()
      ) {
        await target.put(cursor.value)
        if (to === 'sessions') {
          const summary = storedSummary(cursor.value as Session)
          await tx.objectStore('sessionSummaries').put(summary)
          summaries.push(toSessionSummary(summary))
        }
      }
      await tx.objectStore(from).clear()
    } catch (error) {
      // 同步抛出的错误不会让事务自动回滚，需显式中止，避免只提交清空和部分移入。
      abortTransaction(tx)
      throw error
    }
  }
  await Promise.all([move('sessionsStaging', 'sessions'), move('filesStaging', 'files'), tx.done])
  // 直接返回本次提交的列表，调用方无需在替换成功后再发起可能失败的读取。
  return summaries
}

/** 原件已在暂存时校验。会话、摘要和新原件一起提交。 */
export const mergeStaging = async (loadedIds: ReadonlySet<string>) => {
  const { mergeArchivedSession, sessionsEquivalent } = await import('./history/mergeSession.js')
  const tx = (await getDB()).transaction(
    ['sessions', 'sessionSummaries', 'files', 'sessionsStaging', 'filesStaging'],
    'readwrite'
  )
  const merge = async () => {
    const files = tx.objectStore('files')
    const stagedFiles = tx.objectStore('filesStaging')
    const copiedFiles = new Set<string>()
    for (let cursor = await stagedFiles.openCursor(); cursor; cursor = await cursor.continue()) {
      const file = cursor.value
      if ((await files.getKey(file.id)) === undefined) {
        await files.add(file)
        copiedFiles.add(file.id)
      }
    }

    const sessions = tx.objectStore('sessions')
    const summaries = tx.objectStore('sessionSummaries')
    const stagedSessions = tx.objectStore('sessionsStaging')
    const loaded = new Map<string, Session>()
    let added = 0
    let updated = 0
    for (let cursor = await stagedSessions.openCursor(); cursor; cursor = await cursor.continue()) {
      const incoming = cursor.value
      /*
       * 同一条官方会话在本地有两种 id：导入来的裸 id 和官方同步的 off_<id>。
       * 合并时两种都要找，否则跨命名空间必然 miss，于是列表里出现两个同名会话。
       *
       * 但跨命名空间**不能见到同 id 就合**：导入的存档可能比官方账号多聊了几轮
       * （导出的官方会话 + 导入后继续聊）。那种情况下必须当成两个会话分别保留，
       * 否则多出来的消息会被官方那份覆盖（用户反馈过的丢消息 bug）。
       * 只有「所有消息逐条完全一致」才合并。
       */
      const direct = await sessions.get(incoming.id)
      const cross = direct ? undefined : await sessions.get(OFFICIAL_PREFIX + incoming.id)
      const existing = direct ?? cross
      let session: Session
      if (!existing) {
        session = incoming
      } else if (!direct && !sessionsEquivalent(existing, incoming)) {
        // 内容不一致：另存为独立会话，保留导入的完整内容
        session = incoming
      } else {
        session = mergeArchivedSession(existing, incoming)
      }
      const summary = storedSummary(session)
      if (session === existing && !summary.fileIds.some(id => copiedFiles.has(id))) continue
      if (session !== existing) {
        await sessions.put(session)
        await summaries.put(summary)
      }
      if (loadedIds.has(session.id)) loaded.set(session.id, session)
      if (existing) updated += 1
      else added += 1
    }
    await stagedFiles.clear()
    await stagedSessions.clear()
    return { summaries: (await summaries.getAll()).map(toSessionSummary), loaded, added, updated }
  }
  const [result] = await Promise.all([
    merge().catch(error => {
      abortTransaction(tx)
      throw error
    }),
    tx.done,
  ])
  return result
}

/** 本地存储失败不打断对话，只在控制台留痕 */
export const reportStorageError = (action: string) => (error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(`[storage] ${action} failed`, error)
}
