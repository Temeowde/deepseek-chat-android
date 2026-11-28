import { useSettings } from '../settings.js'
import { exportHistory, exportIncremental, importHistory, type HistoryImportProgress } from './backup.js'
import { useChatStore } from './store.js'

/**
 * 「本地保留」：把会话导出到公共目录（/sdcard/DS-Chat），卸载 App 不会被删。
 *
 * 隐私考虑：Android 11+ 写这个目录需要「所有文件访问权限」，观感吓人，
 * 所以**默认关闭**，只有用户在设置里主动打开时才申请；没打开时整条链路完全不工作。
 *
 * 可观测性（2026-11 备份链故障复盘补）：
 * 以前这条链路所有失败都是 `return null`，用户只看到一句「备份失败，请检查权限或存储空间」，
 * 支持侧完全不知道是没权限、导出抛错、Base64 内存不足，还是桥写盘失败。现在每次尝试都记录
 * 一个 BackupOutcome（原因枚举 + 文案 + 大小 + 耗时），并通过这些渠道暴露：
 * - window.__lastBackupStatus / window.__lastBackupError（当前会话，供 UI / 远程调试）
 * - localStorage 'chat-demo:local-backup-last-error'（重启后仍在，供用户截图上报）
 * - localStorage 'chat-demo:local-backup-last-attempt'（上次尝试时间，成功失败都记）
 * - lastBackupStatus() / lastBackupError() / backupDebugState() 导出，供设置页后续接入
 */
const BACKUP_PREFIX = 'dschat-auto-'
const LAST_BACKUP_KEY = 'chat-demo:local-backup-last'
const LAST_ATTEMPT_KEY = 'chat-demo:local-backup-last-attempt'
const LAST_ERROR_KEY = 'chat-demo:local-backup-last-error'
const FINGERPRINT_KEY = 'chat-demo:local-backup-fingerprint'
/** 增量备份前缀：只含「上次备份之后有变化的会话」 */
const INC_PREFIX = 'deepseek_inc-'
/** 最新一份完整备份的文件名（增量链的基线） */
const BASE_KEY = 'chat-demo:local-backup-base'
/** 增量链最多叠多少份，超过就重新做一次完整备份 */
const INC_CHAIN_MAX = 10
/** 单次增量最多包含多少会话，超过直接做完整备份 */
const INC_MAX_SESSIONS = 200
const DEFAULT_INTERVAL = 10 * 60 * 1000

const bridge = () => window.BackupAndroid

/**
 * 最小可信备份大小。
 * 一个空的归档只有 manifest + index，约 300 字节；真要有一个会话就会远超这个值。
 * 低于它的一律当失败：不写盘（历史 307 字节「假备份」就是没拦新写），列包时过滤并删除旧包。
 */
const MIN_BACKUP_BYTES = 1024
/**
 * 自动备份的体积上限（导出 ZIP 的字节数）。
 * 桥是同步的 Base64 字符串：JS 侧 Blob → dataURL/base64（约 1.33N 的字符串，V8 里最多 2.67N），
 * 原生侧再收一份 Java String（2.67N）+ byte[]（N），峰值约 6~8 倍包体积。
 * 超过这个上限不写盘，改记 too-large 并提示用户走「导出全部历史」手动保存，避免 OOM 直接把 WebView 打死。
 * 等桥改成流式（分块读写）后可以调大。
 */
const MAX_BACKUP_BYTES = 512 * 1024 * 1024
/** 30 秒内内容完全没变的备份不重复写（以前只比大小，容易误判） */
const DUPLICATE_WINDOW = 30_000
/**
 * 最多保留多少份「完整」自动备份。
 * 完整包含全部图片，实测一份 119MB；以前留 12 份直接吃掉 1.8GB。
 * 增量包很小，历史主要靠增量链，完整包留 2 份足够（新版 + 上一版容错）。
 */
const MAX_BACKUPS = 2
/** 手动导出的 deepseek_data-*.zip 也很大，只保留最近几份 */
const MAX_MANUAL_BACKUPS = 2
const MANUAL_PREFIX = 'deepseek_data-'
/** 指纹只采样首尾各 4KB，避免为了去重读整个 ZIP */
const FINGERPRINT_SAMPLE = 4096
/** 单条错误/状态文案最多保留多少字符（要塞进 localStorage 和 window 钩子） */
const MAX_ERROR_CHARS = 500
/**
 * 恢复走 Base64 桥：readBackup 在原生侧整文件 byte[] + Base64 String，JS 侧再拿一份字符串，
 * 加上解码后的 Uint8Array 和 File 副本，峰值约 6~7 倍包体积。20MB 起警告，32MB 以上直接拒绝
 * （继续恢复大概率 OOM，OutOfMemoryError 不是 Exception，桥的 catch 吞不掉，会把桥调用炸成普通 Error）。
 */
