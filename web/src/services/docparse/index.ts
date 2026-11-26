/**
 * 本地解析二进制文档（PDF / DOCX / PPTX），把内容转成纯文本。
 *
 * 这样 WorkBuddy / 自定义通道也能发文档，而且不必为 DeepSeek 的文件解析付费。
 * 解析失败或超限时返回 null，由调用方回落到原来的 Files API 上传。
 */

/** 单文件解析体积上限：超过就走 DeepSeek，避免手机内存被撑爆 */
const MAX_PARSE_BYTES: Record<string, number> = {
  pdf: 30 * 1024 * 1024,
  docx: 20 * 1024 * 1024,
  pptx: 40 * 1024 * 1024,
}

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** 本地能解析的扩展名 */
export const LOCAL_PARSE_EXTS = new Set(Object.keys(MAX_PARSE_BYTES))

export const canParseLocally = (name: string): boolean =>
  LOCAL_PARSE_EXTS.has(extOf(name))

export type ParsedDocument = {
  text: string
  /** 解析出的字符数（截断前） */
  totalChars: number
  /** 是否因为超长被截断 */
  truncated: boolean
}

const KIND: Record<string, string> = { pdf: 'PDF', docx: 'Word', pptx: 'PPT' }

/**
 * 按格式惰性加载解析器：pdf.js 与 mammoth 加起来约 1.5 MB，
 * 只有真的发了对应格式的文档才下载对应的那段代码，不拖慢启动。
 */
const parse = async (bytes: Uint8Array, ext: string): Promise<string> => {
  switch (ext) {
    case 'pdf': {
      const { parsePdf } = await import('./pdf.js')
      return parsePdf(bytes)
    }
    case 'docx': {
      const { parseDocx } = await import('./docx.js')
      return parseDocx(bytes)
    }
    case 'pptx': {
      const { parsePptx } = await import('./pptx.js')
      return parsePptx(bytes)
    }
    default:
      return ''
  }
}

/**
 * 尝试本地解析；不支持、超限或失败都返回 null（调用方回落 DeepSeek）。
 * 超过 maxChars 时截断，但保留原始字符数用于提示。
 */
export const parseDocument = async (
  blob: Blob,
  name: string,
  maxChars: number
): Promise<ParsedDocument | null> => {
  const ext = extOf(name)
  const limit = MAX_PARSE_BYTES[ext]
  if (!limit || blob.size > limit) {
    return null
  }
  try {
    const bytes = new Uint8Array(await new Response(blob).arrayBuffer())
    const raw = await parse(bytes, ext)
    const text = raw.replace(/\r\n/g, '\n').trim()
    if (!text) {
      return null
    }
    if (text.length <= maxChars) {
      return { text, totalChars: text.length, truncated: false }
    }
    return { text: text.slice(0, maxChars), totalChars: text.length, truncated: true }
  } catch {
    return null
  }
}

/** 消息里标注来源的中文名，例如「PDF」 */
export const localParseKind = (name: string): string => KIND[extOf(name)] ?? '文档'
