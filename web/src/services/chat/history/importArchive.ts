import * as db from '../db.js'
import type { TranslationKey } from '../../../i18n/index.js'
import type { Session } from '../types.js'
import { BackupError, fail } from './errors.js'
import type { SessionIndexEntry } from './format.js'
import { INDEX_PATH, MANIFEST_PATH, USER_PATH, parseSessionPath } from './paths.js'
import { checkManifest, readSessionFile, readSessionIndex } from './schema.js'
import { toLocalSession, type LocalSession } from './toLocal.js'
import {
  ArchiveError,
  isZipFile,
  archiveEntryCount,
  readArchive,
  readEntry,
  skipEntry,
  type ArchiveEntry,
} from './zipReader.js'

/**
 * 导入过程中遇到的可降级问题。
 *
 * 以前这些情况都是整包失败：一条会话 JSON 损坏、一张图与本地原件同 id 但字节不同、
 * 归档 index 比会话文件多/少一条，用户拿到的只有"文件内容不完整，无法导入"，
 * 已经能读出来的几百条会话也一起丢掉。
 *
 * 现在 merge 模式（从备份恢复、追加导入）只记录并继续，replace 模式保持严格：
 * 覆盖是一次性替换本地全部历史，宁可失败也不能静默少导入。
 */
export type ImportWarning =
  /** 单条会话数据损坏被跳过；归档里其它会话照常导入 */
  | { kind: 'sessionSkipped'; id: string; reason: TranslationKey }
  /** 同一个会话在归档里出现两次（文件名与内容 id 重复） */
  | { kind: 'sessionDuplicate'; id: string }
  /** 会话文件名与文件内 id 不一致 */
  | { kind: 'sessionMismatchedId'; id: string; actual: string }
  /** 消息里无法解析的片段被 schema 丢弃：这是真实的内容缺失信号 */
  | { kind: 'sessionFragmentsDropped'; id: string; dropped: number }
  /** 归档 index 声明的消息条数与会话文件里的条数不符 */
  | { kind: 'sessionMessageCountMismatch'; id: string; declared: number; actual: number }
  /** 同一附件 id 在归档内部对应两份不同原件 */
  | { kind: 'imageConflictInArchive'; id: string }
  /** 同一附件 id 本地已有不同原件：保留本地那份，不覆盖 */
  | { kind: 'imageConflictLocal'; id: string }
  /** 会话引用了图片，但归档里没有对应条目（附件只剩元数据） */
  | { kind: 'imageMissing'; id: string; path: string }
  /** 归档里多出来的、没有消息引用的图片条目 */
  | { kind: 'imageUnreferenced'; path: string }
  /** 会话被跳过时，它目录下的图片也一并跳过 */
  | { kind: 'imagesOfSkippedSession'; sessionId: string; count: number }
  /** 归档没有 index，或 index 无法解析：按会话文件导入 */
  | { kind: 'indexUnreadable' }
  /** index 与会话文件对不上：merge 下继续导入，只提示 */
  | { kind: 'indexMismatch'; missing: string[]; extra: string[] }

/** 一次导入的结果；调用方可以据此提示"成功但有 N 条被跳过"。 */
export type ImportReport = {
  /** 成功写入暂存区的会话数 */
  sessions: number
  /** merge 模式下因数据损坏而跳过的会话数 */
  skippedSessions: number
  /** 成功写入暂存区的图片原件数 */
  images: number
  /** 会话引用了但归档缺失的图片数（这些附件只剩元数据） */
  missingImages: number
  /** 被 schema 丢弃的片段总数：大于 0 说明归档里有内容读不出来 */
  droppedFragments: number
  warnings: ImportWarning[]
}

/**
 * 导入暂存的读写接口。
 *
 * 生产实现直接用 IndexedDB（`indexDbImportStore`）；Node 测试注入内存实现，
 * 这样整条流式解析/校验/降级逻辑都能在没有 WebView 的环境里跑。
 */
export type ImportStore = {
  addStagingSession(session: Session): Promise<void>
  saveStagingFiles(files: { id: string; blob: Blob }[]): Promise<void>
  loadStagingFile(id: string): Promise<Blob | undefined>
  loadFile(id: string): Promise<Blob | undefined>
  updateStagingFileTypes(
    types: ReadonlyMap<string, string>,
    pins: ReadonlyMap<string, boolean>
  ): Promise<void>
}

