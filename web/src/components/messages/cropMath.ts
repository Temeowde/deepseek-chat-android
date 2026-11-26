/**
 * 图片裁切的纯几何计算。
 *
 * 坐标模型（与 ImageViewer 一致）：
 *   1. natural：原图像素尺寸；
 *   2. area：裁切舞台（屏幕坐标里的一个矩形，图片在它里面 contain + 居中）；
 *   3. fit = fitInside(natural, area)：scale = 1 时的图片显示尺寸；
 *   4. imageBox = imageBoxOf({ fit, scale, offset, area })：图片当前在屏幕上的矩形；
 *   5. frame：裁切框，屏幕坐标，**不随图片缩放/平移而改变**（双指/拖动只动图片）。
 *
 * 于是「框永远不能超出图片」等价于 frame ⊆ imageBox。
 *
 * 全部都是纯函数：不访问 DOM、不修改入参、不产生副作用，可被 React 组件直接 import。
 * 单位统一为屏幕 px；输出到原图像素时用 frameToNatural。
 */

/** 尺寸（px） */
export type Size = { w: number; h: number }
/** 点/位移（px） */
export type Point = { x: number; y: number }
/** 矩形（px，左上角 + 宽高） */
export type Rect = { x: number; y: number; w: number; h: number }
/** 8 个控制点：4 角 + 4 边 */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** 视口未知时的最小框边长兜底值（已知视口请用 minFramePx） */
export const MIN_FRAME_PX = 32
/** 裁切框最大长宽比（官方 10:1） */
export const MAX_RATIO = 10
/** 自动放大上限（CanHub 的 maxZoom 默认值） */
export const MAX_ZOOM = 4
/** 图片最小缩放：1 = contain 适配后的尺寸 */
export const MIN_SCALE = 1
/** 自动放大后框内画面占视口的比例 */
export const AUTO_ZOOM_FILL = 0.82

/** 退化尺寸（0 宽/高）在除法里的保护值 */
const EPSILON = 1e-6

const finite = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** 把可能为 0 / 负数 / NaN 的边长收敛成非负值 */
const positive = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0

/** 最小框边长：官方 max(1, round(min(vw, vh) / 10)) */
export const minFramePx = (viewport: Size): number =>
  Math.max(1, Math.round(Math.min(positive(viewport.w), positive(viewport.h)) / 10))

/**
 * contain 适配：把 natural 等比缩放到 area 内，返回显示尺寸。
 * 小图也会被放大到 area（和 ImageViewer 的 contain 行为一致）。
 */
export const fitInside = (natural: Size, area: Size): Size => {
  const nw = positive(natural.w)
  const nh = positive(natural.h)
  const aw = positive(area.w)
  const ah = positive(area.h)
  if (nw <= 0 || nh <= 0 || aw <= 0 || ah <= 0) {
    return { w: 0, h: 0 }
  }
  const k = Math.min(aw / nw, ah / nh)
  return { w: nw * k, h: nh * k }
}

/** 在 area 内居中：返回 area 坐标系里的矩形 */
export const centerRect = (size: Size, area: Rect): Rect => ({
  x: area.x + (area.w - size.w) / 2,
  y: area.y + (area.h - size.h) / 2,
  w: size.w,
  h: size.h,
})

/**
 * 图片当前在屏幕上的矩形。
 *   w = fit.w * scale；x = area.x + (area.w - w) / 2 + offset.x（y 同理）
 * 注意：scale > 1 时 imageBox 比 area 大，它不保证落在 area 内 —— 这是正常的，
 * 图片溢出舞台正好是「放大看细节」。
 */
export const imageBoxOf = ({
  fit,
  scale,
  offset,
  area,
}: {
  /** scale = 1 时的 contain 尺寸 */
  fit: Size
  /** 图片缩放倍率 */
  scale: number
  /** 相对居中位置的平移（px） */
  offset: Point
  /** 可用区域（图片在它里面 contain 并居中） */
  area: Rect
}): Rect => {
  const k = finite(scale, MIN_SCALE)
  const w = positive(fit.w) * k
  const h = positive(fit.h) * k
  return {
    x: finite(area.x) + (finite(area.w) - w) / 2 + finite(offset.x),
    y: finite(area.y) + (finite(area.h) - h) / 2 + finite(offset.y),
    w,
    h,
  }
}

