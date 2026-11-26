/**
 * cropMath 纯函数单测（无需测试框架）。
 *
 * 运行：node cropMath.test.mjs
 * 只依赖 node:assert，不联网、不碰 DOM、不需要构建。
 *
 * 覆盖：
 *   - 200 组 fuzz + 8 个方向：框永远不超出 imageBox
 *   - 横图 1400×700 / 竖图 700×1400 / 方图 800×800：初始框 == 图片框（< 0.5px）
 *   - 8 个控制点都能拖动：外拖改边、内拖停在最小尺寸且不越过对面边
 *   - 10:1 比例限制
 *   - 框缩小 → scaleToFillFrame 单调变大；框放大 → scaleToFitFrame 单调变小
 *   - frameToNatural 往返（scale=2、offset 非零）：落在 0..natural 且比例正确
 */
import assert from 'node:assert/strict'
import {
  AUTO_ZOOM_FILL,
  MAX_RATIO,
  MAX_ZOOM,
  MIN_FRAME_PX,
  MIN_SCALE,
  centerRect,
  clampFrame,
  fitInside,
  frameToNatural,
  imageBoxOf,
  liveCropScale,
  minFramePx,
  naturalToFrame,
  resizeFrame,
  scaleToCoverFrame,
  scaleToFillFrame,
  scaleToFitFrame,
} from './cropMath.ts'

const EPS = 1e-6
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
// 和 ImageViewer 一致：整屏 400×800，左右 EDGE=18，顶栏 96、底栏 128
const AREA = { x: 18, y: 96, w: 364, h: 576 }
const VIEWPORT = { w: 400, h: 800 }
const SIZES = [
  ['横图 1400×700', { w: 1400, h: 700 }],
  ['竖图 700×1400', { w: 700, h: 1400 }],
  ['方图 800×800', { w: 800, h: 800 }],
]

const results = []
const test = (name, fn) => {
  try {
    fn()
    results.push({ name, ok: true })
    console.log('PASS  ' + name)
  } catch (error) {
    results.push({ name, ok: false, error })
    console.log('FAIL  ' + name)
    console.log('      ' + String(error.message).split('\n').join('\n      '))
  }
}

const near = (actual, expected, tol = EPS, label = '') => {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    label + ' 期望 ' + expected + '，实际 ' + actual + '（容差 ' + tol + '）'
  )
}

/** 断言 rect 完整落在 box 内（容差 EPS） */
const inside = (rect, box, label) => {
  assert.ok(rect.w >= -EPS && rect.h >= -EPS, label + ': 宽高不能为负（' + rect.w + '×' + rect.h + '）')
  assert.ok(rect.x >= box.x - EPS, label + ': 左边越界 x=' + rect.x + ' < ' + box.x)
  assert.ok(rect.y >= box.y - EPS, label + ': 上边越界 y=' + rect.y + ' < ' + box.y)
  assert.ok(
    rect.x + rect.w <= box.x + box.w + EPS,
    label + ': 右边越界 ' + (rect.x + rect.w) + ' > ' + (box.x + box.w)
  )
  assert.ok(
    rect.y + rect.h <= box.y + box.h + EPS,
    label + ': 下边越界 ' + (rect.y + rect.h) + ' > ' + (box.y + box.h)
  )
}

/** 可复现的伪随机数（mulberry32） */
const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/* ------------------------------------------------------------------ */

test('常量与 minFramePx 公式', () => {
  assert.equal(MAX_RATIO, 10)
  assert.equal(MAX_ZOOM, 4)
  assert.equal(MIN_SCALE, 1)
  assert.ok(MIN_FRAME_PX >= 1, 'MIN_FRAME_PX 至少为 1')
  assert.ok(AUTO_ZOOM_FILL > 0 && AUTO_ZOOM_FILL < 1, 'AUTO_ZOOM_FILL 应在 (0,1)')
  assert.equal(minFramePx({ w: 400, h: 800 }), 40)
  assert.equal(minFramePx({ w: 800, h: 400 }), 40)
  assert.equal(minFramePx({ w: 360, h: 900 }), 36)
  assert.equal(minFramePx({ w: 9, h: 9 }), 1)
  assert.equal(minFramePx({ w: 0, h: 0 }), 1)
})