const RESTORE_WARN_BYTES = 20 * 1024 * 1024
const MAX_RESTORE_BYTES = 512 * 1024 * 1024

export const localBackupSupported = () => typeof window.BackupAndroid !== 'undefined'

export const localBackupEnabled = () => useSettings.getState().localBackup === true

const safeHasAccess = (api: BackupAndroidBridge): boolean => {
  try {
    return api.hasAccess() === true
  } catch {
    return false
  }
}

export const localBackupReady = () => {
  const api = bridge()
  return !!api && safeHasAccess(api)
}

export const backupDir = () => {
  try {
    return bridge()?.backupDir() ?? ''
  } catch {
    return ''
  }
}

const safeDeviceTag = (api: BackupAndroidBridge): string => {
  try {
    return api.deviceTag() ?? ''
  } catch {
    return ''
  }
}

export const deviceTag = () => {
  const api = bridge()
  return api ? safeDeviceTag(api) : ''
}

/** 用户打开开关时调用：触发系统授权。 */
export const requestLocalBackupAccess = () => {
  try {
    bridge()?.requestAccess()
  } catch {
    // 跳转系统授权页失败：保持未授权，页面会提示用户
  }
}

export type BackupEntry = { name: string; size: number; modified: number }

/** 备份失败原因：枚举而不是文案，方便 UI 分支、上报和后续统计。 */
export type LocalBackupFailure =
  | 'unsupported'
  | 'no-access'
  | 'export-failed'
  | 'empty-archive'
  | 'too-large'
  | 'encode-failed'
  | 'save-failed'
  | 'verify-failed'
  | 'unexpected'

/** 触发来源：App 定时/切后台、设置页手动、历史遗留的 scheduleLocalBackup。 */
export type BackupTrigger = 'manual' | 'auto' | 'schedule' | 'unspecified'

/** 一次自动/手动备份的结果（成功也记录，方便排查"上次什么时候备的、为什么没备"）。 */
export type BackupOutcome = {
  at: number
  trigger: BackupTrigger
  ok: boolean
  reason?: LocalBackupFailure
  message?: string
  fileName?: string
  size?: number
  durationMs?: number
  /** 内容没变、复用了上一次的包，没有新写文件 */
  deduped?: boolean
}

/** 一次目录扫描的结果：坏包会被过滤并删除，记下来供支持侧确认"307 字节包去哪了"。 */
export type BackupScan = {
  at: number
  total: number
  usable: number
  removed: BackupEntry[]
  error?: string
}

type LocalBackupWindow = Window & {
  __lastBackupError?: string
  __lastBackupStatus?: BackupOutcome
  __localBackupScan?: BackupScan
  __localBackupDebug?: () => unknown
  __lastRestoreError?: string
  __restoreWarning?: string
  __restoreProgress?: HistoryImportProgress | { stage: 'decoding'; percent: number }
}

const debugWindow = () => window as LocalBackupWindow

const readStorage = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const writeStorage = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 隐私模式/配额满：只影响可观测性，不影响返回结果
  }
}

const clip = (text: string): string => (text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS)}…` : text)

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message ? `${error.name}: ${error.message}` : error.name
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    const text = JSON.stringify(error)
    return text === undefined ? String(error) : text
  } catch {
    return String(error)
  }
}

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)}MB` : `${Math.max(0, Math.round(bytes / 1024))}KB`

let lastOutcome: BackupOutcome | null = null

/** 记一条结果：成功只更新状态，失败额外写 window/localStorage/console，重启后也能查。 */
const recordOutcome = (outcome: BackupOutcome): void => {
  lastOutcome = outcome
  const w = debugWindow()
  w.__lastBackupStatus = outcome
  writeStorage(LAST_ATTEMPT_KEY, String(outcome.at))
  if (outcome.ok) {
    return
  }
  const text = clip(
    `[${new Date(outcome.at).toISOString()}] ${outcome.reason ?? 'unknown'}: ${outcome.message ?? ''}`
  )
  w.__lastBackupError = text
  writeStorage(LAST_ERROR_KEY, text)
  console.warn('[localBackup] backup failed:', text)
}

/** 最近一次尝试（成功或失败）的结果；页面刷新后为 null，持久化信息看 lastBackupError()/lastBackupAt()。 */
export const lastBackupStatus = (): BackupOutcome | null => lastOutcome

/** 最近一次失败文案（持久化，重启后仍在）；从未失败返回空字符串。 */
export const lastBackupError = (): string => readStorage(LAST_ERROR_KEY) ?? ''