/**
 * 把框夹进 imageBox（8 个方向都正确）。
 *
 * 先夹尺寸（框不能比图大；小于 minSize 会撑到 minSize），再整体平移到图内。
 * 尺寸上限是 imageBox 本身，所以即使图比 minSize 还小，返回的框也一定在 imageBox 里
 * —— 优先级：**不超出图片 > 最小尺寸**。
 */
export const clampFrame = (
  frame: Rect,
  imageBox: Rect,
  minSize: number = MIN_FRAME_PX
): Rect => {
  const boxX = finite(imageBox.x)
  const boxY = finite(imageBox.y)
  const boxW = positive(imageBox.w)
  const boxH = positive(imageBox.h)
  if (boxW <= 0 || boxH <= 0) {
    return { x: boxX, y: boxY, w: 0, h: 0 }
  }
  const min = Math.max(1, finite(minSize, MIN_FRAME_PX))
  const w = Math.min(Math.max(finite(frame.w), min), boxW)
  const h = Math.min(Math.max(finite(frame.h), min), boxH)
  return {
    x: clamp(finite(frame.x, boxX), boxX, boxX + boxW - w),
    y: clamp(finite(frame.y, boxY), boxY, boxY + boxH - h),
    w,
    h,
  }
}

/**
 * 按控制点拖拽计算新框。
 *
 * 顺序：移动被拖的边 → 夹进 imageBox → 满足 minSize → 限制 maxRatio → 再整体夹一次。
 * 对面那条边不参与计算（所以不会被拖过对面边）；只有 10:1 比例修正会动它。
 */
export const resizeFrame = ({
  handle,
  frame,
  dx,
  dy,
  imageBox,
  minSize,
  maxRatio = MAX_RATIO,
}: {
  handle: Handle
  frame: Rect
  /** 相对按下点的位移（px） */
  dx: number
  dy: number
  /** 当前图片矩形：框的硬边界 */
  imageBox: Rect
  minSize: number
  /** 最大长宽比，默认 10:1 */
  maxRatio?: number
}): Rect => {
  const boxX = finite(imageBox.x)
  const boxY = finite(imageBox.y)
  const boxW = positive(imageBox.w)
  const boxH = positive(imageBox.h)
  if (boxW <= 0 || boxH <= 0) {
    return { x: boxX, y: boxY, w: 0, h: 0 }
  }
  const min = Math.max(1, finite(minSize, MIN_FRAME_PX))
  const minW = Math.min(min, boxW)
  const minH = Math.min(min, boxH)
  const ratio = Math.max(1, finite(maxRatio, MAX_RATIO))
  const boxRight = boxX + boxW
  const boxBottom = boxY + boxH

  // 起点先合法化：保证「对面边」一定在 imageBox 里
  const base = clampFrame(frame, imageBox, min)
  let left = base.x
  let top = base.y
  let right = base.x + base.w
  let bottom = base.y + base.h

  const movesW = handle === 'w' || handle === 'nw' || handle === 'sw'
  const movesE = handle === 'e' || handle === 'ne' || handle === 'se'
  const movesN = handle === 'n' || handle === 'nw' || handle === 'ne'
  const movesS = handle === 's' || handle === 'sw' || handle === 'se'
  const stepX = finite(dx)
  const stepY = finite(dy)

  if (movesW) {
    left = clamp(base.x + stepX, boxX, right - minW)
  }
  if (movesE) {
    right = clamp(right + stepX, left + minW, boxRight)
  }
  if (movesN) {
    top = clamp(base.y + stepY, boxY, bottom - minH)
  }
  if (movesS) {
    bottom = clamp(bottom + stepY, top + minH, boxBottom)
  }

  // 10:1：超限时收「被拖的那一维」；如果拖的是另一维，就把另一维撑回比例下限
  const w = right - left
  const h = bottom - top
  if (w > h * ratio) {
    if (movesW || movesE) {
      const target = h * ratio
      if (movesW) {
        left = right - target
      } else {
        right = left + target
      }
    } else {
      const target = w / ratio
      if (movesN) {
        top = bottom - target
      } else {
        bottom = top + target
      }
    }
  } else if (h > w * ratio) {
    if (movesN || movesS) {
      const target = w * ratio
      if (movesN) {
        top = bottom - target
      } else {
        bottom = top + target
      }
    } else {
      const target = h / ratio
      if (movesW) {
        left = right - target
      } else {
        right = left + target
      }
    }
  }

  // 比例修正可能把框推出 imageBox，再夹一次兜底
  return clampFrame({ x: left, y: top, w: right - left, h: bottom - top }, imageBox, min)
}