/** 默认实现：写入 db.ts 的导入暂存区。 */
export const indexDbImportStore: ImportStore = {
  addStagingSession: (session) => db.addStagingSession(session),
  saveStagingFiles: (files) => db.saveStagingFiles(files),
  loadStagingFile: (id) => db.loadStagingFile(id),
  loadFile: (id) => db.loadFile(id),
  updateStagingFileTypes: (types, pins) => db.updateStagingFileTypes(types, pins),
}

/** 从原件字节补充图片 MIME；无法识别时为空字符串，图片身份仍由归档的 is_image 决定。 */
const imageType = (bytes: Uint8Array): string => {
  const startsWith = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte)
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 12))
  if (startsWith(0xff, 0xd8, 0xff)) {
    return 'image/jpeg'
  }
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'image/png'
  }
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return 'image/gif'
  }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (startsWith(0x42, 0x4d)) {
    return 'image/bmp'
  }
  if (startsWith(0x49, 0x49, 0x2a, 0) || startsWith(0x4d, 0x4d, 0, 0x2a)) {
    return 'image/tiff'
  }
  if (header.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(header.slice(8, 12))) {
    return 'image/avif'
  }
  return ''
}

const readJson = async (entry: ArchiveEntry): Promise<unknown> => {
  const text = await (await readEntry(entry)).text()
  try {
    return JSON.parse(text)
  } catch {
    return fail('backupInvalidJson')
  }
}

/**
 * 统计原始 JSON 里的片段条数（不校验结构）。
 * 与 schema 校验后的条数比较就能发现"哪些片段读不出来"——schema 会静默丢弃无法解析的片段。
 */
const countRawFragments = (value: unknown): number => {
  if (value === null || typeof value !== 'object') {
    return 0
  }
  const messages = (value as { messages?: unknown }).messages
  if (!Array.isArray(messages)) {
    return 0
  }
  let total = 0
  for (const message of messages) {
    if (message === null || typeof message !== 'object') {
      continue
    }
    const fragments = (message as { fragments?: unknown }).fragments
    if (Array.isArray(fragments)) {
      total += fragments.length
    }
  }
  return total
}

/** 会话目录下的图片条目：chat_sessions/{session_id}_files/{file_id}_{file_name} */
const IMAGE_DIR = /^chat_sessions\/([^/]+)_files\//

/**
 * 检查 ZIP 格式、首个 manifest 条目及格式版本。
 * 校验失败时保留正在生成的回答和现有暂存数据。
 */