test('fitInside：三种比例都等比且不超出 area', () => {
  for (const [label, natural] of SIZES) {
    const fit = fitInside(natural, AREA)
    assert.ok(fit.w <= AREA.w + EPS && fit.h <= AREA.h + EPS, label + ': 超出 area ' + fit.w + '×' + fit.h)
    near(fit.w / fit.h, natural.w / natural.h, 1e-9, label + ': 宽高比')
    const tight = Math.abs(fit.w - AREA.w) < 1e-9 || Math.abs(fit.h - AREA.h) < 1e-9
    assert.ok(tight, label + ': contain 至少一边贴住 area（' + fit.w + '×' + fit.h + '）')
  }
  assert.deepEqual(fitInside({ w: 0, h: 0 }, AREA), { w: 0, h: 0 })
})

test('初始框 == 图片框（三种比例 + 100 组随机尺寸，误差 < 0.5px）', () => {
  const check = (label, natural) => {
    const fit = fitInside(natural, AREA)
    const initial = centerRect(fit, AREA)
    const box = imageBoxOf({ fit, scale: 1, offset: { x: 0, y: 0 }, area: AREA })
    for (const key of ['x', 'y', 'w', 'h']) {
      assert.ok(
        Math.abs(initial[key] - box[key]) < 0.5,
        label + ': ' + key + ' 初始框 ' + initial[key] + ' != 图片框 ' + box[key]
      )
    }
  }
  for (const [label, natural] of SIZES) {
    check(label, natural)
  }
  const rand = rng(7)
  for (let i = 0; i < 100; i += 1) {
    check('随机 #' + i, { w: 1 + rand() * 4000, h: 1 + rand() * 4000 })
  }
})

test('clampFrame fuzz：200 组随机框全部夹进 imageBox', () => {
  const rand = rng(20261125)
  for (let i = 0; i < 200; i += 1) {
    const box = {
      x: rand() * 800 - 400,
      y: rand() * 800 - 400,
      w: 40 + rand() * 1200,
      h: 40 + rand() * 1200,
    }
    const frame = {
      x: rand() * 2400 - 1200,
      y: rand() * 2400 - 1200,
      w: rand() * 2000 - 200,
      h: rand() * 2000 - 200,
    }
    const minSize = 1 + Math.floor(rand() * 90)
    const out = clampFrame(frame, box, minSize)
    inside(out, box, 'clampFrame fuzz #' + i)
    const min = Math.max(1, minSize)
    assert.ok(out.w >= Math.min(min, box.w) - EPS, '#' + i + ': 宽小于最小尺寸 ' + out.w)
    assert.ok(out.h >= Math.min(min, box.h) - EPS, '#' + i + ': 高小于最小尺寸 ' + out.h)
  }
  // scale=2、offset 非零的真实 imageBox 也要夹得住
  const fit = fitInside({ w: 1400, h: 700 }, AREA)
  const realBox = imageBoxOf({ fit, scale: 2, offset: { x: 33, y: -21 }, area: AREA })
  const huge = clampFrame({ x: -9999, y: -9999, w: 9999, h: 9999 }, realBox, 40)
  inside(huge, realBox, 'scale=2 offset 非零')
  near(huge.x, realBox.x, EPS, '整图框应贴住图片左边')
  near(huge.w, realBox.w, EPS, '整图框应等于图片宽度')
})

test('resizeFrame fuzz：200 组 × 8 方向，始终在 imageBox 内且满足最小尺寸/10:1', () => {
  const rand = rng(424242)
  let checks = 0
  for (let i = 0; i < 200; i += 1) {
    const box = {
      x: rand() * 200 - 100,
      y: rand() * 200 - 100,
      w: 400 + rand() * 800,
      h: 400 + rand() * 800,
    }
    const minSize = 10 + Math.floor(rand() * 60)
    const w0 = minSize + rand() * (box.w - minSize)
    const h0 = minSize + rand() * (box.h - minSize)
    const frame = {
      x: box.x + rand() * (box.w - w0),
      y: box.y + rand() * (box.h - h0),
      w: w0,
      h: h0,
    }
    for (const handle of HANDLES) {
      const out = resizeFrame({
        handle,
        frame,
        dx: rand() * 3000 - 1500,
        dy: rand() * 3000 - 1500,
        imageBox: box,
        minSize,
      })
      const label = 'resizeFrame fuzz #' + i + ' handle=' + handle
      inside(out, box, label)
      assert.ok(out.w >= Math.min(minSize, box.w) - EPS, label + ': 宽 ' + out.w + ' < minSize')
      assert.ok(out.h >= Math.min(minSize, box.h) - EPS, label + ': 高 ' + out.h + ' < minSize')
      assert.ok(out.w <= out.h * MAX_RATIO + EPS, label + ': 宽高比超过 10（' + out.w + '×' + out.h + '）')
      assert.ok(out.h <= out.w * MAX_RATIO + EPS, label + ': 高宽比超过 10（' + out.w + '×' + out.h + '）')
      checks += 1
    }
  }
  assert.equal(checks, 200 * 8, '应该是 200 组 × 8 方向 = 1600 次')
})