/**
 * 框变小时用的**绝对**缩放值（cover）：让框里的画面铺满视口。
 *   max(vw * fill / frame.w, vh * fill / frame.h)
 * 取 max 保证两个方向都不留黑边。
 * 返回的是以 scale = 1 的 fit 尺寸为基准的倍率，不是相对当前 scale 的系数；
 * 这里不 clamp，调用方自行 clamp 到 [MIN_SCALE, MAX_ZOOM]。
 */
export const scaleToFillFrame = ({
  frame,
  viewport,
  fill = AUTO_ZOOM_FILL,
}: {
  frame: Rect
  /** 要铺满的目标视口（通常是裁切舞台尺寸） */
  viewport: Size
  /** 目标占比，默认 AUTO_ZOOM_FILL */
  fill?: number
}): number => {
  const fw = Math.max(positive(frame.w), EPSILON)
  const fh = Math.max(positive(frame.h), EPSILON)
  const want = finite(fill, AUTO_ZOOM_FILL)
  return Math.max((positive(viewport.w) * want) / fw, (positive(viewport.h) * want) / fh)
}

/**
 * 框变大时用的**绝对**缩放值（fit）：让整张图收进视口。
 *   min(vw * fill / frame.w, vh * fill / frame.h)
 * 取 min 保证两个方向都装得下。
 * 同样返回绝对倍率、不 clamp；框越大返回值越小（单调递减）。
 */
export const scaleToFitFrame = ({
  frame,
  viewport,
  fill = AUTO_ZOOM_FILL,
}: {
  frame: Rect
  viewport: Size
  fill?: number
}): number => {
  const fw = Math.max(positive(frame.w), EPSILON)
  const fh = Math.max(positive(frame.h), EPSILON)
  const want = finite(fill, AUTO_ZOOM_FILL)
  return Math.min((positive(viewport.w) * want) / fw, (positive(viewport.h) * want) / fh)
}

/**
 * 让 imageBox 在**尺寸上**盖住 frame 所需的最小 scale —— 「框不超出图片」的必要条件：
 *   scale ≥ max(frame.w / fit.w, frame.h / fit.h)
 * 它随框变大而变大，和 scaleToFillFrame / scaleToFitFrame（随框变大而变小）是
 * 两条方向相反的边界。
 */
export const scaleToCoverFrame = ({ frame, fit }: { frame: Rect; fit: Size }): number => {
  const fw = positive(fit.w)
  const fh = positive(fit.h)
  if (fw <= 0 || fh <= 0) {
    return MIN_SCALE
  }
  return Math.max(positive(frame.w) / fw, positive(frame.h) / fh)
}

