/**
 * 真机验证"几百张历史图片不再卡死"：
 * 注入 60 张"没有 serverId 的图片附件"（模拟导入的历史会话），
 * mock 掉上传接口和聊天请求，统计：
 *   - 实际上传了几张（应 ≤20）
 *   - 聊天请求里图片块几块（应 ≤20）、有多少条"图片已省略"占位
 * 运行：$env:ADB='...'; node tools/image-upload-cap-probe.mjs
 */
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB ?? 'adb'
const PORT = Number(process.env.CDP_PORT ?? 9344)
const PKG = 'com.temeowde.dschat'
const MARK = 'IMGUPCAP' + Date.now().toString(36).toUpperCase()
const ROUNDS = Number(process.env.ROUNDS ?? 60)

const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8', timeout: 60000 }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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

console.log('注入合成会话：' + ROUNDS + ' 张无 serverId 图片（模拟导入历史）…')
const injected = await evaluate(`(async function(){
  var MARK = ${JSON.stringify(MARK)}
  var ROUNDS = ${ROUNDS}
  function openDb(){ return new Promise(function(resolve,reject){ var r=indexedDB.open('chat-demo'); r.onsuccess=function(){resolve(r.result)}; r.onerror=function(){reject(r.error)} }) }
  var db = await openDb()
  // 小尺寸 PNG blob，模拟本地原件（真实场景是 webp 长截图，逻辑相同）
  var canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 80
  var ctx = canvas.getContext('2d'); ctx.fillStyle = '#3355aa'; ctx.fillRect(0,0,40,80)
  var blobs = []
  for (var i = 0; i < ROUNDS; i++) {
    var blob = await new Promise(function(resolve){ canvas.toBlob(resolve, 'image/png') })
    blobs.push({ id: 'upimg-' + i, blob: blob })
  }
  await new Promise(function(resolve, reject){ var tx = db.transaction('files','readwrite'); blobs.forEach(function(item){ tx.objectStore('files').put(item) }); tx.oncomplete = resolve; tx.onerror = function(){ reject(tx.error) } })
  var sessions = await new Promise(function(resolve){ var tx=db.transaction('sessions','readonly'); var r=tx.objectStore('sessions').getAll(); r.onsuccess=function(){resolve(r.result||[])}; r.onerror=function(){resolve([])} })
  var old = sessions.filter(function(s){ return (s.title||'').indexOf('SYNTH-UPIMG')===0 }).map(function(s){return s.id})
  if (old.length) { await new Promise(function(resolve){ var tx=db.transaction(['sessions','sessionSummaries'],'readwrite'); old.forEach(function(id){tx.objectStore('sessions').delete(id); tx.objectStore('sessionSummaries').delete(id)}); tx.oncomplete=resolve; tx.onerror=resolve }) }
  var id = 'synth-upimg-' + Date.now()
  var title = 'SYNTH-UPIMG 图片补传测试 ' + MARK
  var t0 = Date.now() - ROUNDS * 60000
  var messages = []
  for (var i = 0; i < ROUNDS; i++) {
    var qid = id + '-u' + i, aid = id + '-a' + i
    var nextQ = i + 1 < ROUNDS ? id + '-u' + (i + 1) : id + '-u-' + ROUNDS
    var file = { id: 'upimg-' + i, serverId: null, name: 'img-' + i + '.png', size: 1000, isImage: true, mimeType: 'image/png' }
    messages.push({ id: qid, role: 'user', createdAt: t0 + i * 60000, content: '第' + i + '轮（' + MARK + '）', files: [file], parentId: i === 0 ? null : id + '-a' + (i - 1), selectedChildId: aid })
    messages.push({ id: aid, role: 'assistant', createdAt: t0 + i * 60000 + 1000, model: 'deepseek-flash', thinking: false, search: false, prefix: true, status: 'done', blocks: [{ type: 'text', text: '收到第' + i + '轮。' }], parentId: qid, selectedChildId: nextQ })
  }
  var qid = id + '-u-' + ROUNDS
  messages.push({ id: qid, role: 'user', createdAt: t0 + ROUNDS * 60000, content: '（补传测试）请只回复：收到' + MARK, files: [], parentId: id + '-a-' + (ROUNDS - 1), selectedChildId: null })
  var session = { id: id, title: title, createdAt: t0, updatedAt: Date.now(), messages: messages, rootMessageId: messages[0].id }
  var summary = { id: id, title: title, pinned: false, createdAt: t0, updatedAt: Date.now(), fileIds: [] }
  await new Promise(function(resolve,reject){ var tx=db.transaction(['sessions','sessionSummaries'],'readwrite'); tx.objectStore('sessions').put(session); tx.objectStore('sessionSummaries').put(summary); tx.oncomplete=resolve; tx.onerror=function(){reject(tx.error)} })
  try { db.close() } catch(e) {}
  return { id: id, title: title, messages: messages.length }
})()`)
console.log('已注入：', JSON.stringify(injected))