test('8 个控制点：外拖都能改变框，内拖停在最小尺寸且不越过对面边', () => {
  const box = { x: 0, y: 0, w: 2000, h: 2000 }
  const minSize = 40
  const base = { x: 400, y: 400, w: 300, h: 300 }
  const outward = {
    nw: { dx: -120, dy: -120 },
    n: { dx: 0, dy: -120 },
    ne: { dx: 120, dy: -120 },
    e: { dx: 120, dy: 0 },
    se: { dx: 120, dy: 120 },
    s: { dx: 0, dy: 120 },
    sw: { dx: -120, dy: 120 },
    w: { dx: -120, dy: 0 },
  }
  for (const handle of HANDLES) {
    const delta = outward[handle]
    const out = resizeFrame({ handle, frame: base, dx: delta.dx, dy: delta.dy, imageBox: box, minSize })
    // 对面的边不动
    if (handle.includes('w')) near(out.x + out.w, 700, EPS, handle + ': 右边不应动')
    else if (handle.includes('e')) near(out.x, 400, EPS, handle + ': 左边不应动')
    if (handle.includes('n')) near(out.y + out.h, 700, EPS, handle + ': 下边不应动')
    else if (handle.includes('s')) near(out.y, 400, EPS, handle + ': 上边不应动')
    // 被拖的边外移 120
    if (handle.includes('w')) near(out.x, 280, EPS, handle + ': 左边应外移')
    if (handle.includes('e')) near(out.x + out.w, 820, EPS, handle + ': 右边应外移')
    if (handle.includes('n')) near(out.y, 280, EPS, handle + ': 上边应外移')
    if (handle.includes('s')) near(out.y + out.h, 820, EPS, handle + ': 下边应外移')
    assert.ok(out.w !== base.w || out.h !== base.h, handle + ': 拖拽没有改变框')
  }
  // 反向猛拖：停在最小尺寸，且不越过对面边
  const inward = {
    nw: { dx: 10000, dy: 10000 },
    n: { dx: 0, dy: 10000 },
    ne: { dx: -10000, dy: 10000 },
    e: { dx: -10000, dy: 0 },
    se: { dx: -10000, dy: -10000 },
    s: { dx: 0, dy: -10000 },
    sw: { dx: 10000, dy: -10000 },
    w: { dx: 10000, dy: 0 },
  }
  for (const handle of HANDLES) {
    const delta = inward[handle]
    const out = resizeFrame({ handle, frame: base, dx: delta.dx, dy: delta.dy, imageBox: box, minSize })
    if (handle.includes('w')) {
      near(out.w, minSize, EPS, handle + ': 最小宽度')
      near(out.x + out.w, 700, EPS, handle + ': 右边不应动')
    }
    if (handle.includes('e')) {
      near(out.w, minSize, EPS, handle + ': 最小宽度')
      near(out.x, 400, EPS, handle + ': 左边不应动')
    }
    if (handle.includes('n')) {
      near(out.h, minSize, EPS, handle + ': 最小高度')
      near(out.y + out.h, 700, EPS, handle + ': 下边不应动')
    }
    if (handle.includes('s')) {
      near(out.h, minSize, EPS, handle + ': 最小高度')
      near(out.y, 400, EPS, handle + ': 上边不应动')
    }
    inside(out, box, handle + ' 内拖')
  }
})

