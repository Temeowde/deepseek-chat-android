/**
 * 抓 App 真实请求体：确认 6 万字粘贴消息是否被包成 document 内容块。
 * 用 mock fetch 拦截 /anthropic/v1/messages（不发送、不花钱），返回 400。
 * 运行：$env:ADB='...'; node tools/capture-request.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ADB = process.env.ADB ?? 'adb'
const PORT = Number(process.env.CDP_PORT ?? 9342)
const PKG = 'com.temeowde.dschat'
const TEXT_FILE = process.env.PROBE_FILE ?? String.raw`C:\Users\zzzy\Desktop\DSCHAT-HANDOFF\测试文件\长文测试-复制粘贴用-6万字.txt`

const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8', timeout: 60000 }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pids = adb('shell', 'pidof', PKG)
if (!pids) throw new Error('App 未运行')
adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pids.split(/\s+/)[0]}`)
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const target = targets.find((t) => /android_asset\/chat\/index\.html/.test(t.url || ''))
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
    await sleep(500)
  }
  throw new Error('等待超时：' + label + '（' + JSON.stringify(last) + '）')
}

// 安装 mock fetch：只拦 chat messages，记录请求体后返回 400
const installed = await evaluate(`(function(){
  if (window.__cap) return false
  var original = window.fetch.bind(window)
  var S = (window.__cap = { bodies: [], urls: [] })
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
console.log('mock fetch 安装：' + installed)
await evaluate(`(function(){
  var buttons = [...document.querySelectorAll('button')]
  var b = buttons.find(function(x){return (x.getAttribute('aria-label')||'')==='开启新对话'})
  if (!b) b = buttons.find(function(x){return (x.textContent||'').trim()==='开启新对话'})
  if (b) b.click()
  return !!b
})()`)
await sleep(1200)
await waitFor(`document.querySelectorAll('[data-chat-role="user"]').length === 0`, 10000, '新对话清空')

const text = readFileSync(TEXT_FILE, 'utf8').slice(0, 60000)
await evaluate('window.__probeText = ' + JSON.stringify(text))
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
const captured = await evaluate(`(function(){
  var body = __cap.bodies[__cap.bodies.length - 1]
  var msgs = body.messages || []
  var last = msgs[msgs.length - 1] || {}
  var content = last.content
  function describe(block) {
    if (typeof block === 'string') return { type: 'string', len: block.length, head: block.slice(0, 40) }
    var out = { type: block.type, len: 0, source: block.source && block.source.type }
    if (block.type === 'text') out.len = (block.text || '').length
    if (block.type === 'document') {
      var src = block.source || {}
      out.len = src.type === 'file' ? 0 : (src.data || '').length
      out.media = src.media_type
      out.fileId = src.file_id
    }
    return out
  }
  return {
    model: body.model,
    messageCount: msgs.length,
    roles: msgs.map(function(m){ return m.role }),
    lastContent: typeof content === 'string' ? { type: 'string', len: content.length } : { type: 'array', blocks: content.map(describe) },
    lastContentLen: JSON.stringify(content).length
  }
})()`)
console.log(JSON.stringify(captured, null, 2))
await evaluate('location.reload()').catch(() => {})
ws.close()