/**
 * 拖框过程中**每一帧**应该用的图片缩放（连续缩放，不是松手才动画）。
 *
 *   cover   = scaleToCoverFrame(frame, fit)                 // 随框变大而变大（硬下限）
 *   desired = growing ? scaleToFitFrame : scaleToFillFrame   // 随框变大而变小
 *   scale   = clamp(max(cover, desired), minScale, maxZoom)
 *
 * 结论：框变小时 scale 连续变大；框变大时 scale 连续变小；
 * 但永远不会低于 cover —— 否则 imageBox 盖不住框，框就超出图片了。
 * 于是「框越大图越小」在框接近整张图时会自然触底：
 * 触底点满足 frame.w / fit.w = vw * fill / frame.w（两个方向取 min/max 的那个），
 * 即 frame ≈ sqrt(fill * min(vw, vh) * fit)（方框、fit 为正方形时），
 * 再往外拖就必须让 scale 回升（cover 接管），或者用 clampFrame 夹住框。
 */
export const liveCropScale = ({
  frame,
  fit,
  viewport,
  growing,
  fill = AUTO_ZOOM_FILL,
  minScale = MIN_SCALE,
  maxZoom = MAX_ZOOM,
}: {
  frame: Rect
  fit: Size
  viewport: Size
  /** true = 这一帧框在变大（图要缩小）；false = 在变小（放大看细节） */
  growing: boolean
  fill?: number
  minScale?: number
  maxZoom?: number
}): number => {
  const cover = scaleToCoverFrame({ frame, fit })
  const desired = growing
    ? scaleToFitFrame({ frame, viewport, fill })
    : scaleToFillFrame({ frame, viewport, fill })
  const lo = finite(minScale, MIN_SCALE)
  const hi = Math.max(lo, finite(maxZoom, MAX_ZOOM))
  return clamp(Math.max(cover, desired), lo, hi)
}

/**
 * 屏幕框 → 原图像素矩形（给 canvas 裁图用）。
 * 结果夹在 0..natural 内（框被拖到图外时只取相交部分），且 x + w ≤ natural.w 恒成立。
 * 返回浮点值，需要整数时调用方再 Math.round。
 */
export const frameToNatural = ({
  frame,
  imageBox,
  natural,
}: {
  frame: Rect
  /** 当前图片矩形（含 scale/offset/居中） */
  imageBox: Rect
  /** 原图像素尺寸 */
  natural: Size
}): Rect => {
  const nw = positive(natural.w)
  const nh = positive(natural.h)
  const bw = positive(imageBox.w)
  const bh = positive(imageBox.h)
  if (nw <= 0 || nh <= 0 || bw <= 0 || bh <= 0) {
    return { x: 0, y: 0, w: 0, h: 0 }
  }
  const boxX = finite(imageBox.x)
  const boxY = finite(imageBox.y)
  const kx = nw / bw
  const ky = nh / bh
  const fx = finite(frame.x)
  const fy = finite(frame.y)
  const fw = Math.max(0, finite(frame.w))
  const fh = Math.max(0, finite(frame.h))
  const left = clamp((fx - boxX) * kx, 0, nw)
  const top = clamp((fy - boxY) * ky, 0, nh)
  const right = clamp((fx + fw - boxX) * kx, 0, nw)
  const bottom = clamp((fy + fh - boxY) * ky, 0, nh)
  return {
    x: left,
    y: top,
    w: Math.max(0, right - left),
    h: Math.max(0, bottom - top),
  }
}

/** 原图像素矩形 → 屏幕矩形（frameToNatural 的逆运算，用于往返校验/预览） */
export const naturalToFrame = ({
  rect,
  imageBox,
  natural,
}: {
  rect: Rect
  imageBox: Rect
  natural: Size
}): Rect => {
  const nw = positive(natural.w)
  const nh = positive(natural.h)
  const bw = positive(imageBox.w)
  const bh = positive(imageBox.h)
  const boxX = finite(imageBox.x)
  const boxY = finite(imageBox.y)
  if (nw <= 0 || nh <= 0 || bw <= 0 || bh <= 0) {
    return { x: boxX, y: boxY, w: 0, h: 0 }
  }
  const sx = bw / nw
  const sy = bh / nh
  return {
    x: boxX + finite(rect.x) * sx,
    y: boxY + finite(rect.y) * sy,
    w: Math.max(0, finite(rect.w)) * sx,
    h: Math.max(0, finite(rect.h)) * sy,
  }
}
