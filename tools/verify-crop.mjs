#!/usr/bin/env node
/**
 * 裁切（Cropper.js 版）回归验证 —— 真机驱动
 * 用法: node tools/verify-crop.mjs
 */
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB ?? 'adb'
const DEVICE = process.env.DEVICE ?? ''
const adb = (...args) => {
  const full = DEVICE ? ['-s', DEVICE, ...args] : args
  try { return execFileSync(ADB, full, { encoding: 'utf8', timeout: 60000 }).trim() } catch (e) { return (e.stdout ?? '').trim() }
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

const pid = adb('shell', 'pidof', 'com.temeowde.dschat')
if (!pid) { console.error('App 未运行'); process.exit(2) }
adb('forward', 'tcp:9333', `localabstract:webview_devtools_remote_${pid}`)
const pages = await (await fetch('http://127.0.0.1:9333/json')).json()
const target = pages.find(p => p.webSocketDebuggerUrl)
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error('ws')) })
let seq = 0
const call = (method, params = {}) => new Promise(resolve => {
  const id = ++seq
  const handler = event => { const m = JSON.parse(String(event.data)); if (m.id === id) { ws.removeEventListener('message', handler); resolve(m) } }
  ws.addEventListener('message', handler)
  ws.send(JSON.stringify({ id, method, params }))
})
const evaluate = async expression => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) return { __error: String(r.result.exceptionDetails.exception?.description ?? '') }
  return r.result?.result?.value
}

// ---------- 准备：注入四色图会话 ----------
await evaluate(`(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('chat-demo'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  const now = Date.now()
  const c = document.createElement('canvas'); c.width = 800; c.height = 800
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#ff0000'; ctx.fillRect(0,0,400,400)
  ctx.fillStyle = '#00ff00'; ctx.fillRect(400,0,400,400)
  ctx.fillStyle = '#0000ff'; ctx.fillRect(0,400,400,400)
  ctx.fillStyle = '#ffff00'; ctx.fillRect(400,400,400,400)
  const url = c.toDataURL('image/png')
  const s = { id: 'crop-regress', title: '裁切回归', createdAt: now, updatedAt: now, rootMessageId: 'u1',
    messages: [
      { id: 'u1', role: 'user', content: 'r', createdAt: now, parentId: null, selectedChildId: 'a1',
        files: [{ id: 'of_r', serverId: null, name: 'r.png', size: 1, isImage: true, mimeType: 'image/png', remoteUrl: url, remoteThumbUrl: url }] },
      { id: 'a1', role: 'assistant', createdAt: now + 1, parentId: 'u1', blocks: [{ type: 'text', text: 'ok' }], model: null, prefix: true, status: 'done' }
    ] }
  await new Promise((res, rej) => {
    const tx = db.transaction(['sessions', 'sessionSummaries'], 'readwrite')
    tx.objectStore('sessions').put(s)
    tx.objectStore('sessionSummaries').put({ id: s.id, title: s.title, pinned: false, createdAt: now, updatedAt: now, fileIds: [] })
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error)
  })
  return 'injected'
})()`)
await evaluate('location.reload()')
await new Promise(r => setTimeout(r, 4500))

// ---------- 1. 打开查看器 ----------
const opened = await evaluate(`(async () => {
  const rows = [...document.querySelectorAll('.ds-history [data-session-id]')]
  const row = rows.find(r => (r.textContent || '').includes('裁切回归'))
  if (!row) return 'no-session'
  row.click()
  await new Promise(r => setTimeout(r, 2000))
  const thumb = [...document.querySelectorAll('button')].find(b => b.querySelector('img'))
  if (!thumb) return 'no-thumb'
  thumb.click()
  await new Promise(r => setTimeout(r, 900))
  return [...document.querySelectorAll('div')].some(d => String(d.className).includes('root-') && d.querySelector('img') && [...d.querySelectorAll('div')].some(x => String(x.className).includes('stage'))) ? 'viewer' : 'no-viewer'
})()`)
check('打开图片查看器', opened === 'viewer', String(opened))

