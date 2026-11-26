/**
 * 真机验证：粘贴 6 万字（>32K tokens）现在应直接成功（走内联 document 块），不再报超限。
 * 运行：$env:ADB='...'; $env:E2E_SET_PROVIDER='1'; node tools/real-document-route-probe.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const ADB = process.env.ADB ?? 'adb'
const PORT = Number(process.env.CDP_PORT ?? 9341)
const PKG = 'com.temeowde.dschat'
const MARK = 'DOCROUTE' + Date.now().toString(36).toUpperCase()
const TEXT_FILE = process.env.PROBE_FILE ?? String.raw`C:\Users\zzzy\Desktop\DSCHAT-HANDOFF\测试文件\长文测试-复制粘贴用-6万字.txt`

const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8', timeout: 60000 }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const screencap = (name) => {
  try {
    adb('shell', 'screencap', '-p', `/sdcard/${name}.png`)
    adb('pull', `/sdcard/${name}.png`, String.raw`C:\Users\zzzy\AppData\Local\Temp\dschat-work\${name}.png`)
    console.log('截图：C:\\Users\\zzzy\\AppData\\Local\\Temp\\dschat-work\\' + name + '.png')
  } catch {}
}

let pids = adb('shell', 'pidof', PKG)
if (!pids) {
  adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1')
  await sleep(5000)
  pids = adb('shell', 'pidof', PKG)
}
if (!pids) throw new Error('App 未运行')
const appPid = pids.split(/\s+/)[0]
adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${appPid}`)
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
    }, 240000)
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
const readEnv = () =>
  evaluate(`(function(){
    var prefs = window.chatDisplayPrefs
    return { version: (document.querySelector('meta[name="application-version"]')||{}).content||'',
             provider: prefs ? prefs.read('provider','deepseek') : '(none)',
             keyLen: (function(){try{return String((window.DeepSeekAndroid&&window.DeepSeekAndroid.getApiKey&&window.DeepSeekAndroid.getApiKey())||'').length}catch(e){return -1}})() }
  })()`)

let env = await readEnv()
console.log('环境：', JSON.stringify(env))
let originalProvider = env.provider
let providerChanged = false
if (env.provider !== 'deepseek') {
  if (process.env.E2E_SET_PROVIDER !== '1') throw new Error('provider 必须是 deepseek，当前 ' + env.provider)
  await evaluate(`window.chatDisplayPrefs.save('provider', 'deepseek')`)
  providerChanged = true
  await evaluate('location.reload()').catch(() => {})
  await sleep(2000)
  await waitFor(`!!document.querySelector('[data-chat-composer] textarea')`, 30000, '切换 provider 后重载')
  env = await readEnv()
}
if (!(env.keyLen > 0)) throw new Error('没有 API Key')

await evaluate(`(function(){
  var buttons = [...document.querySelectorAll('button')]
  var b = buttons.find(function(x){return (x.getAttribute('aria-label')||'')==='开启新对话'})
  if (!b) b = buttons.find(function(x){return (x.textContent||'').trim()==='开启新对话'})
  if (b) b.click()
  return !!b
})()`)
await sleep(1200)
await waitFor(`document.querySelectorAll('[data-chat-role="user"]').length === 0`, 10000, '新对话清空')

const text = readFileSync(TEXT_FILE, 'utf8').slice(0, 60000) + '\n\n' + MARK
console.log('发送：' + text.length + ' 字符（≈' + Math.ceil(text.length / 1.6) + ' tokens，超过 32,768）')
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

const started = Date.now()
let snap = null
while (Date.now() - started < 180000) {
  snap = await evaluate(`(function(){
    var list = [...document.querySelectorAll('[data-chat-role="assistant"]')]
    var last = list.length ? (list[list.length-1].textContent||'') : ''
    var buttons = [...document.querySelectorAll('[data-chat-role="assistant"] button')].map(function(b){return (b.textContent||'').trim()}).filter(Boolean)
    return { count: list.length, textLen: last.length, tail: last.slice(-500), buttons: buttons,
             streaming: !!document.querySelector('[aria-label="停止生成"], [aria-label="Stop"]') }
  })()`)
  if (snap.textLen > 0 && !snap.streaming && !snap.buttons.some((b) => b.includes('截断') || b.includes('压缩'))) break
  await sleep(1200)
}
console.log('耗时约 ' + Math.round((Date.now() - started) / 1000) + 's')
console.log('结果：', JSON.stringify({ textLen: snap?.textLen, tail: snap?.tail, buttons: snap?.buttons }, null, 2))
screencap('docroute')

const hasLimit = /超过单次上限|maximum context length|截断后发送|压缩上下文并继续/.test(snap?.tail || '')
console.log(hasLimit ? 'FAIL：仍然出现了超限提示' : 'OK=true：6 万字直接发送成功，没有超限提示')

// 清理测试会话
try {
  const ids = await evaluate(`(async function(){
    var MARK = ${JSON.stringify(MARK)}
    var db = await new Promise(function(resolve, reject){ var r=indexedDB.open('chat-demo'); r.onsuccess=function(){resolve(r.result)}; r.onerror=function(){reject(r.error)} })
    var sessions = await new Promise(function(resolve){ var tx=db.transaction('sessions','readonly'); var r=tx.objectStore('sessions').getAll(); r.onsuccess=function(){resolve(r.result||[])}; r.onerror=function(){resolve([])} })
    var ids = sessions.filter(function(s){ try { return JSON.stringify(s).indexOf(MARK)!==-1 } catch(e){ return false } }).map(function(s){return s.id})
    if (ids.length) { await new Promise(function(resolve){ var tx=db.transaction(['sessions','sessionSummaries'],'readwrite'); ids.forEach(function(id){tx.objectStore('sessions').delete(id); tx.objectStore('sessionSummaries').delete(id)}); tx.oncomplete=resolve; tx.onerror=resolve }) }
    try { db.close() } catch(e) {}
    return ids
  })()`)
  console.log('已清理测试会话：', JSON.stringify(ids))
} catch {}
if (providerChanged) {
  try {
    await evaluate(`window.chatDisplayPrefs.save('provider', ${JSON.stringify(originalProvider)})`)
    console.log('已还原 provider=' + originalProvider)
    await evaluate('location.reload()').catch(() => {})
  } catch {}
}
ws.close()