export const clearLastBackupError = () => {
  writeStorage(LAST_ERROR_KEY, '')
  debugWindow().__lastBackupError = undefined
}

const lastScanWindow = () => debugWindow()

let lastScan: BackupScan | null = null

/** 最近一次目录扫描结果（过滤/删除了哪些坏包）。 */
export const lastBackupScan = (): BackupScan | null => lastScan

/**
 * 列出可用的本地备份。
 *
 * 与旧实现的区别：
 * 1. 过滤 size < MIN_BACKUP_BYTES 的坏包（历史 307 字节空归档），并**在扫描时删掉**，
 *    不再等下一次成功备份的 pruneBackups —— 坏包不该出现在设置页里被点「恢复」再失败。
 * 2. 只删自己前缀（dschat-auto-）的坏包；用户手工拷进目录的 ZIP 即便判定不可用也只隐藏不删。
 * 3. JSON 解析失败不再静默返回空数组：记 lastBackupScan().error + console.warn。
 */
export const listLocalBackups = (): BackupEntry[] => {
  const api = bridge()
  if (!api || !safeHasAccess(api)) {
    lastScan = {
      at: Date.now(),
      total: 0,
      usable: 0,
      removed: [],
      error: api ? 'no-access' : 'unsupported',
    }
    lastScanWindow().__localBackupScan = lastScan
    return []
  }
  let raw: unknown
  try {
    raw = JSON.parse(api.listBackups())
  } catch (error) {
    const message = `listBackups 解析失败：${describeError(error)}`
    lastScan = { at: Date.now(), total: 0, usable: 0, removed: [], error: message }
    lastScanWindow().__localBackupScan = lastScan
    console.warn('[localBackup]', message)
    return []
  }
  const parsed = Array.isArray(raw) ? raw : []
  const usable: BackupEntry[] = []
  const removed: BackupEntry[] = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const candidate = item as { name?: unknown; size?: unknown; modified?: unknown }
    if (typeof candidate.name !== 'string' || candidate.name.length === 0) {
      continue
    }
    const size = typeof candidate.size === 'number' && Number.isFinite(candidate.size) ? candidate.size : 0
    const modified =
      typeof candidate.modified === 'number' && Number.isFinite(candidate.modified) ? candidate.modified : 0
    const entry: BackupEntry = { name: candidate.name, size, modified }
    if (entry.size < MIN_BACKUP_BYTES) {
      removed.push(entry)
      if (entry.name.startsWith(BACKUP_PREFIX)) {
        try {
          if (!api.deleteBackup(entry.name)) {
            console.warn('[localBackup] failed to delete broken backup:', entry.name)
          }
        } catch (error) {
          console.warn('[localBackup] delete broken backup threw:', describeError(error))
        }
      }
      continue
    }
    usable.push(entry)
  }
  lastScan = { at: Date.now(), total: parsed.length, usable: usable.length, removed }
  lastScanWindow().__localBackupScan = lastScan
  if (removed.length > 0) {
    console.warn('[localBackup] removed broken backups:', removed.map((entry) => `${entry.name}(${entry.size}B)`))
  }
  return usable.sort((a, b) => b.modified - a.modified)
}

const toBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma < 0 ? result : result.slice(comma + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.onabort = () => reject(new Error('FileReader aborted'))
    reader.readAsDataURL(blob)
  })

const stamp = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}


/* ---------------- 大文件分块过桥 ---------------- */

/** 小于这个体积直接走一次性 Base64 桥，简单可靠。 */
const DIRECT_BRIDGE_BYTES = 8 * 1024 * 1024
/** 分块大小：4MB 原始数据 → 约 5.3MB Base64，单块内存可控。 */
const BRIDGE_CHUNK_BYTES = 4 * 1024 * 1024

/** 原生桥的分块能力（大文件读写，避免一次性 Base64）。 */
type ChunkBridge = {
  saveBackup?: (name: string, base64: string) => boolean
  beginBackupWrite?: (name: string) => boolean
  appendBackup?: (name: string, base64: string) => boolean
  finishBackupWrite?: (name: string, expectedSize: number) => boolean
  abortBackupWrite?: (name: string) => boolean
  readBackup?: (name: string) => string | null
  readBackupChunk?: (name: string, offset: number, length: number) => string | null
  backupSize?: (name: string) => number
}

