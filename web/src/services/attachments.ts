import { create } from 'zustand'
import type { LinkedMessage, TranslationMessage } from '../i18n/index.js'
import { uploadFile } from './api/client.js'
import { isAutoRetryableApiError, isRetryableApiError, classifyApiError, getUploadErrorInfo } from './api/errors.js'
import type { FilePurpose } from './api/types.js'
import { ACCEPT_FILE_EXTS } from './uploadExts.js'
import { prepareImageForUpload } from './vision.js'

/** 允许上传的扩展名，按扩展名白名单过滤，清单见 uploadExts.ts */
export const ACCEPTED_EXTS = ACCEPT_FILE_EXTS
/** 选择文件对话框的过滤条件 */
export const ACCEPT = ACCEPTED_EXTS.map((ext) => `.${ext}`).join(',')
/** 单文件大小上限与 Files API 一致 */
export const MAX_SIZE_MB = 64
/** 按 user_data 上传的文件（纯文本、代码、表格、电子书）原文件上限更小 */
export const MAX_USER_DATA_SIZE_MB = 32
export const MAX_COUNT = 50
/** 同时上传的文件数 */
const MAX_CONCURRENT = 3

/** 文件扩展名（小写，不含点）；没有扩展名时为空 */
export const getFileExt = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export const isAcceptedExt = (name: string) => ACCEPTED_EXTS.includes(getFileExt(name))

/**
 * 需要服务端解析的文档；其余非图片文件（纯文本、代码、表格、电子书）无需解析。
 *
 * 解析用途用更便宜的 `text_recognition`（只取文字），不用 `rich_layout_recognition`
 * （文字 + 裁图）。同一个 Key 下前者按页计费更低，普通问答场景不需要文档里的插图。
 */
const TEXT_RECOGNITION_EXTS = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx'])

/** 上传时的 purpose：图片不传，PDF 与 Word、PPT 只取文字，其余按 user_data 上传 */
export const getUploadPurpose = (name: string, isImage: boolean): FilePurpose | null => {
  if (isImage) {
    return null
  }
  return TEXT_RECOGNITION_EXTS.has(getFileExt(name)) ? 'text_recognition' : 'user_data'
}

/** 服务端图片理解不支持、也不能靠文档解析兜底的图片格式 */
const UNSUPPORTED_IMAGE_EXTS = new Set([
  // 服务端图片理解不收、也不是 JPEG/PNG 内容的格式。
  // 注意：jfif / pjpeg / pjp 其实就是 JPEG，apng 就是 PNG，不能拦。
  'svg', 'svgz', 'ico', 'xbm', 'dib', 'avif', 'bmp', 'tif', 'tiff',
])

/** 文件允许的最大体积（MB），按上传时的 purpose 区分 */
const getMaxSizeMB = (file: File) =>
  getUploadPurpose(file.name, isImage(resolveMimeType(file))) === 'user_data'
    ? MAX_USER_DATA_SIZE_MB
    : MAX_SIZE_MB

/** 本地 IndexedDB 读不出原件（损坏/被清理）：不能再显示成普通「上传失败」 */
export class StorageReadError extends Error {
  constructor(readonly fileName?: string) {
    super('read local attachment failed')
    this.name = 'StorageReadError'
  }
}

/** 添加前校验：格式 → 大小 → 数量，任一不满足即整批不添加 */
export const validateFiles = (files: File[], currentCount: number): TranslationMessage | null => {
  if (files.some((file) => !isAcceptedExt(file.name))) {
    return { key: 'uploadUnsupportedFormat' }
  }
  if (files.some((file) => file.size === 0)) {
    return { key: 'uploadEmptyFile' }
  }
  // 按扩展名拦，别依赖 MIME：部分 provider 不返回 MIME，会让这些文件漏到上传阶段才失败
  if (files.some((file) => UNSUPPORTED_IMAGE_EXTS.has(getFileExt(file.name)))) {
    return { key: 'uploadUnsupportedImageFormat' }
  }
  const oversized = files.find((file) => file.size > getMaxSizeMB(file) * 1024 * 1024)
  if (oversized) {
    return { key: 'uploadMaxMBSize', params: { size: getMaxSizeMB(oversized) } }
  }
  if (currentCount + files.length > MAX_COUNT) {
    return { key: 'uploadMaxFiles', params: { count: MAX_COUNT } }
  }
  return null
}

/**
 * 上传失败在附件上显示的文案：与设计稿状态对应的用具体原因，其余统一「上传失败」。
 * 服务端原文多为英文且较长，不直接展示。
 */
