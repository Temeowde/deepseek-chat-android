import { Zip, ZipPassThrough } from 'fflate'
import * as db from '../db.js'
import type { Session } from '../types.js'
import { BackupError } from './errors.js'
import { EXPORT_FORMAT_VERSION, type Manifest, type SessionIndexEntry } from './format.js'
import { INDEX_PATH, MANIFEST_PATH, imagePath, sessionPath } from './paths.js'
import { toIndexEntry, toSessionFile, type ArchiveConversionStats } from './toArchive.js'
import { ArchiveLimitError } from './zipWriter.js'

/**
 * 按导出格式生成 ZIP：manifest → 全部会话 JSON → index → 全部图片。没有账号信息，不写 user.json。
 * 只写出本地有原件的图片，每个会话目录各写一份；其他附件只有元数据。
 *
 * 分两遍写：
 * 1. 逐个会话转换并写入 JSON，同时记下该会话引用的图片（此时只查原件在不在，不驻留）；
 * 2. 全部会话 JSON 写完后，按会话逐个读图片原件 → 写入 ZIP → 立刻释放。
 *
 * zipWriter 的 writeArchive 只能一次性收下全部条目、最后返回完整 Blob：条目数组里的图片原件
 * 会一直驻留到打包结束，大账号导出时峰值≈「全部原件 + 成品」两份。按会话分批写入后，任意时刻
 * 只需要当前会话的图片原件在内存里；条目顺序仍与 paths.ts 的约定一致。
 */

const ZIP64_SIZE = 0xffffffff
const ZIP64_COUNT = 0xffff

/** 写 ZIP 时读原件的分块大小：块越大，fflate 的 push/CRC 调用和 Blob 分片越少，峰值只多一块。 */
const CHUNK_BYTES = 4 * 1024 * 1024

const invalid = (): never => {
  throw new Error('Invalid history archive entry')
}

/** 与 zipWriter/zipReader 相同的条目名规则；返回 NFC 规范化后的名字与 UTF-8 字节数。 */
const archiveEntryName = (name: string) => {
  const normalized = name.normalize('NFC')
  if (
    !normalized ||
    normalized.includes('\\') ||
    normalized.includes('\0') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    invalid()
  }
  const bytes = new TextEncoder().encode(normalized)
  if (bytes.length > 0xffff) {
    throw new ArchiveLimitError()
  }
  // 拒绝孤立代理项，避免编码时替换成 U+FFFD 后改变附件关联路径。
  if (new TextDecoder().decode(bytes) !== normalized) {
    invalid()
  }
  return { name: normalized, byteLength: bytes.length }
}

/**
 * 增量 ZIP 写入器（STORE，单卷 ZIP32）。
 *
 * 与 zipWriter.writeArchive 的输出保持一致（mtime、data descriptor、中央目录都由 fflate 按同样
 * 顺序生成，CRC32 也由 fflate 在 push 时增量计算，只算一遍）。区别是可以逐个条目喂数据、写完
 * 立即释放源 Blob，不必先把全部条目攒进一个数组。
 * writeArchive 本轮不在可改范围内，所以这里保留一份实现；合并时建议把它移进 zipWriter.ts，
 * 只留一个 ZIP 写入器。
 */
class ArchiveWriter {
  private readonly zip: Zip
  private readonly chunks: Blob[] = []
  private readonly names = new Set<string>()
  private dataSize = 0
  private directorySize = 0
  private size = 0
  private completed = false
  private finished = false

  constructor() {
    this.zip = new Zip((error, chunk, final) => {
      if (error) {
        throw error
      }
      this.size += chunk.byteLength
      if (this.size > this.dataSize + this.directorySize + 22) {
        invalid()
      }
      // 立刻转成 Blob 交出数据，Uint8Array 可以马上被回收；最后只用这些分片拼成品。
      this.chunks.push(new Blob([chunk]))
      this.completed = final
    })
  }