/** 写入备份：小包一次性，大包分块 append，避免超大 Base64 一次过桥。 */
const saveBlobViaBridge = async (api: ChunkBridge, name: string, blob: Blob): Promise<boolean> => {
  if (blob.size <= DIRECT_BRIDGE_BYTES && typeof api.saveBackup === 'function') {
    return api.saveBackup(name, await toBase64(blob)) === true
  }
  if (typeof api.beginBackupWrite !== 'function' || typeof api.appendBackup !== 'function' || typeof api.finishBackupWrite !== 'function') {
    throw new Error('原生桥不支持分块写入')
  }
  if (api.beginBackupWrite(name) !== true) {
    return false
  }
  try {
    for (let offset = 0; offset < blob.size; offset += BRIDGE_CHUNK_BYTES) {
      const part = blob.slice(offset, Math.min(offset + BRIDGE_CHUNK_BYTES, blob.size))
      if (api.appendBackup(name, await toBase64(part)) !== true) {
        api.abortBackupWrite?.(name)
        return false
      }
    }
    return api.finishBackupWrite(name, blob.size) === true
  } catch (error) {
    api.abortBackupWrite?.(name)
    throw error
  }
}

/** Base64 片段解码成字节（复用 atob，单块 4MB 可控）。 */
const chunkToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/** 读取备份：小包一次性，大包按块读并拼成 Blob。 */
const readBlobViaBridge = async (api: ChunkBridge, name: string, size: number): Promise<Blob | null> => {
  if (size <= DIRECT_BRIDGE_BYTES && typeof api.readBackup === 'function') {
    const base64 = api.readBackup(name)
    if (!base64) {
      return null
    }
    const bytes = chunkToBytes(base64)
    return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], {
      type: 'application/zip',
    })
  }
  if (typeof api.readBackupChunk !== 'function') {
    throw new Error('原生桥不支持分块读取')
  }
  const parts: BlobPart[] = []
  for (let offset = 0; offset < size; offset += BRIDGE_CHUNK_BYTES) {
    const base64 = api.readBackupChunk(name, offset, BRIDGE_CHUNK_BYTES)
    if (!base64) {
      return null
    }
    const chunk = chunkToBytes(base64)
    parts.push(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer)
  }
  return new Blob(parts, { type: 'application/zip' })
}