export const describeUploadError = (error: unknown): TranslationMessage => {
  if (error instanceof StorageReadError) {
    return { key: 'uploadLocalReadFailed' }
  }
  // 客户端上传超时（DOMException TimeoutError）也要给出可行动文案
  if (error instanceof Error && /timeout/i.test(error.name + ' ' + error.message)) {
    return { key: 'uploadTooSlow' }
  }
  const info = getUploadErrorInfo(error)
  if (info) {
    if (info.code === 'unauthorized') {
      return { key: 'uploadKeyInvalid' }
    }
    if (info.code === 'insufficientBalance') {
      return { key: 'uploadInsufficientBalance' }
    }
    if (info.code === 'tooSlow') {
      return { key: 'uploadTooSlow' }
    }
    if (info.code === 'tooLarge') {
      return { key: 'uploadTooLarge' }
    }
    if (info.code === 'rateLimited') {
      return { key: 'uploadRateLimited' }
    }
    if (info.code === 'parseFailed') {
      return { key: 'uploadParseFailed' }
    }
  }
  if (classifyApiError(error) === 'serverBusy') {
    return { key: 'uploadServerBusy' }
  }
  return { key: 'uploadFileStatusFailed' }
}

type NoticeListener = (notice: LinkedMessage) => void
const noticeListeners = new Set<NoticeListener>()

/** 订阅需要额外提示的上传失败（配额达到上限），由界面层转成 toast */
export const onUploadNotice = (listener: NoticeListener) => {
  noticeListeners.add(listener)
  return () => {
    noticeListeners.delete(listener)
  }
}

/** 删除已上传文件的接口文档 */
const DELETE_FILE_DOCS_URL = 'https://api-docs.deepseek.com/api/delete-file'

/** 文件数或存储空间达到上限：附件上只放得下「上传失败」，原因另用 toast 说明并引导删除旧文件 */
export const describeUploadQuota = (error: unknown): LinkedMessage | undefined => {
  const info = getUploadErrorInfo(error)
  const link = { key: 'uploadDeleteFiles', href: DELETE_FILE_DOCS_URL } as const
  if (info?.code === 'fileCountLimit') {
    return { type: 'error', key: 'uploadFileCountLimit', params: { limit: info.limit ?? '' }, link }
  }
  if (info?.code === 'storageLimit') {
    return { type: 'error', key: 'uploadStorageLimit', params: { limit: info.limit ?? '' }, link }
  }
  return undefined
}

type Job = () => Promise<void>
const queue: Job[] = []
let running = 0

const next = () => {
  while (running < MAX_CONCURRENT) {
    const job = queue.shift()
    if (!job) {
      return
    }
    running++
    void job().finally(() => {
      running--
      next()
    })
  }
}

/** 排队上传，最多同时上传 MAX_CONCURRENT 个；排队期间中止的任务不会发出请求 */
/** 单次上传超时：图片 90s、文档 180s（服务端文档解析上限 120s） */
const uploadTimeoutMs = (isImage: boolean) => (isImage ? 90_000 : 180_000)

const delay = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

/** 图片压缩卡住时不要卡死整个上传队列：超时就按原图上传，交给服务端判断 */
const prepareImageWithTimeout = async (file: File, name: string) => {
  let timer = 0
  try {
    return await Promise.race([
      prepareImageForUpload(file, name),
      new Promise<{ blob: Blob; name: string }>((resolve) => {
        timer = window.setTimeout(() => resolve({ blob: file, name }), 20_000)
      }),
    ])
  } finally {
    window.clearTimeout(timer)
  }
}

/** 一次上传尝试：带超时，外部取消（signal）时立刻中止 */
const uploadOnce = async (
  apiKey: string,
  file: Blob,
  name: string,
  isImage: boolean,
  signal: AbortSignal
): Promise<string> => {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  }
  const controller = new AbortController()
  const timer = window.setTimeout(
    () => controller.abort(new DOMException('上传超时', 'TimeoutError')),
    uploadTimeoutMs(isImage)
  )
  const onAbort = () => controller.abort(signal.reason)
  if (signal.aborted) {
    controller.abort(signal.reason)
  } else {
    signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const original = file instanceof File ? file : new File([file], name, { type: file.type })
    const prepared = isImage
      ? await prepareImageWithTimeout(original, name)
      : { blob: original, name }
    const body =
      prepared.blob instanceof File
        ? prepared.blob
        : new File([prepared.blob], prepared.name, { type: prepared.blob.type })
    const uploaded = await uploadFile(apiKey, body, getUploadPurpose(prepared.name, isImage), controller.signal)
    return uploaded.id
  } finally {
    window.clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
}