await evaluate('location.reload()').catch(() => {})
await sleep(2000)
await waitFor(`!!document.querySelector('[data-chat-composer] textarea')`, 30000, '重载')
// mock：上传接口 + 聊天接口（都不联网）
await evaluate(`(function(){
  if (window.__cap) return false
  var original = window.fetch.bind(window)
  var S = (window.__cap = { uploads: 0, bodies: [], times: [] })
  window.fetch = function(input, init){
    var url = typeof input === 'string' ? input : (input && input.url) || String(input)
    if (url.indexOf('/anthropic/v1/files') !== -1) {
      var index = S.uploads
      S.uploads += 1
      S.times.push({ start: performance.now(), end: null })
      // 模拟真实上传耗时 400ms，用于观察是否并行
      return new Promise(function(resolve){
        setTimeout(function(){
          S.times[index].end = performance.now()
          resolve(new Response(JSON.stringify({ id: 'file-uploaded-' + (index + 1), object: 'file', purpose: 'vision' }), { status: 200, headers: { 'content-type': 'application/json' } }))
        }, 400)
      })
    }
    if (url.indexOf('/anthropic/v1/messages') !== -1) {
      try { S.bodies.push(JSON.parse((init && init.body) || '{}')) } catch(e) { S.bodies.push({ parseError: String(e) }) }
      return Promise.resolve(new Response(JSON.stringify({ error: { message: 'E2E capture only' } }), { status: 400, headers: { 'content-type': 'application/json' } }))
    }
    return original(input, init)
  }
  return true
})()`)

// 打开合成会话
await evaluate(`(function(){
  var b = [...document.querySelectorAll('button')].find(function(x){ var t=(x.getAttribute('aria-label')||'')+' '+(x.title||''); return /菜单|边栏|历史|对话|menu|sidebar|history/i.test(t) })
  if (b) b.click()
  return !!b
})()`)
await sleep(800)
const clicked = await evaluate(`(function(){
  var nodes = [...document.querySelectorAll('*')].filter(function(el){ return el.children.length === 0 && (el.textContent||'').indexOf('SYNTH-UPIMG') !== -1 })
  var el = nodes[0]
  if (!el) return { ok: false }
  ;(el.closest('button, [role="button"], a, li, div') || el).click()
  return { ok: true }
})()`)
if (!clicked?.ok) throw new Error('没能打开合成会话')
await sleep(1500)
await waitFor(`document.querySelectorAll('[data-chat-role="user"]').length >= 5`, 20000, '会话渲染')