const fnv1a = (hash: number, bytes: Uint8Array): number => {
  let value = hash
  for (let i = 0; i < bytes.length; i += 1) {
    value ^= bytes[i]
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}

/**
 * ZIP 内容指纹（大小 + 首尾各 4KB 的 FNV-1a）。
 *
 * 30 秒去重如果只比 byte size，两次"大小碰巧相同"的导出会被误判为没变化，
 * 新数据就不会落盘。这里在写盘时把指纹存进 localStorage，下次先比指纹再比时间窗口。
 * 指纹读失败不影响备份（退化为只比大小 + 时间窗口）。
 */
const blobFingerprint = async (blob: Blob): Promise<string> => {
  const headLength = Math.min(blob.size, FINGERPRINT_SAMPLE)
  const head = new Uint8Array(await blob.slice(0, headLength).arrayBuffer())
  const tailStart = Math.max(0, blob.size - FINGERPRINT_SAMPLE)
  const tail = new Uint8Array(await blob.slice(tailStart).arrayBuffer())
  const hash = fnv1a(fnv1a(2166136261, head), tail)
  return `${blob.size.toString(36)}-${hash.toString(36)}`
}

/** 清理：只保留最近 MAX_BACKUPS 份**自动**备份（不动用户手工放进目录的文件）。 */
const pruneBackups = (entries: BackupEntry[]) => {
  const api = bridge()
  if (!api) {
    return
  }
  const fulls = entries.filter((entry) => entry.name.startsWith(BACKUP_PREFIX))
  const incs = entries.filter((entry) => entry.name.startsWith(INC_PREFIX))
  const manual = entries.filter((entry) => entry.name.startsWith(MANUAL_PREFIX))

  const newestFulls = [...fulls].sort((a, b) => b.modified - a.modified).slice(0, MAX_BACKUPS)
  const keep = new Set(newestFulls.map((entry) => entry.name))
  const baseline = newestFulls[0]
  /*
   * 增量链只对最新基线有意义：比基线还旧的增量恢复时找不到基线，
   * 留着只会占体积、还会出现在恢复列表里让人困惑，所以一起清掉。
   */
  const keepIncs = incs
    .filter((entry) => !baseline || entry.modified >= baseline.modified)
    .sort((a, b) => b.modified - a.modified)
    .slice(0, INC_CHAIN_MAX)
  for (const entry of keepIncs) {
    keep.add(entry.name)
  }
  const keepManual = [...manual].sort((a, b) => b.modified - a.modified).slice(0, MAX_MANUAL_BACKUPS)
  for (const entry of keepManual) {
    keep.add(entry.name)
  }

  for (const entry of entries) {
    if (keep.has(entry.name)) {
      continue
    }
    try {
      if (!api.deleteBackup(entry.name)) {
        console.warn('[localBackup] prune failed:', entry.name)
      }
    } catch (error) {
      console.warn('[localBackup] prune threw:', describeError(error))
    }
  }
}

const runBackup = async (trigger: BackupTrigger): Promise<string | null> => {
  const startedAt = Date.now()
  const api = bridge()
  if (!api) {
    recordOutcome({
      at: startedAt,
      trigger,
      ok: false,
      reason: 'unsupported',
      message: '当前环境没有本地备份桥（不是 Android App，或原生 BackupBridge 未注册）',
    })
    return null
  }
  if (!safeHasAccess(api)) {
    recordOutcome({
      at: startedAt,
      trigger,
      ok: false,
      reason: 'no-access',
      message: `没有「所有文件访问权限」，无法写入备份目录 ${backupDir()}`,
    })
    return null
  }
  // 先按保留策略清掉旧包：哪怕这次直接去重返回，也要保证目录不会越积越多
  try {
    pruneBackups(listLocalBackups())
  } catch {
    // 清理失败不影响备份本身
  }
  // 阶段标记：决定 catch 时归因为 export-failed / save-failed
  let stage: 'export' | 'save' = 'export'
  try {
    /*
     * 自动/定时备份默认走「增量」：只导出自上次成功备份后有变化的会话。
     * 完整导出 700+ 会话要几分钟、一百多 MB；而两次备份之间往往只多一两条对话，
     * 每次都全量既慢又费电。规则：
     * - 首次、或没有完整基线、或增量链过长、或变化会话过多 → 做完整备份
     * - 没有变化 → 直接跳过（记 dedupe，不算失败）
     * - 其它 → 增量包（几百 KB，几秒）
     * 「立即备份」也走增量：用户手动点一下通常只想备份刚聊完的内容，不该再等几分钟全量。
     * 需要完整快照时用「导出所有历史对话」。
     */
    const fullBaseline = readStorage(BASE_KEY) ?? ''
    const baselineExists = !!fullBaseline && listLocalBackups().some((entry) => entry.name === fullBaseline)
    const lastAt = lastBackupAt()
    const { sessions: allSummaries } = useChatStore.getState()
    const changedCount =
      lastAt > 0 ? allSummaries.filter((summary) => Number(summary.updatedAt) > lastAt - 120_000).length : allSummaries.length
    const incCount = listLocalBackups().filter((entry) => entry.name.startsWith(INC_PREFIX)).length
    const wantIncremental =
      baselineExists && lastAt > 0 && changedCount > 0 && changedCount <= INC_MAX_SESSIONS && incCount < INC_CHAIN_MAX
    if (lastAt > 0 && changedCount === 0 && baselineExists) {
      writeStorage(LAST_BACKUP_KEY, String(Date.now()))
      writeStorage(LAST_ATTEMPT_KEY, String(startedAt))
      recordOutcome({
        at: startedAt,
        trigger,
        ok: true,
        deduped: true,
        fileName: fullBaseline,
        size: 0,
        durationMs: Date.now() - startedAt,
      })
      return fullBaseline
    }
    let blob: Blob
    let fileName: string
    let incremental = false
    const reportProgress = (percent: number) => {
      const target = window as unknown as { __backupProgress?: { percent: number } | null }
      target.__backupProgress = { percent: Math.max(0, Math.min(100, percent)) }
    }
    if (wantIncremental) {
      const { blob: incBlob, sessions: incSessions } = (await exportIncremental(lastAt, reportProgress)) ?? {}
      if (!incBlob || incSessions === undefined) {
        writeStorage(LAST_BACKUP_KEY, String(Date.now()))
        recordOutcome({ at: startedAt, trigger, ok: true, deduped: true, fileName: fullBaseline, size: 0, durationMs: Date.now() - startedAt })
        return fullBaseline
      }
      blob = incBlob
      fileName = INC_PREFIX + (safeDeviceTag(api) ? safeDeviceTag(api) + '-' : '') + stamp(new Date()) + '.zip'
      incremental = true
    } else {
      const full = await exportHistory({ onProgress: reportProgress })
      blob = full.blob
      fileName = BACKUP_PREFIX + (safeDeviceTag(api) ? safeDeviceTag(api) + '-' : '') + stamp(new Date()) + '.zip'
      writeStorage(BASE_KEY, fileName)
    }
    const size = blob ? blob.size : 0
    if (!blob || size < MIN_BACKUP_BYTES) {
      recordOutcome({
        at: startedAt,
        trigger,
        ok: false,
        reason: 'empty-archive',
        message: `导出结果只有 ${size} 字节（低于最小可信大小 ${MIN_BACKUP_BYTES}），已丢弃，不落盘成"成功备份"`,
        size,
        durationMs: Date.now() - startedAt,
      })
      return null
    }
    if (size > MAX_BACKUP_BYTES) {
      recordOutcome({
        at: startedAt,
        trigger,
        ok: false,
        reason: 'too-large',
        message: `导出包 ${formatSize(size)} 超过自动备份上限 ${formatSize(MAX_BACKUP_BYTES)}，已跳过（Base64 桥内存峰值约 6~8 倍）。可改用「导出全部历史」手动保存 ZIP。`,
        size,
        durationMs: Date.now() - startedAt,
      })
      return null
    }
    const fingerprint = await blobFingerprint(blob).catch(() => '')
    const existing = listLocalBackups()
    const newest = existing[0]
    const recent = !!newest && startedAt - newest.modified < DUPLICATE_WINDOW
    const unchanged =
      !!fingerprint && fingerprint === (readStorage(FINGERPRINT_KEY) ?? '') && !!newest && newest.size === size
    if (recent && unchanged && newest.name.startsWith(BACKUP_PREFIX)) {
      // 内容没变：复用上一份包，不再写重复文件；仍然算一次成功（刷新 lastBackupAt）
      writeStorage(LAST_BACKUP_KEY, String(startedAt))
      recordOutcome({
        at: startedAt,
        trigger,
        ok: true,
        deduped: true,
        fileName: newest.name,
        size: newest.size,
        durationMs: Date.now() - startedAt,
      })
      return newest.name
    }
    stage = 'save'
    let saved = false
    try {
      saved = await saveBlobViaBridge(api as unknown as ChunkBridge, fileName, blob)
    } catch (error) {
      // 桥里 OutOfMemoryError/异常会在这里冒出来，按写盘失败记录
      recordOutcome({
        at: startedAt,
        trigger,
        ok: false,
        reason: 'save-failed',
        message: `原生写入备份失败（${formatSize(size)}）：${describeError(error)}`,
        fileName,
        size,
        durationMs: Date.now() - startedAt,
      })
      return null
    }
    if (!saved) {
      recordOutcome({
        at: startedAt,
        trigger,
        ok: false,
        reason: 'save-failed',
        message: `原生 saveBackup 返回 false（${formatSize(size)}）：权限被撤销、存储空间不足或 Base64 解码失败`,
        fileName,
        size,
        durationMs: Date.now() - startedAt,
      })
      return null
    }
    // 写完回读校验：文件确实存在且大小对得上，才算成功
    const written = listLocalBackups().find((entry) => entry.name === fileName)
    if (!written || written.size < MIN_BACKUP_BYTES) {
      try {
        api.deleteBackup(fileName)
      } catch {
        // 残留删除失败不改变"本次未成功"的结论
      }
      recordOutcome({
        at: startedAt,
        trigger,
        ok: false,
        reason: 'verify-failed',
        message: `写入后回读校验失败（期望 ${formatSize(size)}，读到 ${written ? formatSize(written.size) : '空'}），已删除残留`,
        fileName,
        size,
        durationMs: Date.now() - startedAt,
      })
      return null
    }
    writeStorage(LAST_BACKUP_KEY, String(Date.now()))
    if (!incremental) {
      writeStorage(BASE_KEY, fileName)
    }
    if (fingerprint) {
      writeStorage(FINGERPRINT_KEY, fingerprint)
    }
    recordOutcome({
      at: startedAt,
      trigger,
      ok: true,
      fileName,
      size: written.size,
      durationMs: Date.now() - startedAt,
    })
    pruneBackups(listLocalBackups())
    return fileName
  } catch (error) {
    const reason: LocalBackupFailure = stage === 'export' ? 'export-failed' : 'save-failed'
    const prefix = stage === 'export' ? '导出失败' : '写入备份失败'
    recordOutcome({
      at: startedAt,
      trigger,
      ok: false,
      reason,
      message: `${prefix}：${describeError(error)}`,
      durationMs: Date.now() - startedAt,
    })
    return null
  }
}

/** 正在进行的备份（导出可能要几分钟，期间重复触发直接复用同一个 Promise，不写重复包）。 */
let inFlight: Promise<string | null> | null = null

/**
 * 立刻导出一次到公共目录。返回写入的文件名，失败返回 null（失败原因见 lastBackupStatus()）。
 *
 * trigger 只用于诊断记录：App.tsx 传 'auto'、设置页传 'manual'（不传也可以，兼容旧调用）。
 */
export const backupLocal = (trigger: BackupTrigger = 'unspecified'): Promise<string | null> => {
  if (inFlight) {
    return inFlight
  }
  const task = runBackup(trigger)
  inFlight = task.finally(() => {
    inFlight = null
  })
  return inFlight
}

let timer = 0
/** 会话有改动后调用：节流到 10 分钟一次，避免频繁导出拖慢设备。 */
export const scheduleLocalBackup = () => {
  if (!localBackupEnabled() || !localBackupReady()) {
    return
  }
  window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    void backupLocal('schedule').catch((error) => {
      console.warn('[localBackup] scheduled backup crashed:', describeError(error))
    })
  }, DEFAULT_INTERVAL)
}