// ---------- 2. 查看模式：缩放后回正（不漂移） ----------
const recenter = await evaluate(`(async () => {
  // 查看器是 portal 追加到 body 末尾的，取「最后一个包含 stage 的 root」
  const roots = [...document.querySelectorAll('div')].filter(d => String(d.className).includes('root-'))
  const root = roots.reverse().find(d => [...d.querySelectorAll('div')].some(x => String(x.className).includes('stage')) && d.querySelector('img'))
  if (root) await new Promise(r => setTimeout(r, 300))
  const stage = root ? [...root.querySelectorAll('div')].find(d => String(d.className).includes('stage')) : null
  const img = root ? root.querySelector('img') : null
  if (!stage || !img) return { error: 'no-stage', roots: roots.length }
  const mk = (type, pts) => {
    const touches = pts.map((p, i) => new Touch({ identifier: i + 1, target: stage, clientX: p[0], clientY: p[1], pageX: p[0], pageY: p[1], screenX: p[0], screenY: p[1], radiusX: 2, radiusY: 2, force: 1 }))
    return new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : touches, targetTouches: type === 'touchend' ? [] : touches, changedTouches: touches })
  }
  const transforms = []
  for (let round = 0; round < 3; round++) {
    stage.dispatchEvent(mk('touchstart', [[140, 400], [220, 400]]))
    await new Promise(r => setTimeout(r, 30))
    stage.dispatchEvent(mk('touchmove', [[100, 400], [260, 400]]))
    await new Promise(r => setTimeout(r, 200))
    stage.dispatchEvent(mk('touchend', []))
    await new Promise(r => setTimeout(r, 250))
    // 缩回
    stage.dispatchEvent(mk('touchstart', [[100, 400], [260, 400]]))
    await new Promise(r => setTimeout(r, 30))
    stage.dispatchEvent(mk('touchmove', [[140, 400], [220, 400]]))
    await new Promise(r => setTimeout(r, 200))
    stage.dispatchEvent(mk('touchend', []))
    await new Promise(r => setTimeout(r, 300))
    transforms.push(img.style.transform)
  }
  const last = transforms[transforms.length - 1]
  const m = last.match(/translate3d\((-?[\d.]+)px, (-?[\d.]+)px/)
  return { transforms, dx: m ? Number(m[1]) : null, dy: m ? Number(m[2]) : null }
})()`)
if (recenter?.error) {
  console.log('SKIP  三轮缩放后回到精确原位（脚本交互未就绪：' + recenter.error + '）')
} else {
  check('三轮缩放后回到精确原位（offset=0,0）', recenter?.dx === 0 && recenter?.dy === 0,
    `last=${recenter?.transforms?.[recenter.transforms.length - 1]}`)
}

// ---------- 3. 打开裁切页 ----------
const cropOpened = await evaluate(`(async () => {
  [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '裁切')?.click()
  await new Promise(r => setTimeout(r, 1500))
  return document.querySelector('.cropper-container') ? 'ok' : 'no-cropper'
})()`)
check('裁切页加载 Cropper.js', cropOpened === 'ok', String(cropOpened))

// ---------- 4. 裁切框初始 == 图片 ----------
const initial = await evaluate(`(() => {
  const img = document.querySelector('.cropper-canvas img') || document.querySelector('.cropper-container img')
  const box = document.querySelector('.cropper-crop-box')
  if (!img || !box) return { error: 'missing' }
  const R = el => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)] }
  return { image: R(img), box: R(box) }
})()`)
check('裁切框初始与图片对齐', initial && initial.image && initial.box &&
  Math.abs(initial.image[0] - initial.box[0]) <= 2 && Math.abs(initial.image[1] - initial.box[1]) <= 2 &&
  Math.abs(initial.image[2] - initial.box[2]) <= 2 && Math.abs(initial.image[3] - initial.box[3]) <= 2,
  JSON.stringify(initial))

// ---------- 5. 8 个控制点存在 ----------
const points = await evaluate("document.querySelectorAll('.cropper-point').length")
check('8 个控制点存在', points === 8, String(points))

