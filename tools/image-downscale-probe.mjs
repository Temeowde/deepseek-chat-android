/**
 * 真机验证：用样本里的真实长截图（671×8000 webp），确认上传前被压到 ≤4096px。
 * mock 掉上传/聊天接口，检查实际上传的图片尺寸 + 请求里的图片块。
 * 运行：$env:ADB='...'; node tools/image-downscale-probe.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ADB = process.env.ADB ?? 'adb'
const PORT = Number(process.env.CDP_PORT ?? 9347)
const PKG = 'com.temeowde.dschat'
const MARK = 'IMGDOWN' + Date.now().toString(36).toUpperCase()
const IMAGE_FILE = process.env.IMAGE_FILE ??
  String.raw`C:\Users\zzzy\AppData\Local\Temp\dschat-work\deepseek_data\chat_sessions\c9ba7ad2-8ffa-4159-a7c1-6042d4264680_files\4093cfe3-a452-4551-9ae9-7656949033d0_IMG_20260915_105850_1844109672212923786.webp`

const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8', timeout: 60000 }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const b64 = readFileSync(IMAGE_FILE).toString('base64')
console.log('测试图片：' + IMAGE_FILE.split('\\').pop() + '，base64 ' + b64.length + ' 字符')

let pids = adb('shell', 'pidof', PKG)
if (!pids) {
  adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1')
  await sleep(5000)
  pids = adb('shell', 'pidof', PKG)
}
if (!pids) throw new Error('App 未运行')
adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pids.split(/\s+/)[0]}`)
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const target = targets.find((t) => /android_asset\/chat\/index\.html/.test(t.url || ''))
if (!target) throw new Error('没找到 chat WebView')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})
let seq = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id && pending.has(message.id)) {
    pending.get(message.id).resolve(message)
    pending.delete(message.id)
  }
})
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve })
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error('cdp timeout ' + method))
      }
    }, 180000)
  })
await call('Runtime.enable').catch(() => {})
const evaluate = async (expression) => {
  const res = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const details = res.result?.exceptionDetails
  if (details) throw new Error('page exception: ' + (details.exception?.description || details.text))
  return res.result?.result?.value
}
const waitFor = async (expression, timeout, label) => {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    last = await evaluate(expression)
    if (last) return last
    await sleep(400)
  }
  throw new Error('等待超时：' + label + '（' + JSON.stringify(last) + '）')
}

await evaluate(`location.reload()`).catch(() => {})
await sleep(2000)
await waitFor(`!!document.querySelector('[data-chat-composer] textarea')`, 30000, '重载')

console.log('注入合成会话（1 张真实长截图 + 本地原件）…')
const injected = await evaluate(`(async function(){
  var MARK = ${JSON.stringify(MARK)}
  var B64 = ${JSON.stringify(b64)}
  function b64ToBlob(b64, type){
    var bin = atob(b64); var len = bin.length; var bytes = new Uint8Array(len)
    for (var i=0;i<len;i++) bytes[i]=bin.charCodeAt(i)
    return new Blob([bytes], { type: type })
  }
  function openDb(){ return new Promise(function(resolve,reject){ var r=indexedDB.open('chat-demo'); r.onsuccess=function(){resolve(r.result)}; r.onerror=function(){reject(r.error)} }) }
  var db = await openDb()
  var blob = b64ToBlob(B64, 'image/webp')
  await new Promise(function(resolve,reject){ var tx = db.transaction('files','readwrite'); tx.objectStore('files').put({ id: 'real-shot', blob: blob }); tx.oncomplete=resolve; tx.onerror=function(){reject(tx.error)} })
  var sessions = await new Promise(function(resolve){ var tx=db.transaction('sessions','readonly'); var r=tx.objectStore('sessions').getAll(); r.onsuccess=function(){resolve(r.result||[])}; r.onerror=function(){resolve([])} })
  var old = sessions.filter(function(s){ return (s.title||'').indexOf('SYNTH-DOWN')===0 }).map(function(s){return s.id})
  if (old.length) { await new Promise(function(resolve){ var tx=db.transaction(['sessions','sessionSummaries'],'readwrite'); old.forEach(function(id){tx.objectStore('sessions').delete(id); tx.objectStore('sessionSummaries').delete(id)}); tx.oncomplete=resolve; tx.onerror=resolve }) }
  var id = 'synth-down-' + Date.now()
  var title = 'SYNTH-DOWN 图片压缩测试 ' + MARK
  var t0 = Date.now() - 120000
  var file = { id: 'real-shot', serverId: null, name: 'real-shot.webp', size: blob.size, isImage: true, mimeType: 'image/webp' }
  var messages = [
    { id: id + '-u0', role: 'user', createdAt: t0, content: '看这张长截图（' + MARK + '）', files: [file], parentId: null, selectedChildId: id + '-a0' },
    { id: id + '-a0', role: 'assistant', createdAt: t0 + 1000, model: 'deepseek-flash', thinking: false, search: false, prefix: true, status: 'done', blocks: [{ type: 'text', text: '收到。' }], parentId: id + '-u0', selectedChildId: id + '-u1' },
    { id: id + '-u1', role: 'user', createdAt: t0 + 2000, content: '（图片测试）请只回复：收到' + MARK, files: [], parentId: id + '-a0', selectedChildId: null }
  ]
  var session = { id: id, title: title, createdAt: t0, updatedAt: Date.now(), messages: messages, rootMessageId: messages[0].id }
  var summary = { id: id, title: title, pinned: false, createdAt: t0, updatedAt: Date.now(), fileIds: [] }
  await new Promise(function(resolve,reject){ var tx=db.transaction(['sessions','sessionSummaries'],'readwrite'); tx.objectStore('sessions').put(session); tx.objectStore('sessionSummaries').put(summary); tx.oncomplete=resolve; tx.onerror=function(){reject(tx.error)} })
  try { db.close() } catch(e) {}
  return { id: id, title: title, size: blob.size }
})()`)
console.log('已注入：', JSON.stringify(injected))

await evaluate(`location.reload()`).catch(() => {})
await sleep(2000)
await waitFor(`!!document.querySelector('[data-chat-composer] textarea')`, 30000, '重载')
await evaluate(`(function(){
  if (window.__cap) return false
  var original = window.fetch.bind(window)
  var S = (window.__cap = { uploads: [], bodies: [] })
  window.fetch = function(input, init){
    var url = typeof input === 'string' ? input : (input && input.url) || String(input)
    if (url.indexOf('/anthropic/v1/files') !== -1) {
      var info = { index: S.uploads.length }
      try {
        var form = init && init.body
        var file = form && form.get ? form.get('file') : null
        if (file) {
          info.size = file.size; info.type = file.type; info.name = file.name
          var bitmap = createImageBitmap(file).then(function(b){ info.width=b.width; info.height=b.height; b.close() })
          info.ready = bitmap
        }
      } catch(e) { info.error = String(e) }
      S.uploads.push(info)
      return Promise.resolve(new Response(JSON.stringify({ id: 'file-up-' + S.uploads.length }), { status: 200, headers: { 'content-type': 'application/json' } }))
    }
    if (url.indexOf('/anthropic/v1/messages') !== -1) {
      try { S.bodies.push(JSON.parse((init && init.body) || '{}')) } catch(e) { S.bodies.push({ parseError: String(e) }) }
      return Promise.resolve(new Response(JSON.stringify({ error: { message: 'E2E capture only' } }), { status: 400, headers: { 'content-type': 'application/json' } }))
    }
    return original(input, init)
  }
  return true
})()`)

await evaluate(`(function(){
  var b = [...document.querySelectorAll('button')].find(function(x){ var t=(x.getAttribute('aria-label')||'')+' '+(x.title||''); return /菜单|边栏|menu|sidebar/i.test(t) })
  if (b) b.click()
  return !!b
})()`)
await sleep(800)
const clicked = await evaluate(`(function(){
  var nodes = [...document.querySelectorAll('*')].filter(function(el){ return el.children.length === 0 && (el.textContent||'').indexOf('SYNTH-DOWN') !== -1 })
  var el = nodes[0]
  if (!el) return { ok: false }
  ;(el.closest('button, [role="button"], a, li, div') || el).click()
  return { ok: true }
})()`)
if (!clicked?.ok) throw new Error('没能打开合成会话')
await sleep(1200)
await waitFor(`document.querySelectorAll('[data-chat-role="user"]').length >= 1`, 15000, '会话渲染')

await evaluate('window.__probeText = ' + JSON.stringify('请只回复：收到' + MARK))
await evaluate(`(function(){
  var t = document.querySelector('[data-chat-composer] textarea')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t, window.__probeText)
  t.dispatchEvent(new Event('input', { bubbles: true }))
  var scope = document.querySelector('[data-chat-composer]') || document
  var b = [...scope.querySelectorAll('button')].find(function(x){return (x.getAttribute('aria-label')||'')==='发送'})
  if (b) b.click()
  return !!b
})()`)
await waitFor(`__cap.bodies.length > 0`, 60000, '捕获请求')
const report = await evaluate(`(async function(){
  for (var i=0;i<__cap.uploads.length;i++) { if (__cap.uploads[i].ready) { try { await __cap.uploads[i].ready } catch(e) {} } }
  var body = __cap.bodies[__cap.bodies.length - 1]
  var imageBlocks = 0
  ;(body.messages || []).forEach(function(m){
    if (m.role !== 'user') return
    if (Array.isArray(m.content)) m.content.forEach(function(b){ if (b.type === 'image') imageBlocks += 1 })
  })
  return { uploads: __cap.uploads.map(function(u){ return { size: u.size, type: u.type, width: u.width, height: u.height } }), imageBlocks: imageBlocks }
})()`)
console.log('结果：', JSON.stringify(report, null, 2))
const upload = report.uploads[0]
if (!upload) console.log('FAIL：没有发生上传')
else if (upload.width <= 4096 && upload.height <= 4096) console.log('PASS：上传前图片已压到 ' + upload.width + '×' + upload.height + '（≤4096）')
else console.log('FAIL：上传图片尺寸 ' + upload.width + '×' + upload.height + ' 超过 4096')
console.log(report.imageBlocks === 1 ? 'PASS：请求里带 1 张图片' : 'WARN：请求图片块 ' + report.imageBlocks)

// 清理
await evaluate('location.reload()').catch(() => {})
try {
  const ids = await evaluate(`(async function(){
    var db = await new Promise(function(resolve,reject){ var r=indexedDB.open('chat-demo'); r.onsuccess=function(){resolve(r.result)}; r.onerror=function(){reject(r.error)} })
    var sessions = await new Promise(function(resolve){ var tx=db.transaction('sessions','readonly'); var r=tx.objectStore('sessions').getAll(); r.onsuccess=function(){resolve(r.result||[])}; r.onerror=function(){resolve([])} })
    var ids = sessions.filter(function(s){ return (s.title||'').indexOf('SYNTH-DOWN')===0 }).map(function(s){return s.id})
    if (ids.length) { await new Promise(function(resolve){ var tx=db.transaction(['sessions','sessionSummaries'],'readwrite'); ids.forEach(function(id){tx.objectStore('sessions').delete(id); tx.objectStore('sessionSummaries').delete(id)}); tx.oncomplete=resolve; tx.onerror=resolve }) }
    await new Promise(function(resolve){ var tx=db.transaction('files','readwrite'); tx.objectStore('files').delete('real-shot'); tx.oncomplete=resolve; tx.onerror=resolve })
    try { db.close() } catch(e) {}
    return ids
  })()`)
  console.log('已清理：', JSON.stringify(ids))
} catch {}
ws.close()