export type RestoreFailure =
  | 'unsupported'
  | 'no-access'
  | 'missing'
  | 'too-large'
  | 'read-failed'
  | 'decode-failed'

/**
 * 把导出的 ZIP 直接写进本地备份目录（分块过桥）。
 * 供「导出所有历史对话 → 下载」在大包时代替 MediaStore/Base64 一次性写入：
 * 大包走 MediaStore 需要整份 Base64 字符串，一百多 MB 会直接把 WebView 内存打爆。
 */
export const saveZipToBackupDir = async (fileName: string, blob: Blob): Promise<string> => {
  const api = bridge()
  if (!api) {
    throw new Error('本地备份桥不可用（不是 Android App）')
  }
  if (!safeHasAccess(api)) {
    throw new Error('没有「所有文件访问权限」，无法写入 ' + backupDir())
  }
  const safeName = fileName.toLowerCase().endsWith('.zip') ? fileName : fileName + '.zip'
  const ok = await saveBlobViaBridge(api as unknown as ChunkBridge, safeName, blob)
  if (!ok) {
    throw new Error('写入失败：' + backupDir() + '/' + safeName)
  }
  // 登记进系统媒体库，这样「文件管理 → 最近」里能直接看到导出的 zip
  try {
    api.scanMedia?.(safeName)
  } catch {
    // 登记失败不影响导出本身
  }
  return backupDir() + '/' + safeName
}