test('10:1 比例限制', () => {
  const box = { x: 0, y: 0, w: 2000, h: 2000 }
  const frame = { x: 100, y: 100, w: 100, h: 100 }
  // 横向拉爆：宽被压到 高×10
  const wide = resizeFrame({ handle: 'e', frame, dx: 4000, dy: 0, imageBox: box, minSize: 40 })
  near(wide.w, 1000, EPS, '横向限制后的宽')
  near(wide.h, 100, EPS, '横向限制后的高')
  near(wide.w / wide.h, MAX_RATIO, EPS, '横向宽高比')
  near(wide.x, 100, EPS, '横向：左边不应动')
  // 纵向拉爆：高被压到 宽×10
  const tall = resizeFrame({ handle: 's', frame, dx: 0, dy: 4000, imageBox: box, minSize: 40 })
  near(tall.h, 1000, EPS, '纵向限制后的高')
  near(tall.w, 100, EPS, '纵向限制后的宽')
  near(tall.h / tall.w, MAX_RATIO, EPS, '纵向高宽比')
  near(tall.y, 100, EPS, '纵向：上边不应动')
  // 角落拖动同时受限
  const corner = resizeFrame({ handle: 'se', frame, dx: 4000, dy: 50, imageBox: box, minSize: 40 })
  near(corner.w / corner.h, MAX_RATIO, EPS, '角落拖动宽高比')
  near(corner.x, 100, EPS, '角落：左边不应动')
  near(corner.y, 100, EPS, '角落：上边不应动')
  inside(corner, box, '角比例限制')
  // 拖另一维把比例压坏时，被拖的那一维会撑回比例下限
  const tallFrame = { x: 100, y: 100, w: 100, h: 1000 }
  const squeezed = resizeFrame({ handle: 'w', frame: tallFrame, dx: 4000, dy: 0, imageBox: box, minSize: 40 })
  near(squeezed.w, 100, EPS, '高框收窄：宽被撑回 高/10')
  near(squeezed.h, 1000, EPS, '高框收窄：高不变')
  near(squeezed.x + squeezed.w, 200, EPS, '高框收窄：右边不动')
})

test('clampFrame：尺寸下限、图边界优先、8 个方向位移', () => {
  const box = { x: 100, y: 200, w: 400, h: 300 }
  assert.deepEqual(clampFrame({ x: -500, y: -500, w: 120, h: 80 }, box, 40), {
    x: 100,
    y: 200,
    w: 120,
    h: 80,
  })
  assert.deepEqual(clampFrame({ x: 2000, y: 2000, w: 120, h: 80 }, box, 40), {
    x: 380,
    y: 420,
    w: 120,
    h: 80,
  })
  assert.deepEqual(clampFrame({ x: 0, y: 0, w: 5000, h: 5000 }, box, 40), {
    x: 100,
    y: 200,
    w: 400,
    h: 300,
  })
  const small = clampFrame({ x: 120, y: 210, w: 5, h: 5 }, box, 40)
  near(small.w, 40, EPS, '最小宽度')
  near(small.h, 40, EPS, '最小高度')
  inside(small, box, '最小尺寸')
  // 图比 minSize 还小：图优先（宁可小于 minSize 也不能超出图片）
  const tinyBox = { x: 0, y: 0, w: 20, h: 15 }
  assert.deepEqual(clampFrame({ x: -10, y: -10, w: 100, h: 100 }, tinyBox, 40), {
    x: 0,
    y: 0,
    w: 20,
    h: 15,
  })
  // 空图不能崩
  assert.deepEqual(clampFrame({ x: 1, y: 2, w: 30, h: 30 }, { x: 5, y: 6, w: 0, h: 0 }, 40), {
    x: 5,
    y: 6,
    w: 0,
    h: 0,
  })
})

