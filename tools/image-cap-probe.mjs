/**
 * 真机验证：注入一个带 150 张图片（附件元数据）的合成会话，发一条消息，
 * 拦截真实请求体，确认图片块被压到 100 以内、较早图片有占位文字。
 * 运行：$env:ADB='...'; node tools/image-cap-probe.mjs
 */
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB ?? 'adb'
const PORT = Number(process.env.CDP_PORT ?? 9343)
const PKG = 'com.temeowde.dschat'
const MARK = 'IMGCAP' + Date.now().toString(36).toUpperCase()
const ROUNDS = Number(process.env.ROUNDS ?? 150)

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
    }, 120000)
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

// 先装 mock fetch（只拦 /anthropic/v1/messages，返回 400）
await evaluate(`(function(){
  if (window.__cap) return false
  var original = window.fetch.bind(window)
  var S = (window.__cap = { bodies: [] })
  window.fetch = function(input, init){
    var url = typeof input === 'string' ? input : (input && input.url) || String(input)
    if (url.indexOf('/anthropic/v1/messages') !== -1) {
      try { S.bodies.push(JSON.parse((init && init.body) || '{}')) } catch(e) { S.bodies.push({ parseError: String(e) }) }
      return Promise.resolve(new Response(JSON.stringify({ error: { message: 'E2E capture only' } }), { status: 400, headers: { 'content-type': 'application/json' } }))
    }
    return original(input, init)
  }
  return true
})()`)