await evaluate('window.__probeText = ' + JSON.stringify('补传测试 ' + MARK))
await evaluate(`(function(){
  var t = document.querySelector('[data-chat-composer] textarea')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t, window.__probeText)
  t.dispatchEvent(new Event('input', { bubbles: true }))
  var scope = document.querySelector('[data-chat-composer]') || document
  var b = [...scope.querySelectorAll('button')].find(function(x){return (x.getAttribute('aria-label')||'')==='发送'})
  if (b) b.click()
  return !!b
})()`)
await waitFor(`__cap.bodies.length > 0`, 60000, '捕获聊天请求')
const report = await evaluate(`(function(){
  var body = __cap.bodies[__cap.bodies.length - 1]
  var msgs = body.messages || []
  var imageBlocks = 0
  var placeholders = 0
  msgs.forEach(function(m){
    if (m.role !== 'user') return
    if (typeof m.content === 'string') { if (m.content.indexOf('张图片已省略') !== -1) placeholders += 1; return }
    ;(m.content || []).forEach(function(block){
      if (block.type === 'image') imageBlocks += 1
      if (block.type === 'text' && (block.text || '').indexOf('张图片已省略') !== -1) placeholders += 1
    })
  })
  return { uploadCalls: __cap.uploads, messageCount: msgs.length, imageBlocks: imageBlocks, placeholders: placeholders,
           timing: (function(){
             var times = __cap.times || []
             if (!times.length) return null
             var events = []
             times.forEach(function(t){ events.push({ at: t.start, delta: 1 }); if (t.end) events.push({ at: t.end, delta: -1 }) })
             events.sort(function(a,b){ return a.at - b.at })
             var current = 0, max = 0
             events.forEach(function(e){ current += e.delta; if (current > max) max = current })
             var start = Math.min.apply(null, times.map(function(t){ return t.start }))
             var end = Math.max.apply(null, times.map(function(t){ return t.end || t.start }))
             return { maxConcurrency: max, durationMs: Math.round(end - start) }
           })() }
})()`)
console.log('统计：', JSON.stringify(report, null, 2))
console.log(report.uploadCalls <= 20 ? 'PASS：上传调用 ≤20（实际 ' + report.uploadCalls + '）' : 'FAIL：上传调用过多（' + report.uploadCalls + '）')
console.log(report.imageBlocks <= 20 ? 'PASS：请求图片块 ≤20（实际 ' + report.imageBlocks + '）' : 'FAIL：请求图片块过多（' + report.imageBlocks + '）')
console.log(report.placeholders >= ROUNDS - 20 ? 'PASS：占位文字足够（' + report.placeholders + '）' : 'FAIL：占位不足（' + report.placeholders + '）')
if (report.timing) {
  console.log(report.timing.maxConcurrency >= 2 ? 'PASS：上传已并行（最大并发 ' + report.timing.maxConcurrency + '）' : 'FAIL：仍是串行（最大并发 ' + report.timing.maxConcurrency + '）')
  console.log('上传总耗时（20 张 × 400ms）：' + report.timing.durationMs + 'ms（串行约 8000ms）')
}

// 清理
await evaluate('location.reload()').catch(() => {})
try {
  const ids = await evaluate(`(async function(){
    var db = await new Promise(function(resolve,reject){ var r=indexedDB.open('chat-demo'); r.onsuccess=function(){resolve(r.result)}; r.onerror=function(){reject(r.error)} })
    var sessions = await new Promise(function(resolve){ var tx=db.transaction('sessions','readonly'); var r=tx.objectStore('sessions').getAll(); r.onsuccess=function(){resolve(r.result||[])}; r.onerror=function(){resolve([])} })
    var ids = sessions.filter(function(s){ return (s.title||'').indexOf('SYNTH-UPIMG')===0 }).map(function(s){return s.id})
    if (ids.length) { await new Promise(function(resolve){ var tx=db.transaction(['sessions','sessionSummaries'],'readwrite'); ids.forEach(function(id){tx.objectStore('sessions').delete(id); tx.objectStore('sessionSummaries').delete(id)}); tx.oncomplete=resolve; tx.onerror=resolve }) }
    var keys = []
    for (var i = 0; i < 100; i++) keys.push('upimg-' + i)
    await new Promise(function(resolve){ var tx=db.transaction('files','readwrite'); keys.forEach(function(key){ tx.objectStore('files').delete(key) }); tx.oncomplete=resolve; tx.onerror=resolve })
    try { db.close() } catch(e) {}
    return ids
  })()`)
  console.log('已清理：', JSON.stringify(ids))
} catch {}
ws.close()