/** 记录并抛出恢复失败：原因写进 window.__lastRestoreError，设置页/支持可直接看。 */
const failRestore = (reason: RestoreFailure, message: string): never => {
  const text = `[${reason}] ${message}`
  debugWindow().__lastRestoreError = clip(text)
  console.warn('[localBackup] restore failed:', text)
  throw new Error(text)
}


/**
 * 从备份文件恢复（合并导入）。
 *
 * 大包注意事项（桥是整份 Base64 字符串，无法流式）：
 * - 先按 listLocalBackups 里的文件大小判断上限，超限直接报错，不去调用 readBackup 赌内存；
 * - 20MB 起写 window.__restoreWarning 并 console.warn；
 * - 解码后立刻把 base64 字符串引用置空，再构造 File，让 GC 能尽早回收（峰值少一份 N~2.67N）；
 * - 任何失败都会写 window.__lastRestoreError（含原因枚举），供设置页/support 展示。
 * 真正的流式方案要改原生的分块读写接口（见交接报告 68 的 B.7），当前 JS 侧只能做到上面这些。
 */
export const restoreLocalBackup = async (name: string): Promise<void> => {
  const w = debugWindow()
  w.__lastRestoreError = undefined
  w.__restoreWarning = undefined
  w.__restoreProgress = undefined
  const api = bridge()
  if (!api) {
    throw failRestore('unsupported', '本地备份桥不可用（不是 Android App）')
  }
  if (!safeHasAccess(api)) {
    throw failRestore('no-access', `没有「所有文件访问权限」，无法读取备份目录 ${backupDir()}`)
  }
  const entry = listLocalBackups().find((item) => item.name === name)
  if (!entry) {
    throw failRestore(
      'missing',
      `没有找到备份 ${name}：文件已被删除，或小于 ${MIN_BACKUP_BYTES} 字节被判定为坏包（扫描时已清理）`
    )
  }
  if (entry.size > MAX_RESTORE_BYTES) {
    throw failRestore(
      'too-large',
      `备份 ${formatSize(entry.size)} 超过本机可安全恢复的上限 ${formatSize(MAX_RESTORE_BYTES)}：Base64 桥要同时持有约 6~7 倍包体积的内存，继续恢复会内存不足崩溃。请改用「导入历史」直接选择该 ZIP 文件（文件选择器不经过 Base64 桥，内存更省）。`
    )
  }
  if (entry.size > RESTORE_WARN_BYTES) {
    w.__restoreWarning = `备份 ${formatSize(entry.size)} 较大，恢复时内存峰值约 ${formatSize(entry.size * 6)}，请保持前台并耐心等待`
    console.warn('[localBackup]', w.__restoreWarning)
  }
  /*
   * 增量备份恢复：一个「完整基线包 + 若干增量包」组成一条链。
   * 用户点增量包时，先恢复它所属的完整基线，再按时间顺序叠加到它为止的增量。
   */
  const chain: BackupEntry[] = []
  if (entry.name.startsWith(INC_PREFIX)) {
    const all = listLocalBackups()
    const baseline = all.find(
      (item) => item.name.startsWith(BACKUP_PREFIX) && item.modified <= entry.modified
    )
    if (!baseline) {
      throw failRestore(
        'missing',
        `增量备份 ${name} 找不到对应的完整基线包（可能已被清理）。请改用最近的一份完整备份恢复。`
      )
    }
    chain.push(baseline)
    for (const item of all.filter((value) => value.name.startsWith(INC_PREFIX) && value.modified > baseline.modified && value.modified <= entry.modified)) {
      chain.push(item)
    }
    chain.push(entry)
  } else {
    chain.push(entry)
  }
  for (const part of chain) {
    await restoreOnePackage(part)
  }
  w.__restoreProgress = { stage: 'saving' }
}

