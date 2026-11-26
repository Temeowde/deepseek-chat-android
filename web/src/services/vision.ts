/**
 * 图片直连：非 DeepSeek 通道（WorkBuddy / 自定义 OpenAI 兼容）可以直接把图片
 * 以 base64 data URL 放进请求体，不必先上传到 DeepSeek Files API。
 *
 * 只有图片能这样走；PDF/Word 等文档 WorkBuddy 不接受，仍需要 DeepSeek 解析。
 */

/** Blob → base64（去掉 data URL 前缀） */
export const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('无法读取图片'))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('无法读取图片'))
    reader.readAsDataURL(blob)
  })

/** 服务端硬限制：图片宽高都不得超过 4096px（超了返回 400 image too large） */
export const MAX_IMAGE_EDGE = 3840
/** 内联图片上限更保守：长边压到 2048，base64 后体积约 1/4，避免整个请求体过大 */
export const INLINE_IMAGE_EDGE = 2048

/**
 * 按长边等比缩放图片：只缩小、不放大。
 *
 * 为什么需要：
 *  - 服务端限制宽高各不超过 4096px，导入的历史大图（手机原图 4000~8000px）直接内联会 400；
 *  - 内联 base64 会把体积放大 4/3，很多张大图会让整个请求体超出限制。
 *
 * 解码失败（格式不受支持等）时原样返回，让上层按原逻辑报错。
 */
export const downscaleImage = async (
  blob: Blob,
  maxEdge = INLINE_IMAGE_EDGE,
  quality = 0.86
): Promise<Blob> => {
  if (!blob.type.startsWith('image/')) {
    return blob
  }
  // GIF 是动图，缩放会丢掉动画帧，直接放行
  if (blob.type === 'image/gif') {
    return blob
  }
  try {
    const bitmap = await createImageBitmap(blob)
    const longest = Math.max(bitmap.width, bitmap.height)
    if (longest <= maxEdge) {
      bitmap.close()
      return blob
    }
    const scale = maxEdge / longest
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      return blob
    }
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const targetType = blob.type === 'image/png' ? 'image/png' : 'image/jpeg'
    const scaled = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, targetType, quality)
    )
    return scaled && scaled.size > 0 ? scaled : blob
  } catch {
    return blob
  }
}

/**
 * 上传前把图片压到服务端可接受的尺寸。
 * Files API 最终也是把图片交给同一个视觉模型，超过 4096px 一样会 400。
 */
export const prepareImageForUpload = (blob: Blob, name: string): Promise<{ blob: Blob; name: string }> =>
  downscaleImage(blob, MAX_IMAGE_EDGE).then((scaled) => ({
    blob: scaled,
    name: scaled.size === blob.size && scaled.type === blob.type ? name : renameToMatchType(name, scaled.type),
  }))

/** 缩放后 MIME 可能从 png 变 jpeg，扩展名要跟着改，否则服务端按扩展名判类型会失败 */
const renameToMatchType = (name: string, type: string): string => {
  const ext = type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : ''
  if (!ext) {
    return name
  }
  const dot = name.lastIndexOf('.')
  const base = name.slice(0, dot > 0 ? dot : name.length)
  return `${base}.${ext}`
}

/** 判断图片是否已经在服务端限制内（不缩放，只量尺寸）；解码失败按「合规」放行，避免误重传 */
export const isImageWithinLimit = async (blob: Blob, maxEdge = MAX_IMAGE_EDGE): Promise<boolean> => {
  if (!blob.type.startsWith('image/')) {
    return true
  }
  try {
    const bitmap = await createImageBitmap(blob)
    const ok = Math.max(bitmap.width, bitmap.height) <= maxEdge
    bitmap.close()
    return ok
  } catch {
    return true
  }
}