console.log('注入合成会话：' + ROUNDS + ' 轮，每轮 1 张图片…')
const injected = await evaluate(`(async function(){
  var MARK = ${JSON.stringify(MARK)}
  var ROUNDS = ${ROUNDS}
  function openDb(){ return new Promise(function(resolve,reject){ var r=indexedDB.open('chat-demo'); r.onsuccess=function(){resolve(r.result)}; r.onerror=function(){reject(r.error)} }) }
  var db = await openDb()
  var sessions = await new Promise(function(resolve){ var tx=db.transaction('sessions','readonly'); var r=tx.objectStore('sessions').getAll(); r.onsuccess=function(){resolve(r.result||[])}; r.onerror=function(){resolve([])} })
  var old = sessions.filter(function(s){ return (s.title||'').indexOf('SYNTH-IMG')===0 }).map(function(s){return s.id})
  if (old.length) { await new Promise(function(resolve){ var tx=db.transaction(['sessions','sessionSummaries'],'readwrite'); old.forEach(function(id){tx.objectStore('sessions').delete(id); tx.objectStore('sessionSummaries').delete(id)}); tx.oncomplete=resolve; tx.onerror=resolve }) }
  var id = 'synth-img-' + Date.now()
  var title = 'SYNTH-IMG 图片测试 ' + MARK
  var t0 = Date.now() - ROUNDS * 60000
  var messages = []
  for (var i = 0; i < ROUNDS; i++) {
    var qid = id + '-u' + i, aid = id + '-a' + i
    var nextQ = i + 1 < ROUNDS ? id + '-u' + (i + 1) : id + '-u-' + ROUNDS
    var file = { id: 'img-' + i, serverId: 'file-fake-' + i, name: 'img-' + i + '.png', size: 1000, isImage: true, mimeType: 'image/png' }
    messages.push({ id: qid, role: 'user', createdAt: t0 + i * 60000, content: '第' + i + '轮（' + MARK + '）', files: [file], parentId: i === 0 ? null : id + '-a' + (i - 1), selectedChildId: aid })
    messages.push({ id: aid, role: 'assistant', createdAt: t0 + i * 60000 + 1000, model: 'deepseek-flash', thinking: false, search: false, prefix: true, status: 'done', blocks: [{ type: 'text', text: '收到第' + i + '轮。' }], parentId: qid, selectedChildId: nextQ })
  }
  var qid = id + '-u-' + ROUNDS
  messages.push({ id: qid, role: 'user', createdAt: t0 + ROUNDS * 60000, content: '（图片测试）请只回复：收到' + MARK, files: [], parentId: id + '-a-' + (ROUNDS - 1), selectedChildId: null })
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
// reload 会清掉补丁，重装 mock fetch（只拦 /anthropic/v1/messages，返回 400）
await evaluate(`(function(){
  if (window.__cap) return false
  var original = window.fetch.bind(window)
  var S = (window.__cap = { bodies: [] })
  window.fetch = function(input, init){
    var url = typeof input === 'string' ? input : (input && input.url) || String(input)
    if (url.indexOf('/anthropic/v1/messages') !== -1) {
      try { S.bodies.push(JSON.parse((init && init.body) || '{}')) } catch(e) { S.bodies.push({ parseError: String(e) }) }
      return Promise.resolve(new Response(JSON.stringify({ error: { message: 'E2E capture only' } }), { status: 400, headers: { 'content-type': 'application/json' } }))
    }
    return original(input, init)
  }
  return true
})()`)
await evaluate(`(function(){
  var b = [...document.querySelectorAll('button')].find(function(x){ var t=(x.getAttribute('aria-label')||'')+' '+(x.title||''); return /菜单|边栏|历史|对话|menu|sidebar|history/i.test(t) })
  if (b) b.click()
  return !!b
})()`)
await sleep(800)
const clicked = await evaluate(`(function(){
  var nodes = [...document.querySelectorAll('*')].filter(function(el){ return el.children.length === 0 && (el.textContent||'').indexOf('SYNTH-IMG') !== -1 })
  var el = nodes[0]
  if (!el) return { ok: false }
  ;(el.closest('button, [role="button"], a, li, div') || el).click()
  return { ok: true }
})()`)
if (!clicked?.ok) throw new Error('没能打开合成会话')
await sleep(1500)
await waitFor(`document.querySelectorAll('[data-chat-role="user"]').length >= 5`, 20000, '会话渲染')

// 发送一条短消息以触发请求
await evaluate('window.__probeText = ' + JSON.stringify('图片测试 ' + MARK))
await evaluate(`(function(){
  var t = document.querySelector('[data-chat-composer] textarea')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t, window.__probeText)
  t.dispatchEvent(new Event('input', { bubbles: true }))
  var scope = document.querySelector('[data-chat-composer]') || document
  var b = [...scope.querySelectorAll('button')].find(function(x){return (x.getAttribute('aria-label')||'')==='发送'})
  if (b) b.click()
  return !!b
})()`)
await waitFor(`__cap.bodies.length > 0`, 30000, '捕获请求')
const report = await evaluate(`(function(){
  var body = __cap.bodies[__cap.bodies.length - 1]
  var msgs = body.messages || []
  var imageBlocks = 0
  var placeholders = 0
  var users = 0
  msgs.forEach(function(m){
    if (m.role !== 'user') return
    users += 1
    if (typeof m.content === 'string') {
      if (m.content.indexOf('张图片已省略') !== -1) placeholders += 1
      return
    }
    ;(m.content || []).forEach(function(block){
      if (block.type === 'image') imageBlocks += 1
      if (block.type === 'text' && (block.text || '').indexOf('张图片已省略') !== -1) placeholders += 1
    })
  })
  return { messageCount: msgs.length, users: users, imageBlocks: imageBlocks, placeholders: placeholders }
})()`)
console.log('请求体统计：', JSON.stringify(report, null, 2))
console.log(report.imageBlocks <= 100 ? 'PASS：图片块 ≤100（实际 ' + report.imageBlocks + '）' : 'FAIL：图片块超过 100（' + report.imageBlocks + '）')
console.log(report.placeholders >= 50 ? 'PASS：较早图片有占位文字（' + report.placeholders + ' 条）' : 'FAIL：占位文字不足（' + report.placeholders + ' 条）')

// 清理
await evaluate('location.reload()').catch(() => {})
try {
  const ids = await evaluate(`(async function(){
    var db = await new Promise(function(resolve,reject){ var r=indexedDB.open('chat-demo'); r.onsuccess=function(){resolve(r.result)}; r.onerror=function(){reject(r.error)} })
    var sessions = await new Promise(function(resolve){ var tx=db.transaction('sessions','readonly'); var r=tx.objectStore('sessions').getAll(); r.onsuccess=function(){resolve(r.result||[])}; r.onerror=function(){resolve([])} })
    var ids = sessions.filter(function(s){ return (s.title||'').indexOf('SYNTH-IMG')===0 }).map(function(s){return s.id})
    if (ids.length) { await new Promise(function(resolve){ var tx=db.transaction(['sessions','sessionSummaries'],'readwrite'); ids.forEach(function(id){tx.objectStore('sessions').delete(id); tx.objectStore('sessionSummaries').delete(id)}); tx.oncomplete=resolve; tx.onerror=resolve }) }
    try { db.close() } catch(e) {}
    return ids
  })()`)
  console.log('已清理：', JSON.stringify(ids))
} catch {}
ws.close()