/** 恢复单个 ZIP 包（链式恢复时按顺序调用）。 */
const restoreOnePackage = async (entry: BackupEntry): Promise<void> => {
  const w = debugWindow()
  w.__restoreProgress = { stage: 'reading', percent: 0 }
  const api = bridge()
  if (!api) {
    throw failRestore('unsupported', '本地备份桥不可用（不是 Android App）')
  }
  let zipBlob: Blob | null = null
  try {
    zipBlob = await readBlobViaBridge(api as unknown as ChunkBridge, entry.name, entry.size)
  } catch (error) {
    throw failRestore(
      'read-failed',
      `桥读取备份失败（${formatSize(entry.size)}）：${describeError(error)}。可改用「导入历史」直接选择该 ZIP 文件`
    )
  }
  if (!zipBlob) {
    throw failRestore(
      'read-failed',
      `读取备份失败（${formatSize(entry.size)}）：文件不存在、权限被撤销，或原生读取内存不足`
    )
  }
  if (zipBlob.size < MIN_BACKUP_BYTES) {
    throw failRestore('decode-failed', `读取到 ${zipBlob.size} 字节（低于最小可信大小 ${MIN_BACKUP_BYTES}），文件已损坏`)
  }
  const file = new File([zipBlob], entry.name, { type: 'application/zip' })
  w.__restoreProgress = { stage: 'reading', percent: 0 }
  try {
    await importHistory(file, 'merge', (progress) => {
      w.__restoreProgress = progress
    })
  } catch (error) {
    w.__lastRestoreError = clip(`[import-failed] ${describeError(error)}`)
    console.warn('[localBackup] restore import failed:', error)
    throw error
  }
}

export const lastBackupAt = () => Number(readStorage(LAST_BACKUP_KEY) ?? 0) || 0

/** 上次**尝试**备份的时间（成功失败都算）；供调度侧做失败退避，避免切后台时反复跑完整导出。 */
export const lastBackupAttemptAt = () => Number(readStorage(LAST_ATTEMPT_KEY) ?? 0) || 0

/** 一次性诊断快照：设置页「诊断」按钮或远程调试可直接调用（同时挂在 window.__localBackupDebug 上）。 */
export const backupDebugState = () => {
  const api = bridge()
  return {
    supported: localBackupSupported(),
    enabled: localBackupEnabled(),
    ready: localBackupReady(),
    inFlight: inFlight !== null,
    dir: backupDir(),
    deviceTag: deviceTag(),
    bridge: api ? { present: true, access: safeHasAccess(api) } : { present: false, access: false },
    limits: {
      minBytes: MIN_BACKUP_BYTES,
      maxBackupBytes: MAX_BACKUP_BYTES,
      maxRestoreBytes: MAX_RESTORE_BYTES,
      restoreWarnBytes: RESTORE_WARN_BYTES,
      maxBackups: MAX_BACKUPS,
      duplicateWindowMs: DUPLICATE_WINDOW,
    },
    lastBackupAt: lastBackupAt(),
    lastAttemptAt: lastBackupAttemptAt(),
    lastStatus: lastBackupStatus(),
    lastError: lastBackupError(),
    lastScan: lastBackupScan(),
    restore: {
      error: debugWindow().__lastRestoreError,
      warning: debugWindow().__restoreWarning,
      progress: debugWindow().__restoreProgress,
    },
  }
}

debugWindow().__localBackupDebug = backupDebugState

/**
 * 调试/验证入口：手动按指定 trigger 触发一次备份。
 * 生产里由 App.tsx 定时调用 backupLocal('auto')；保留这个钩子方便远程排查
 * 「自动备份到底跑没跑、跑了多久、是完整包还是增量包」。
 */
const debugWindowAny = window as unknown as { __backupNow?: (trigger?: BackupTrigger) => Promise<string | null> }
debugWindowAny.__backupNow = (trigger: BackupTrigger = 'auto') => backupLocal(trigger)
