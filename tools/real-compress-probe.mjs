/**
 * 真实接口探测 2：用真机 + 真 API 把对话聊到"总请求超过单次上限"，观察真实的
 * 「压缩上下文并继续」按钮 → 点击 → 摘要 → 自动重发 → 继续对话。
 *
 * 运行：$env:ADB='D:\AndroidToolchain\sdk\platform-tools\adb.exe'; node tools/real-compress-probe.mjs
 * 注意：会真实调用 API（约 20 万 input tokens，费用很小）。
 */
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB ?? 'adb'
const PORT = Number(process.env.CDP_PORT ?? 9335)
const PKG = 'com.temeowde.dschat'
const MARK = 'REALCMP' + Date.now().toString(36).toUpperCase()
const ROUNDS = Number(process.env.ROUNDS ?? 9)
const CHARS = Number(process.env.CHARS ?? 7200)

const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8', timeout: 60000 }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pids = adb('shell', 'pidof', PKG)
if (!pids) throw new Error('App 未运行')
const pid = pids.split(/\s+/)[0]
adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`)
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

const env = await evaluate(`(function(){
  var prefs = window.chatDisplayPrefs
  return { version: (document.querySelector('meta[name="application-version"]')||{}).content||'',
           provider: prefs ? prefs.read('provider','deepseek') : '(none)',
           keyLen: (function(){try{return String((window.DeepSeekAndroid&&window.DeepSeekAndroid.getApiKey&&window.DeepSeekAndroid.getApiKey())||'').length}catch(e){return -1}})() }
})()`)
console.log('环境：', JSON.stringify(env))
if (env.provider !== 'deepseek') throw new Error('provider 必须是 deepseek')
if (!(env.keyLen > 0)) throw new Error('没有 API Key')

// 新对话
await evaluate(`(function(){
  var buttons = [...document.querySelectorAll('button')]
  var b = buttons.find(function(x){return (x.getAttribute('aria-label')||'')==='开启新对话'})
  if (!b) b = buttons.find(function(x){return (x.textContent||'').trim()==='开启新对话'})
  if (b) b.click()
  return !!b
})()`)
await sleep(1200)
await waitFor(`document.querySelectorAll('[data-chat-role="user"]').length === 0`, 10000, '新对话清空')

const filler = (round) => {
  const parts = []
  let i = 1
  while (parts.join('').length < CHARS) {
    parts.push(
      `第${round}轮第${i}段：蓝鲸项目代号 B${round}${i}，负责人第${i}组，预算${i * 100}元，` +
        `截止 2026-12-${(i % 28) + 1}，风险是数据备份和权限控制，结论是先做最小版本。`
    )
    i += 1
  }
  return `（第${round}轮长文本 ${MARK}）` + parts.join('')
}

const send = async (text) => {
  await evaluate('window.__probeText = ' + JSON.stringify(text))
  await evaluate(`(function(){
    var t = document.querySelector('[data-chat-composer] textarea')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t, window.__probeText)
    t.dispatchEvent(new Event('input', { bubbles: true }))
    return t.value.length
  })()`)
  await sleep(300)
  return evaluate(`(function(){
    var scope = document.querySelector('[data-chat-composer]') || document
    var b = [...scope.querySelectorAll('button')].find(function(x){return (x.getAttribute('aria-label')||'')==='发送'})
    if (b) b.click()
    return !!b
  })()`)
}

const state = () =>
  evaluate(`(function(){
    var list = [...document.querySelectorAll('[data-chat-role="assistant"]')]
    var last = list.length ? (list[list.length-1].textContent||'') : ''
    var buttons = [...document.querySelectorAll('[data-chat-role="assistant"] button')].map(function(b){return (b.textContent||'').trim()}).filter(Boolean)
    return {
      assistantCount: list.length,
      userCount: document.querySelectorAll('[data-chat-role="user"]').length,
      textLen: last.length,
      tail: last.slice(-260),
      buttons: buttons,
      streaming: !!document.querySelector('[aria-label="停止生成"], [aria-label="Stop"]')
    }
  })()`)

const waitSettled = async (label, timeout = 240000) => {
  const started = Date.now()
  let stable = 0
  let snap = null
  while (Date.now() - started < timeout) {
    snap = await state()
    if (snap.textLen > 0 && !snap.streaming) {
      stable += 1
      if (stable >= 3) return snap
    } else stable = 0
    await sleep(1000)
  }
  throw new Error('等待超时：' + label + ' → ' + JSON.stringify(snap))
}

console.log('\n开始逐轮发送，每轮约 ' + CHARS + ' 字…')
let overflowSnap = null
for (let round = 1; round <= ROUNDS; round += 1) {
  const text = filler(round)
  const started = Date.now()
  const ok = await send(text)
  if (!ok) throw new Error('第 ' + round + ' 轮点击发送失败')
  let snap
  try {
    snap = await waitSettled('第 ' + round + ' 轮', 240000)
  } catch (error) {
    console.log('第 ' + round + ' 轮等待失败：' + error.message)
    throw error
  }
  const seconds = Math.round((Date.now() - started) / 1000)
  const limited = snap.buttons.some((b) => b.includes('压缩上下文并继续') || b.includes('截断后发送'))
  console.log(
    `第 ${round} 轮：${seconds}s，回答 ${snap.textLen} 字` +
      (limited ? `，出现按钮：${JSON.stringify(snap.buttons)}` : '') +
      (snap.tail.includes('超过单次上限') || snap.tail.includes('上下文') ? `，尾部：${snap.tail.slice(-90)}` : '')
  )
  if (limited) {
    overflowSnap = snap
    break
  }
}

if (!overflowSnap) {
  console.log('\n未在 ' + ROUNDS + ' 轮内触发超限；可调大 ROUNDS 再试。')
  process.exitCode = 2
} else {
  const hasCompress = overflowSnap.buttons.some((b) => b.includes('压缩上下文并继续'))
  console.log('\n>> 触发超限，出现按钮：' + JSON.stringify(overflowSnap.buttons))
  console.log('>> 点击「' + (hasCompress ? '压缩上下文并继续' : '截断后发送') + '」…')
  await evaluate(`(function(){
    var label = ${JSON.stringify(hasCompress ? '压缩上下文并继续' : '截断后发送')}
    var list = [...document.querySelectorAll('[data-chat-role="assistant"] button')]
    var b = list.find(function(x){return (x.textContent||'').trim().indexOf(label)!==-1})
    if (b) b.click()
    return !!b
  })()`)
  const t = Date.now()
  const after = await waitSettled('点击后', 300000)
  console.log('点击后 ' + Math.round((Date.now() - t) / 1000) + 's，结果：', JSON.stringify({
    userCount: after.userCount,
    assistantCount: after.assistantCount,
    textLen: after.textLen,
    tail: after.tail,
    remainingButtons: after.buttons,
  }, null, 2))
  const finished = after.textLen > 0 && !after.buttons.some((b) => b.includes('压缩上下文并继续'))
  console.log(finished ? 'OK=true（已继续对话）' : 'WARN=仍有按钮或没有回答')
}

try {
  adb('shell', 'screencap', '-p', '/sdcard/realcompress.png')
  adb('pull', '/sdcard/realcompress.png', String.raw`C:\Users\zzzy\AppData\Local\Temp\dschat-work\realcompress.png`)
  console.log('截图：C:\\Users\\zzzy\\AppData\\Local\\Temp\\dschat-work\\realcompress.png')
} catch {}

try {
  const ids = await evaluate(`(async function(){
    var MARK = ${JSON.stringify(MARK)}
    var db = await new Promise(function(resolve, reject){ var r = indexedDB.open('chat-demo'); r.onsuccess=function(){resolve(r.result)}; r.onerror=function(){reject(r.error)} })
    var sessions = await new Promise(function(resolve){ var tx=db.transaction('sessions','readonly'); var r=tx.objectStore('sessions').getAll(); r.onsuccess=function(){resolve(r.result||[])}; r.onerror=function(){resolve([])} })
    var ids = sessions.filter(function(s){ try { return JSON.stringify(s).indexOf(MARK)!==-1 } catch(e){ return false } }).map(function(s){return s.id})
    if (ids.length) {
      await new Promise(function(resolve){ var tx=db.transaction(['sessions','sessionSummaries'],'readwrite'); ids.forEach(function(id){tx.objectStore('sessions').delete(id); tx.objectStore('sessionSummaries').delete(id)}); tx.oncomplete=resolve; tx.onerror=resolve })
    }
    try { db.close() } catch(e) {}
    return ids
  })()`)
  console.log('已删除测试会话：', JSON.stringify(ids))
} catch {}
ws.close()