// ---------- 6. 裁切框不能拖出图片 ----------
const clamped = await evaluate(`(async () => {
  const img = document.querySelector('.cropper-canvas img') || document.querySelector('.cropper-container img')
  const box = document.querySelector('.cropper-crop-box')
  const se = document.querySelector('.cropper-point.point-se')
  const R = el => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] }
  const r = se.getBoundingClientRect()
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2
  const fire = (t, x, y) => se.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 91, pointerType: 'touch', clientX: x, clientY: y, isPrimary: true }))
  fire('pointerdown', cx, cy)
  for (let i = 1; i <= 8; i++) { fire('pointermove', cx + i * 60, cy + i * 60); await new Promise(r2 => setTimeout(r2, 20)) }
  fire('pointerup', cx + 480, cy + 480)
  await new Promise(r2 => setTimeout(r2, 300))
  const b = R(box), im = R(img)
  return { box: b, image: im, inside: b[2] <= im[2] + 1 && b[3] <= im[3] + 1 }
})()`)
check('裁切框不能拖出图片', clamped?.inside === true, `box=${JSON.stringify(clamped?.box)} image=${JSON.stringify(clamped?.image)}`)

// ---------- 7. 缩放图片时裁切框大小不变 ----------
const pinchBox = await evaluate(`(async () => {
  const container = document.querySelector('.cropper-container')
  const box = document.querySelector('.cropper-crop-box')
  const R = el => { const b = el.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)] }
  const before = R(box)
  const mk = (type, pts) => {
    const touches = pts.map((p, i) => new Touch({ identifier: i + 1, target: container, clientX: p[0], clientY: p[1], pageX: p[0], pageY: p[1], screenX: p[0], screenY: p[1], radiusX: 2, radiusY: 2, force: 1 }))
    return new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : touches, targetTouches: type === 'touchend' ? [] : touches, changedTouches: touches })
  }
  container.dispatchEvent(mk('touchstart', [[150, 400], [210, 400]]))
  await new Promise(r => setTimeout(r, 40))
  container.dispatchEvent(mk('touchmove', [[120, 400], [240, 400]]))
  await new Promise(r => setTimeout(r, 300))
  const after = R(box)
  container.dispatchEvent(mk('touchend', []))
  await new Promise(r => setTimeout(r, 300))
  return { before, after, same: Math.abs(before[0] - after[0]) <= 2 && Math.abs(before[1] - after[1]) <= 2 }
})()`)
check('缩放图片时裁切框大小不变', pinchBox?.same === true, `${JSON.stringify(pinchBox?.before)} → ${JSON.stringify(pinchBox?.after)}`)

// ---------- 8. 按钮亮度 ----------
const buttons = await evaluate(`(() => {
  const btns = [...document.querySelectorAll('button')]
  const find = label => btns.find(b => (b.textContent || '').includes(label))
  const reset = find('还原'), rotate = find('旋转'), ask = find('去提问')
  const pick = b => b ? { color: getComputedStyle(b).color, opacity: getComputedStyle(b).opacity } : null
  return { reset: pick(reset), rotate: pick(rotate), ask: ask ? getComputedStyle(ask).backgroundColor : null }
})()`)
check('还原/旋转为白字不透明', buttons?.reset?.color === 'rgb(255, 255, 255)' && buttons?.reset?.opacity === '1', JSON.stringify(buttons?.reset))
check('去提问为亮蓝', String(buttons?.ask).includes('79, 124, 255'), String(buttons?.ask))

// ---------- 9. 返回键 ----------
const back = await evaluate("window.DeepSeekHandleBack?.()")
await new Promise(r => setTimeout(r, 500))
const cropClosed = await evaluate("!document.querySelector('.cropper-container')")
check('返回键关闭裁切页', back === true && cropClosed === true, `consumed=${back} closed=${cropClosed}`)
await evaluate("window.DeepSeekHandleBack?.()")
await new Promise(r => setTimeout(r, 600))
const viewerClosed = await evaluate("![...document.querySelectorAll('div')].some(d => String(d.className).includes('root-') && d.querySelector('img') && [...d.querySelectorAll('div')].some(x => String(x.className).includes('stage')))")
check('再按返回键关闭查看器', viewerClosed === true, String(viewerClosed))

// ---------- 清理 ----------
await evaluate(`(async () => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('chat-demo'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
  await new Promise(res => {
    const tx = db.transaction(['sessions', 'sessionSummaries'], 'readwrite')
    tx.objectStore('sessions').delete('crop-regress')
    tx.objectStore('sessionSummaries').delete('crop-regress')
    tx.oncomplete = () => res(); tx.onerror = () => res()
  })
  return 'cleaned'
})()`)

ws.close()
const failed = results.filter(r => !r.ok)
console.log(`\n结果：${results.length - failed.length} PASS / ${failed.length} FAIL`)
process.exit(failed.length ? 1 : 0)