test('scaleToFillFrame 随框变小严格变大 / scaleToFitFrame 随框变大严格变小', () => {
  const viewport = VIEWPORT
  let prev = -Infinity
  for (let size = 400; size >= 40; size -= 20) {
    const value = scaleToFillFrame({ frame: { x: 0, y: 0, w: size, h: size }, viewport })
    assert.ok(value > prev, '框 ' + size + 'px：fill 缩放应随框变小而变大（' + value + ' <= ' + prev + '）')
    prev = value
  }
  prev = Infinity
  for (let size = 40; size <= 400; size += 20) {
    const value = scaleToFitFrame({ frame: { x: 0, y: 0, w: size, h: size }, viewport })
    assert.ok(value < prev, '框 ' + size + 'px：fit 缩放应随框变大而变小（' + value + ' >= ' + prev + '）')
    prev = value
  }
  // cover 取 max、fit 取 min
  const frame = { x: 0, y: 0, w: 100, h: 300 }
  near(
    scaleToFillFrame({ frame, viewport }),
    Math.max((400 * AUTO_ZOOM_FILL) / 100, (800 * AUTO_ZOOM_FILL) / 300),
    EPS,
    'cover 取 max'
  )
  near(
    scaleToFitFrame({ frame, viewport }),
    Math.min((400 * AUTO_ZOOM_FILL) / 100, (800 * AUTO_ZOOM_FILL) / 300),
    EPS,
    'fit 取 min'
  )
  assert.ok(
    scaleToFillFrame({ frame, viewport }) >= scaleToFitFrame({ frame, viewport }),
    '同一框 fill 缩放必须 ≥ fit 缩放'
  )
  near(
    scaleToFillFrame({ frame: { x: 0, y: 0, w: 100, h: 100 }, viewport: { w: 200, h: 200 }, fill: 1 }),
    2,
    EPS,
    'fill=1 时正好铺满'
  )
})

test('liveCropScale：框变大先连续缩小，触到 cover 下限后回升', () => {
  const fit = fitInside({ w: 800, h: 800 }, AREA) // 364 × 364
  const sequence = []
  for (let size = 100; size <= 520; size += 20) {
    const frame = { x: 0, y: 0, w: size, h: size }
    sequence.push({
      size,
      scale: liveCropScale({ frame, fit, viewport: VIEWPORT, growing: true, minScale: 0.2 }),
      cover: scaleToCoverFrame({ frame, fit }),
    })
  }
  // 找最低点：之前每一步都在变小
  let index = 0
  while (index + 1 < sequence.length && sequence[index + 1].scale <= sequence[index].scale + 1e-9) {
    index += 1
  }
  assert.ok(index > 0, '框变大时应该先连续缩小')
  const rest = sequence.slice(index + 1)
  assert.ok(rest.length > 0, '触底后还应有回升段')
  for (const item of rest) {
    assert.ok(
      item.scale > sequence[index].scale + 1e-9,
      '越过 cover 下限后必须回升（框 ' + item.size + ' → ' + item.scale + '）'
    )
  }
  const last = sequence[sequence.length - 1]
  near(last.scale, last.cover, EPS, '大框时 scale 应正好等于 cover 下限')
  for (const item of sequence) {
    assert.ok(
      item.scale >= item.cover - EPS,
      '框 ' + item.size + ': scale ' + item.scale + ' 低于 cover ' + item.cover + '（框会超出图片）'
    )
  }
  // 框变小 → 放大（fill 分支）
  const small = liveCropScale({
    frame: { x: 0, y: 0, w: 100, h: 100 },
    fit,
    viewport: VIEWPORT,
    growing: false,
    minScale: 0.2,
  })
  const medium = liveCropScale({
    frame: { x: 0, y: 0, w: 200, h: 200 },
    fit,
    viewport: VIEWPORT,
    growing: false,
    minScale: 0.2,
  })
  assert.ok(small > medium, '框越小 fill 缩放越大（' + small + ' vs ' + medium + '）')
})