  /** 追加一个条目；不保留 blob 引用，写完就放。 */
  async add(name: string, blob: Blob): Promise<void> {
    if (this.finished) {
      invalid()
    }
    const entry = archiveEntryName(name)
    if (this.names.has(entry.name)) {
      invalid()
    }
    // 与 writeArchive 一致：最多 65534 个条目（65535 是 ZIP64 哨兵值，读取端会拒绝）。
    if (this.names.size + 1 >= ZIP64_COUNT || blob.size >= ZIP64_SIZE) {
      throw new ArchiveLimitError()
    }
    this.names.add(entry.name)
    // 与 writeArchive 一样先累计期望大小：每个条目 = 本地头（46+n）+ 数据 + 中央目录（46+n）。
    this.dataSize += blob.size + 46 + entry.byteLength
    this.directorySize += 46 + entry.byteLength
    if (this.dataSize >= ZIP64_SIZE || this.directorySize >= ZIP64_SIZE) {
      throw new ArchiveLimitError()
    }
    const stream = new ZipPassThrough(entry.name)
    stream.mtime = new Date(1980, 0, 1)
    this.zip.add(stream)
    let written = 0
    for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
      const chunk = new Uint8Array(await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer())
      if (chunk.byteLength === 0) {
        invalid()
      }
      written += chunk.byteLength
      if (written > blob.size) {
        invalid()
      }
      stream.push(chunk)
    }
    if (written !== blob.size) {
      invalid()
    }
    stream.push(new Uint8Array(), true)
  }

  /** 结束归档并返回完整 Blob；失败时抛错，由调用方 terminate。 */
  finish(): Blob {
    if (this.finished) {
      invalid()
    }
    this.finished = true
    this.zip.end()
    if (!this.completed || this.size !== this.dataSize + this.directorySize + 22) {
      invalid()
    }
    return new Blob(this.chunks, { type: 'application/zip' })
  }

  terminate(): void {
    this.finished = true
    this.zip.terminate()
  }
}

/** 本会话要导出的图片条目。 */
type ImageRef = { id: string; path: string }

/** 图片条目名；名字写不进 ZIP（含 NUL、超长等）时返回 null，只保留元数据，不打断导出。 */
const safeImagePath = (sessionId: string, fileId: string, fileName: string): string | null => {
  try {
    const path = imagePath(sessionId, fileId, fileName)
    archiveEntryName(path)
    return path
  } catch {
    return null
  }
}

/** 本会话全部图片引用；invalid 是名字非法、无法写进 ZIP 的唯一图片数。 */
const imageRefs = (session: Session): { refs: ImageRef[]; invalid: number } => {
  const refs: ImageRef[] = []
  const seen = new Set<string>()
  let invalidCount = 0
  for (const message of session.messages) {
    if (message.role !== 'user') {
      continue
    }
    for (const file of message.files) {
      if (!file.isImage) {
        continue
      }
      // 同一 id+文件名在同一会话里只写一个条目；不同会话各写一份（与官方导出一致）。
      const key = JSON.stringify([file.id, file.name])
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      const path = safeImagePath(session.id, file.id, file.name)
      if (path === null) {
        invalidCount += 1
        continue
      }
      refs.push({ id: file.id, path })
    }
  }
  return { refs, invalid: invalidCount }
}

/** 会话条目名（NFC）；ID 还要满足导入校验（schema 的 sessionId），不合法时整条会话跳过。 */
const archivedSessionPath = (id: string): string | null => {
  if (!id || /[/\\]/.test(id) || id === '.' || id === '..') {
    return null
  }
  try {
    return archiveEntryName(sessionPath(id)).name
  } catch {
    return null
  }
}

/** 导出结果统计；上层据此提示「N 张图片没有本地原件」「M 条会话被跳过」。 */
export type ExportReport = {
  /** 实际写出的会话数 */
  sessions: number
  /** 实际写出的消息数 */
  messages: number
  /** 实际写出的图片条目数 */
  images: number
  /** 没有写出的图片条目数：本地没有原件，或条目名与其它文件冲突只能保留元数据 */
  skippedImages: number
  /** 数据损坏/ID 重复而整体跳过的会话数 */
  skippedSessions: number
  /** 时间戳无法表示、已回退为合法时间的个数 */
  invalidTimestamps: number
  /** 其他非法数值（耗时、计数等）已回退的个数 */
  invalidValues: number
  /** 成品大小（字节） */
  bytes: number
}

const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' })

/** 图片要等全部会话 JSON 写完后才写，输入必须可重复遍历；非数组输入先收集一遍。 */
const collectSessions = async (
  sessions: Iterable<Session> | AsyncIterable<Session>,
): Promise<Session[]> => {
  const collected: Session[] = []
  for await (const session of sessions) {
    collected.push(session)
  }
  return collected
}