/** 排队上传，最多同时上传 MAX_CONCURRENT 个；网络/限流类错误自动重试一次 */
const enqueueUpload = (
  apiKey: string,
  file: Blob,
  name: string,
  isImage: boolean,
  signal: AbortSignal
) =>
  new Promise<string>((resolve, reject) => {
    queue.push(async () => {
      if (signal.aborted) {
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
        return
      }
      try {
        resolve(await uploadOnce(apiKey, file, name, isImage, signal))
      } catch (error) {
        if (signal.aborted || !isAutoRetryableApiError(error)) {
          reject(error)
          return
        }
        // 网络抖动/限流/超时/5xx：等 1.5 秒自动重试一次，仍失败再交给界面
        try {
          await delay(1500, signal)
          resolve(await uploadOnce(apiKey, file, name, isImage, signal))
        } catch (retryError) {
          reject(retryError)
        }
      }
    })
    next()
  })

/**
 * 上传任务按附件的本地 id 登记：输入框选中即开始上传，全部成功后携带 serverId 发送，
 * 不会重复上传；导入的历史附件没有任务，发送前按本地原件补传。
 * 任务只在内存里，历史附件补传未完成时，刷新后会在下次请求前重新上传。
 *
 * `inline` 是第三种终态：非 DeepSeek 通道（WorkBuddy / 自定义）的图片不上传，
 * 直接用本地原件转 base64 内联进请求。
 */
export type UploadTask =
  | { status: 'uploading' }
  | { status: 'done'; serverId: string }
  | { status: 'inline' }
  | { status: 'inline-text' }
  | { status: 'error'; error: TranslationMessage; retryable: boolean }

type UploadState = { tasks: Record<string, UploadTask> }

export const useUploads = create<UploadState>(() => ({ tasks: {} }))

const setTask = (id: string, task: UploadTask | null) =>
  useUploads.setState((state) => ({
    tasks: task
      ? { ...state.tasks, [id]: task }
      : Object.fromEntries(Object.entries(state.tasks).filter(([key]) => key !== id)),
  }))

const pending = new Map<string, { promise: Promise<string>; controller: AbortController }>()

/** 开始（或复用进行中的）上传，返回服务端 file_id；失败时任务记为 error 并抛出原错误 */
export const uploadAttachment = (
  apiKey: string,
  id: string,
  blob: Blob,
  name: string,
  isImage: boolean
): Promise<string> => {
  const current = pending.get(id)
  if (current) {
    return current.promise
  }
  const controller = new AbortController()
  setTask(id, { status: 'uploading' })
  const promise = enqueueUpload(apiKey, blob, name, isImage, controller.signal)
    .then((serverId) => {
      setTask(id, { status: 'done', serverId })
      return serverId
    })
    .catch((error: unknown) => {
      if (controller.signal.aborted) {
        setTask(id, null)
      } else {
        setTask(id, {
          status: 'error',
          error: describeUploadError(error),
          retryable: isRetryableApiError(error),
        })
        const notice = describeUploadQuota(error)
        if (notice) {
          for (const listener of noticeListeners) {
            listener(notice)
          }
        }
      }
      throw error
    })
    .finally(() => pending.delete(id))
  pending.set(id, { promise, controller })
  return promise
}

export const cancelUpload = (id: string) => {
  pending.get(id)?.controller.abort()
  setTask(id, null)
}

/**
 * 内联图片：标记为 inline 终态，不发起上传。
 * 之后发送时由 isInlineTask 判定，交给当前供应商直接内联发送。
 */
export const markInlineImage = (id: string) => {
  setTask(id, { status: 'inline' })
}

export const isInlineTask = (task: UploadTask | undefined): boolean =>
  task?.status === 'inline'

/** 纯文本附件：本地读取，不发起上传 */
export const markInlineText = (id: string) => {
  setTask(id, { status: 'inline-text' })
}

/** 各扩展名对应的 MIME：部分系统（如 Windows）给不出 file.type，按扩展名补齐 */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** 取文件的 MIME：优先用浏览器给出的类型，缺失时按扩展名推断 */
export const resolveMimeType = (file: File) => file.type || MIME_BY_EXT[getFileExt(file.name)] || ''

export const isImage = (mimeType: string) => mimeType.startsWith('image/')

/** 文件扩展名（大写），用于卡片元信息 */
export const getExtension = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : ''
}

export const formatSize = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