test('frameToNatural：映射原图、夹在 0..natural、往返一致（scale=2、offset 非零）', () => {
  const natural = { w: 1400, h: 700 }
  const fit = fitInside(natural, AREA) // 364 × 182
  const imageBox = imageBoxOf({ fit, scale: 2, offset: { x: 13, y: -7 }, area: AREA })
  near(imageBox.w, 728, EPS, 'imageBox 宽')
  near(imageBox.h, 364, EPS, 'imageBox 高')
  near(imageBox.x, -151, EPS, 'imageBox x')
  near(imageBox.y, 195, EPS, 'imageBox y')

  const limit = { x: 0, y: 0, w: natural.w, h: natural.h }
  const frame = { x: imageBox.x + 40, y: imageBox.y + 30, w: 200, h: 100 }
  const rect = frameToNatural({ frame, imageBox, natural })
  inside(rect, limit, 'frameToNatural')
  near(rect.x / natural.w, 40 / imageBox.w, EPS, 'x 比例')
  near(rect.w / natural.w, frame.w / imageBox.w, EPS, 'w 比例')
  near(rect.h / natural.h, frame.h / imageBox.h, EPS, 'h 比例')
  // 往返
  const back = naturalToFrame({ rect, imageBox, natural })
  near(back.x, frame.x, 1e-6, '往返 x')
  near(back.y, frame.y, 1e-6, '往返 y')
  near(back.w, frame.w, 1e-6, '往返 w')
  near(back.h, frame.h, 1e-6, '往返 h')
  // 框 == 图片框 → 整张原图
  const whole = frameToNatural({ frame: imageBox, imageBox, natural })
  near(whole.x, 0, EPS, '整图 x')
  near(whole.y, 0, EPS, '整图 y')
  near(whole.w, natural.w, EPS, '整图宽')
  near(whole.h, natural.h, EPS, '整图高')
  // 框被拖到图外 → 只取相交部分，且仍在 0..natural
  const outside = frameToNatural({
    frame: { x: imageBox.x - 100, y: imageBox.y - 50, w: 200, h: 100 },
    imageBox,
    natural,
  })
  near(outside.x, 0, EPS, '越界后 x 夹到 0')
  near(outside.y, 0, EPS, '越界后 y 夹到 0')
  near(outside.w, (100 / imageBox.w) * natural.w, EPS, '越界后只保留相交宽')
  near(outside.h, (50 / imageBox.h) * natural.h, EPS, '越界后只保留相交高')
  inside(outside, limit, 'frameToNatural 越界')
  // 窄图/窄框也不越界
  const thin = imageBoxOf({ fit: fitInside({ w: 2, h: 4000 }, AREA), scale: 2, offset: { x: -9, y: 77 }, area: AREA })
  const thinNatural = { w: 2, h: 4000 }
  const thinRect = frameToNatural({
    frame: { x: thin.x - 5, y: thin.y - 5, w: thin.w + 10, h: thin.h + 10 },
    imageBox: thin,
    natural: thinNatural,
  })
  inside(thinRect, { x: 0, y: 0, w: thinNatural.w, h: thinNatural.h }, '极端窄图')
})

test('纯函数：所有 API 都不修改入参（无副作用）', () => {
  const box = { x: 100, y: 200, w: 400, h: 300 }
  const frame = { x: 150, y: 250, w: 100, h: 80 }
  const fit = { w: 300, h: 200 }
  const natural = { w: 1400, h: 700 }
  const offset = { x: 5, y: -3 }
  const area = { x: 18, y: 96, w: 364, h: 576 }
  const snapshot = JSON.stringify({ box, frame, fit, natural, offset, area })
  imageBoxOf({ fit, scale: 2, offset, area })
  clampFrame(frame, box, 40)
  resizeFrame({ handle: 'se', frame, dx: 20, dy: 30, imageBox: box, minSize: 40 })
  scaleToFillFrame({ frame, viewport: VIEWPORT })
  scaleToFitFrame({ frame, viewport: VIEWPORT })
  scaleToCoverFrame({ frame, fit })
  liveCropScale({ frame, fit, viewport: VIEWPORT, growing: true })
  fitInside(natural, AREA)
  centerRect(fit, area)
  minFramePx(VIEWPORT)
  const imageBox = imageBoxOf({ fit, scale: 2, offset: { x: 0, y: 0 }, area })
  frameToNatural({ frame, imageBox, natural })
  naturalToFrame({ rect: frame, imageBox, natural })
  assert.equal(JSON.stringify({ box, frame, fit, natural, offset, area }), snapshot, '入参被修改了')
})

/* ------------------------------------------------------------------ */

const failed = results.filter((item) => !item.ok)
console.log('')
console.log(
  '结果：' + (results.length - failed.length) + ' PASS / ' + failed.length + ' FAIL（共 ' + results.length + ' 组）'
)
if (failed.length > 0) {
  console.log('失败明细：')
  for (const item of failed) {
    console.log('- ' + item.name + '：' + String(item.error && item.error.message))
  }
  process.exitCode = 1
} else {
  console.log('全部通过 ✅')
}