export const exportArchive = async (
  sessions: Iterable<Session> | AsyncIterable<Session>,
  /** 读会话时的进度：done=已处理会话数，total=总会话数（0 表示未知） */
  onProgress?: (done: number, total: number) => void,
  /** 打包完成后的统计；失败时不回调 */
  onReport?: (report: ExportReport) => void,
): Promise<Blob> => {
  const list: readonly Session[] = Array.isArray(sessions) ? sessions : await collectSessions(sessions)
  const total = list.length
  const writer = new ArchiveWriter()
  const conversion: ArchiveConversionStats = { invalidTimestamps: 0, invalidValues: 0 }
  const index: SessionIndexEntry[] = []
  /** 与 list 同下标：该会话要写的图片；undefined 表示没有可写图片（或会话被跳过）。 */
  const plans: (ImageRef[] | undefined)[] = new Array<ImageRef[] | undefined>(total)
  /** 已写出的会话条目名（NFC），防止重复条目让整次导出失败。 */
  const written = new Set<string>()
  let done = 0
  let messages = 0
  let skippedImages = 0
  let skippedSessions = 0
  try {
    const manifest: Manifest = { export_format_version: EXPORT_FORMAT_VERSION }
    await writer.add(MANIFEST_PATH, json(manifest))
    for (const [position, session] of list.entries()) {
      onProgress?.(done, total)
      done += 1
      const entry = archivedSessionPath(session.id)
      // 同名条目（含仅 NFC 不同）只写一次；ID 不合法或重复时跳过，不让一个脏会话毁掉整次导出。
      if (entry === null || written.has(entry)) {
        skippedSessions += 1
        continue
      }
      try {
        const { refs, invalid: invalidImages } = imageRefs(session)
        let sessionSkippedImages = invalidImages
        // 单会话先单独计数：会话转换失败被跳过时，不能把没导出的字段算进报告。
        const sessionStats: ArchiveConversionStats = { invalidTimestamps: 0, invalidValues: 0 }
        // 第一遍只确认原件存在（拿到的是 Blob 句柄，不读数据），写 JSON 用；第二遍才真正读出来。
        // path → 文件 ID：规范化后重名只保留第一个，否则导入端会判「附件数据损坏」。
        const present = new Map<string, string>()
        for (const ref of refs) {
          if (present.has(ref.path)) {
            sessionSkippedImages += 1
            continue
          }
          if (await db.loadFile(ref.id)) {
            present.set(ref.path, ref.id)
          } else {
            sessionSkippedImages += 1
          }
        }
        const data = toSessionFile(
          session,
          ({ id, name, isImage }) => {
            if (!isImage) {
              return null
            }
            // 路径必须与第一遍算出的条目名一致；没有原件/名字非法/条目名冲突时只保留元数据。
            const path = safeImagePath(session.id, id, name)
            return path !== null && present.get(path) === id ? path : null
          },
          sessionStats,
        )
        written.add(entry)
        messages += data.messages.length
        await writer.add(entry, json(data))
        index.push(toIndexEntry(data))
        skippedImages += sessionSkippedImages
        conversion.invalidTimestamps += sessionStats.invalidTimestamps
        conversion.invalidValues += sessionStats.invalidValues
        plans[position] =
          present.size > 0 ? [...present].map(([path, id]) => ({ id, path })) : undefined
      } catch (error) {
        if (!(error instanceof BackupError)) {
          throw error
        }
        // 单条会话的消息树损坏（旧数据/旧版导入）不拖垮整次导出，导入侧也允许缺会话。
        skippedSessions += 1
      }
    }
    await writer.add(INDEX_PATH, json(index))
    // 第二遍：图片按会话逐个读原件 → 写入 → 释放，任意时刻只驻留当前会话的图片。
    let images = 0
    for (const [position, plan] of plans.entries()) {
      if (!plan) {
        continue
      }
      for (const ref of plan) {
        const blob = await db.loadFile(ref.id)
        if (!blob) {
          // 第一遍之后原件被删除：JSON 里已经写了路径，归档允许条目缺失，只计数。
          skippedImages += 1
          continue
        }
        await writer.add(ref.path, blob)
        images += 1
      }
      plans[position] = undefined
    }
    if (written.size === 0) {
      // 不能给用户一个「空备份」：导入侧会把没有会话的归档判为损坏。
      throw new Error('没有可导出的会话内容（本地数据可能已损坏）')
    }
    onProgress?.(total, total)
    const archive = writer.finish()
    onReport?.({
      sessions: written.size,
      messages,
      images,
      skippedImages,
      skippedSessions,
      invalidTimestamps: conversion.invalidTimestamps,
      invalidValues: conversion.invalidValues,
      bytes: archive.size,
    })
    return archive
  } finally {
    writer.terminate()
  }
}
