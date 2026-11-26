/**
 * 真实接口探测：用真机 + 真 API 发一条 6 万字消息，观察真实报错与按钮行为。
 * 运行：$env:ADB='D:\AndroidToolchain\sdk\platform-tools\adb.exe'; node tools/real-limit-probe.mjs
 * 注意：会真实调用 API（消耗少量 token）。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const ADB = process.env.ADB ?? 'adb'
const PORT = Number(process.env.CDP_PORT ?? 9334)
const PKG = 'com.temeowde.dschat'
const TEXT_FILE = process.env.PROBE_FILE ?? String.raw`C:\Users\zzzy\Desktop\DSCHAT-HANDOFF\测试文件\长文测试-复制粘贴用-6万字.txt`
const MARK = 'REALPROBE' + Date.now().toString(36).toUpperCase()

const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8', timeout: 60000 }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pids = adb('shell', 'pidof', PKG)
if (!pids) throw new Error('App 未运行')
const pid = pids.split(/\s+/)[0]
adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`)
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const target = targets.find((t) => /android_asset\/chat\/index\.html/.test(t.url || ''))
if (!target) throw new Error('没找到 chat WebView: ' + JSON.stringify(targets.map((t) => t.url)))

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
    await sleep(300)
  }
  throw new Error('等待超时：' + label + '（' + JSON.stringify(last) + '）')
}

const env = await evaluate(`(function(){
  var prefs = window.chatDisplayPrefs
  return { version: (document.querySelector('meta[name="application-version"]')||{}).content||'',
           provider: prefs ? prefs.read('provider','deepseek') : '(none)',
           keyLen: (function(){try{return String((window.DeepSeekAndroid&&window.DeepSeekAndroid.getApiKey&&window.DeepSeekAndroid.getApiKey())||'').length}catch(e){return -1}})(),
           composer: !!document.querySelector('[data-chat-composer] textarea') }
})()`)
console.log('环境：', JSON.stringify(env))
if (!env.composer) throw new Error('输入框没渲染')
if (env.provider !== 'deepseek') throw new Error('当前 provider=' + env.provider + '，请切到 DeepSeek 官方通道再测')
if (!(env.keyLen > 0)) throw new Error('没有 API Key')

// 新对话（避免历史影响），并确认清空
await evaluate(`(function(){
  var buttons = [...document.querySelectorAll('button')]
  var b = buttons.find(function(x){return (x.getAttribute('aria-label')||'')==='开启新对话'})
  if (!b) b = buttons.find(function(x){return (x.textContent||'').trim()==='开启新对话'})
  if (b) b.click()
  return !!b
})()`)
await sleep(1200)
await waitFor(`document.querySelectorAll('[data-chat-role="user"]').length === 0`, 10000, '新对话清空')

const probeText = readFileSync(TEXT_FILE, 'utf8').slice(0, 60000) + '\n\n' + MARK
console.log('准备发送：', probeText.length, '字符（文件 ' + TEXT_FILE + '）')
await evaluate('window.__probeText = ' + JSON.stringify(probeText))
await evaluate(`(function(){
  var t = document.querySelector('[data-chat-composer] textarea')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t, window.__probeText)
  t.dispatchEvent(new Event('input', { bubbles: true }))
  return t.value.length
})()`)
await sleep(500)
await evaluate(`(function(){
  var scope = document.querySelector('[data-chat-composer]') || document
  var b = [...scope.querySelectorAll('button')].find(function(x){return (x.getAttribute('aria-label')||'')==='发送'})
  if (b) b.click()
  return !!b
})()`)
console.log('已点击发送，等待真实接口结果…')

const started = Date.now()
let snapshot = null
let stableCount = 0
while (Date.now() - started < 240000) {
  snapshot = await evaluate(`(function(){
    var list = [...document.querySelectorAll('[data-chat-role="assistant"]')]
    var last = list.length ? (list[list.length-1].textContent||'') : ''
    var buttons = [...document.querySelectorAll('[data-chat-role="assistant"] button')].map(function(b){return (b.textContent||'').trim()}).filter(Boolean)
    return {
      assistantCount: list.length,
      textLen: last.length,
      tail: last.slice(-240),
      buttons: buttons,
      streaming: !!document.querySelector('[aria-label="停止生成"], [aria-label="Stop"]')
    }
  })()`)
  if (snapshot.textLen > 0 && !snapshot.streaming) {
    stableCount += 1
    if (stableCount >= 3) break
  } else {
    stableCount = 0
  }
  await sleep(1200)
}
console.log('发送后耗时约', Math.round((Date.now() - started) / 1000), '秒')
console.log('首次结果：', JSON.stringify(snapshot, null, 2))

const hasTrim = snapshot.buttons.some((b) => b.includes('截断后发送') || b.includes('Trim'))
const hasCompress = snapshot.buttons.some((b) => b.includes('压缩上下文并继续') || b.includes('Compress'))

if (hasTrim || hasCompress) {
  try {
    adb('shell', 'screencap', '-p', '/sdcard/realprobe_button.png')
    adb('pull', '/sdcard/realprobe_button.png', String.raw`C:\Users\zzzy\AppData\Local\Temp\dschat-work\realprobe_button.png`)
    console.log('按钮状态截图：C:\\Users\\zzzy\\AppData\\Local\\Temp\\dschat-work\\realprobe_button.png')
  } catch {}
  console.log('\n>> 出现超限按钮，点击它继续观察…')
  await evaluate(`(function(){
    var label = ${JSON.stringify(hasTrim ? '截断后发送' : '压缩上下文并继续')}
    var list = [...document.querySelectorAll('[data-chat-role="assistant"] button')]
    var b = list.find(function(x){return (x.textContent||'').trim().indexOf(label)!==-1})
    if (b) b.click()
    return !!b
  })()`)
  const t2 = Date.now()
  let after = null
  let stable = 0
  while (Date.now() - t2 < 240000) {
    after = await evaluate(`(function(){
      var list = [...document.querySelectorAll('[data-chat-role="assistant"]')]
      var last = list.length ? (list[list.length-1].textContent||'') : ''
      return { assistantCount: list.length, textLen: last.length, tail: last.slice(-240),
               streaming: !!document.querySelector('[aria-label="停止生成"], [aria-label="Stop"]') }
    })()`)
    if (after.textLen > 0 && !after.streaming) {
      stable += 1
      if (stable >= 3) break
    } else stable = 0
    await sleep(1200)
  }
  console.log('点击后结果（约', Math.round((Date.now() - t2) / 1000), '秒）：', JSON.stringify(after, null, 2))
  console.log('OK=true')
}

try {
  adb('shell', 'screencap', '-p', '/sdcard/realprobe.png')
  adb('pull', '/sdcard/realprobe.png', String.raw`C:\Users\zzzy\AppData\Local\Temp\dschat-work\realprobe.png`)
  console.log('截图已保存：C:\\Users\\zzzy\\AppData\\Local\\Temp\\dschat-work\\realprobe.png')
} catch (error) {
  console.log('截图失败：' + error.message)
}

// 清理本次测试会话（消息里带 MARK）
try {
  await evaluate(`(async function(){
    var MARK = ${JSON.stringify(MARK)}
    var db = await new Promise(function(resolve, reject){ var r = indexedDB.open('chat-demo'); r.onsuccess=function(){resolve(r.result)}; r.onerror=function(){reject(r.error)} })
    var sessions = await new Promise(function(resolve){ var tx=db.transaction('sessions','readonly'); var r=tx.objectStore('sessions').getAll(); r.onsuccess=function(){resolve(r.result||[])}; r.onerror=function(){resolve([])} })
    var ids = sessions.filter(function(s){ try { return JSON.stringify(s).indexOf(MARK)!==-1 } catch(e){ return false } }).map(function(s){return s.id})
    if (ids.length) {
      await new Promise(function(resolve){ var tx=db.transaction(['sessions','sessionSummaries'],'readwrite'); ids.forEach(function(id){tx.objectStore('sessions').delete(id); tx.objectStore('sessionSummaries').delete(id)}); tx.oncomplete=resolve; tx.onerror=resolve })
    }
    try { db.close() } catch(e) {}
    return ids
  })()`).then((ids) => console.log('已删除测试会话：', JSON.stringify(ids)))
} catch (error) {
  console.log('清理失败（可手动删）：' + error.message)
}
ws.close()