export const checkArchiveFormat = async (file: File): Promise<void> => {
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  try {
    for await (const entry of readArchive(file)) {
      if (entry.path !== MANIFEST_PATH) {
        fail('backupUnrecognized')
      }
      checkManifest(await readJson(entry))
      return
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  fail('backupUnrecognized')
}

/** 同一附件 ID 必须对应同一份原件。分块比较，避免为大图同时读取两份完整数据。 */
const sameBlob = async (first: Blob, second: Blob): Promise<boolean> => {
  if (first.size !== second.size) return false
  const chunkSize = 1024 * 1024
  for (let offset = 0; offset < first.size; offset += chunkSize) {
    const end = offset + chunkSize
    const [a, b] = await Promise.all([
      first.slice(offset, end).arrayBuffer(), second.slice(offset, end).arrayBuffer(),
    ])
    const bytes = new Uint8Array(a)
    const other = new Uint8Array(b)
    for (let i = 0; i < bytes.length; i += 1) {
      if (bytes[i] !== other[i]) return false
    }
  }
  return true
}

/**
 * 流式导入：manifest → user（不导入）→ 全部会话 JSON → index → 全部图片。
 * 也支持会话与图片交错排列、index 位于末尾的条目顺序。
 * 会话读完立即暂存，只保留图片路径映射；图片全部读完后逐会话回填 MIME，不改变图片身份。
 * 写入导入暂存存储。调用方负责清空暂存、提交或在失败时清理。
 *
 * merge 模式下，单条会话损坏 / 附件冲突 / index 对不上只记 warning 并继续；
 * ZIP 结构损坏（CRC、重名条目、未知条目）仍然是整包失败——那时候后面的条目已经不可信。
 */
export const importArchive = async (
  file: File,
  merge: boolean,
  onProgress: (done: number, total: number) => void,
  store: ImportStore = indexDbImportStore
): Promise<ImportReport> => {
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  const warnings: ImportWarning[] = []
  const warn = (warning: ImportWarning) => {
    warnings.push(warning)
  }
  /** 已写入暂存的会话 id */
  const imported = new Set<string>()
  /** 解析失败被跳过的会话 id：其图片目录也要整段跳过 */
  const skipped = new Set<string>()
  /** 会话文件里的消息条数，用于核对 index 声明的 message_count */
  const messageCounts = new Map<string, number>()
  /** 会话目录下的图片条目名 → 文件 ID（只收集导入成功的会话） */
  const images = new Map<string, string>()
  /** 归档里实际出现过的图片条目名 */
  const seenImages = new Set<string>()
  /** 已保存的原件：文件 ID → MIME。同一图片出现在多个会话目录时只保存一次。 */
  const stored = new Map<string, string>()
  /** 被跳过会话目录下的图片条目数 */
  const skippedImages = new Map<string, number>()
  const state: {
    manifest: boolean
    index: SessionIndexEntry[] | undefined
    indexUnreadable: boolean
  } = { manifest: false, index: undefined, indexUnreadable: false }
  let skippedSessions = 0
  let savedImages = 0
  let droppedFragments = 0

  const saveImage = async (entry: ArchiveEntry, id: string): Promise<void> => {
    const data = await readEntry(entry)
    const previous = stored.get(id)
    if (previous !== undefined) {
      const staged = await store.loadStagingFile(id)
      if (!staged) {
        // 暂存里没有（例如上一次写入失败）：按归档数据补一次
        await store.saveStagingFiles([{ id, blob: new Blob([data], { type: previous }) }])
        return
      }
      if (await sameBlob(data, staged)) {
        return
      }
      // 同一个附件 id 在归档内部对应两份不同原件：归档自身矛盾。
      // 保留先读到的那份（内容都在，只是有一张用不上），不值得整包失败。
      if (!merge) {
        fail('backupConflictingFile')
      }
      warn({ kind: 'imageConflictInArchive', id })
      return
    }
    const type = imageType(new Uint8Array(await data.slice(0, 16).arrayBuffer()))
    if (merge) {
      const existing = await store.loadFile(id)
      if (existing) {
        if (await sameBlob(data, existing)) {
          // 本地已有同一份原件：不必再写一份暂存（几十 MB 的图会白占一倍配额）
          stored.set(id, type || existing.type)
          return
        }
        // 同一 id 本地已有不同原件：用户本地的原件优先，不覆盖、也不整包失败。
        // commitStaging/mergeStaging 本来就不会覆盖已有 files，这里只是把冲突说清楚。
        stored.set(id, existing.type)
        warn({ kind: 'imageConflictLocal', id })
        return
      }
    }
    await store.saveStagingFiles([{ id, blob: new Blob([data], { type }) }])
    stored.set(id, type)
    savedImages += 1
  }

  /** 读一条会话 JSON：损坏时 merge 下跳过并统计，replace 下整包失败。 */
  const importSession = async (entry: ArchiveEntry, sessionId: string): Promise<void> => {
    if (imported.has(sessionId) || skipped.has(sessionId)) {
      // ZIP 不允许重名条目，只有"文件名不同、内容 id 相同"才会走到这里
      if (!merge) {
        fail('backupIncomplete')
      }
      await skipEntry(entry)
      warn({ kind: 'sessionDuplicate', id: sessionId })
      return
    }
    let local: LocalSession
    let dropped = 0
    try {
      const raw = await readJson(entry)
      const parsed = readSessionFile(raw)
      // schema 会丢弃无法解析的片段（未知类型、字段不合法）：这是真实的内容缺失，单独计数
      const kept = parsed.messages.reduce((total, message) => total + message.fragments.length, 0)
      dropped = countRawFragments(raw) - kept
      if (parsed.id !== sessionId) {
        if (!merge) {
          fail('backupIncomplete')
        }
        skipped.add(sessionId)
        skippedSessions += 1
        warn({ kind: 'sessionMismatchedId', id: sessionId, actual: parsed.id })
        return
      }
      local = toLocalSession(parsed)
      messageCounts.set(sessionId, parsed.messages.length)
    } catch (error) {
      if (!merge || !(error instanceof BackupError)) {
        throw error
      }
      skipped.add(sessionId)
      skippedSessions += 1
      warn({ kind: 'sessionSkipped', id: sessionId, reason: error.key })
      return
    }
    if (dropped > 0) {
      droppedFragments += dropped
      warn({ kind: 'sessionFragmentsDropped', id: sessionId, dropped })
    }
    for (const [path, id] of local.images) {
      images.set(path, id)
    }
    imported.add(sessionId)
    await store.addStagingSession(local.session)
  }

  const handleAttachment = async (entry: ArchiveEntry, owner: string): Promise<void> => {
    if (!imported.has(owner)) {
      // 会话没导入（损坏跳过，或归档里根本没有这条会话）：图片整段丢弃
      await skipEntry(entry)
      if (skipped.has(owner)) {
        skippedImages.set(owner, (skippedImages.get(owner) ?? 0) + 1)
        return
      }
      if (!merge) {
        fail('backupIncomplete')
      }
      warn({ kind: 'imageUnreferenced', path: entry.path })
      return
    }
    seenImages.add(entry.path)
    const id = images.get(entry.path)
    if (id === undefined) {
      // 会话目录里多出来的图片：没有消息引用，读完丢弃
      await skipEntry(entry)
      warn({ kind: 'imageUnreferenced', path: entry.path })
      return
    }
    await saveImage(entry, id)
  }

  const handleEntry = async (entry: ArchiveEntry): Promise<void> => {
    const { path } = entry
    if (!state.manifest) {
      if (path !== MANIFEST_PATH) {
        fail('backupUnrecognized')
      }
      checkManifest(await readJson(entry))
      state.manifest = true
      return
    }
    if (path === MANIFEST_PATH) {
      // 第二个 manifest：归档结构已不可信
      fail('backupUnrecognized')
    }
    if (path === USER_PATH && state.index === undefined && imported.size === 0) {
      // 账号信息（已脱敏）不导入；文件可能缺失。
      await skipEntry(entry)
      return
    }
    const sessionId = parseSessionPath(path)
    if (sessionId !== null && state.index === undefined) {
      await importSession(entry, sessionId)
      return
    }
    if (path === INDEX_PATH && state.index === undefined) {
      try {
        state.index = readSessionIndex(await readJson(entry))
      } catch (error) {
        if (!merge || !(error instanceof BackupError)) {
          throw error
        }
        state.indexUnreadable = true
        warn({ kind: 'indexUnreadable' })
      }
      return
    }
    // 未知条目：要么是归档结构不合法，要么 index 之后又出现会话 JSON（条目顺序不可信）
    const owner = IMAGE_DIR.exec(path)?.[1] ?? fail('backupIncomplete')
    await handleAttachment(entry, owner)
  }

  try {
    const total = await archiveEntryCount(file)
    let done = 0
    onProgress(done, total)
    for await (const entry of readArchive(file)) {
      await handleEntry(entry)
      onProgress(++done, total)
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  if (!state.manifest) {
    fail('backupUnrecognized')
  }
  // 归档里一条会话都没有时直接失败：否则会「导入成功但列表还是空的」，用户以为卡住了
  if (imported.size === 0) {
    fail('backupEmpty')
  }
  for (const [sessionId, count] of skippedImages) {
    warn({ kind: 'imagesOfSkippedSession', sessionId, count })
  }
  // 引用了但归档里没有的图片：附件只剩元数据，不占内容，但要如实统计
  let missingImages = 0
  for (const [path, id] of images) {
    if (seenImages.has(path)) {
      continue
    }
    missingImages += 1
    warn({ kind: 'imageMissing', id, path })
  }
  // index 必须与成功导入的会话一一对应；merge 下对不上只提示，replace 下保持严格
  const listed = new Set(state.index?.map((entry) => entry.id))
  const missingEntries = [...imported].filter((id) => !listed.has(id))
  const extraEntries: string[] = []
  const listedOnce = new Set<string>()
  for (const entry of state.index ?? []) {
    if (!imported.has(entry.id) || listedOnce.has(entry.id)) {
      extraEntries.push(entry.id)
      continue
    }
    listedOnce.add(entry.id)
  }
  if (state.index === undefined) {
    if (!merge) {
      fail('backupIncomplete')
    } else if (!state.indexUnreadable) {
      warn({ kind: 'indexUnreadable' })
    }
  } else if (missingEntries.length > 0 || extraEntries.length > 0) {
    if (!merge) {
      fail('backupIncomplete')
    }
    warn({ kind: 'indexMismatch', missing: missingEntries, extra: extraEntries })
  }
  for (const entry of state.index ?? []) {
    const actual = messageCounts.get(entry.id)
    if (actual !== undefined && entry.message_count !== actual) {
      warn({
        kind: 'sessionMessageCountMismatch',
        id: entry.id,
        declared: entry.message_count,
        actual,
      })
    }
  }
  const pins = new Map<string, boolean>()
  for (const entry of state.index ?? []) {
    if (entry.pinned !== undefined && imported.has(entry.id)) {
      pins.set(entry.id, entry.pinned)
    }
  }
  await store.updateStagingFileTypes(stored, pins)
  return {
    sessions: imported.size,
    skippedSessions,
    images: savedImages,
    missingImages,
    droppedFragments,
    warnings,
  }
}
