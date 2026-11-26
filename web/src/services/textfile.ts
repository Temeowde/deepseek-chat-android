/**
 * 本地读取纯文本附件：txt / md / csv / json / 代码文件等直接读成字符串，
 * 当普通文本发给当前聊天通道，不必上传到 DeepSeek Files API。
 *
 * PDF / Word / Excel / PPT 是二进制格式，本地不做解析，仍要走 DeepSeek。
 */

/** 需要服务端解析的二进制文档格式 */
const BINARY_DOCUMENT_EXTS = new Set([
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
])

/** 图片（已有单独的内联图片通道） */
const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'svg',
  'svgz',
  'bmp',
  'gif',
  'webp',
  'ico',
  'xbm',
  'dib',
  'pjp',
  'tif',
  'pjpeg',
  'avif',
  'apng',
  'tiff',
  'jfif',
])

/** 内联文本上限：超过就截断，避免一条消息把上下文撑爆 */
export const MAX_INLINE_TEXT_CHARS = 200_000
/** 读取上限：超过这个字节数不读，直接报错 */
export const MAX_INLINE_TEXT_BYTES = 8 * 1024 * 1024

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** 是否是需要本地解析的二进制文档 */
export const isBinaryDocument = (name: string): boolean =>
  BINARY_DOCUMENT_EXTS.has(extOf(name))

/** 是否是图片 */
export const isImageFile = (name: string, mimeType = ''): boolean =>
  mimeType.startsWith('image/') || IMAGE_EXTS.has(extOf(name))

/**
 * 是否是纯文本类附件。
 * 上传白名单以源码/文本为主，除图片与 Office/PDF 之外一律按文本处理。
 */
export const isTextFile = (name: string, mimeType = ''): boolean => {
  if (isImageFile(name, mimeType)) {
    return false
  }
  if (isBinaryDocument(name)) {
    return false
  }
  if (mimeType.startsWith('text/')) {
    return true
  }
  return true
}

export type InlineText = {
  text: string
  /** 原始字符数（截断前） */
  totalChars: number
  truncated: boolean
}

/** 把 Blob 读成 UTF-8 文本，超长截断 */
export const readBlobText = async (blob: Blob): Promise<InlineText> => {
  const text = await blob.text()
  if (text.length <= MAX_INLINE_TEXT_CHARS) {
    return { text, totalChars: text.length, truncated: false }
  }
  return {
    text: text.slice(0, MAX_INLINE_TEXT_CHARS),
    totalChars: text.length,
    truncated: true,
  }
}
