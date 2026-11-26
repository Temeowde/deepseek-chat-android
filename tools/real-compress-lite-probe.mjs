/**
 * 真实压缩链路探测（低成本版）：
 * 注入一个 24 轮的合成会话，并在末尾放一条"上下文超限"的失败回复，
 * 打开会话 → 点「压缩上下文并继续」→ 真实摘要调用 → 真实自动重发 → 验证能继续回答。
 *
 * 运行：$env:ADB='D:\AndroidToolchain\sdk\platform-tools\adb.exe'; $env:E2E_SET_PROVIDER='1'; node tools/real-compress-lite-probe.mjs
 * 注意：会真实调用 API（约 3 万 tokens，费用很小），不构造 100 万 token 历史。
 */
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB ?? 'adb'
const PORT = Number(process.env.CDP_PORT ?? 9338)
const PKG = 'com.temeowde.dschat'
const MARK = 'CMPLITE' + Date.now().toString(36).toUpperCase()
const ROUNDS = Number(process.env.ROUNDS ?? 24)

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
    }, 300000)
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
  console.log('已临时切换 provider=deepseek，结束后还原 ' + originalProvider)
}
if (!(env.keyLen > 0)) throw new Error('没有 API Key')

console.log('\n注入合成会话（' + ROUNDS + ' 轮 + 一条上下文超限的失败回复）…')
const injected = await evaluate(`(async function(){
  var MARK = ${JSON.stringify(MARK)}
  var ROUNDS = ${ROUNDS}
  function openDb() { return new Promise(function(resolve, reject){ var r=indexedDB.open('chat-demo'); r.onsuccess=function(){resolve(r.result)}; r.onerror=function(){reject(r.error)} }) }
  var db = await openDb()
  var sessions = await new Promise(function(resolve){ var tx=db.transaction('sessions','readonly'); var r=tx.objectStore('sessions').getAll(); r.onsuccess=function(){resolve(r.result||[])}; r.onerror=function(){resolve([])} })
  var old = sessions.filter(function(s){ return (s.title||'').indexOf('SYNTH-CMP')===0 }).map(function(s){return s.id})
  if (old.length) { await new Promise(function(resolve){ var tx=db.transaction(['sessions','sessionSummaries'],'readwrite'); old.forEach(function(id){tx.objectStore('sessions').delete(id); tx.objectStore('sessionSummaries').delete(id)}); tx.oncomplete=resolve; tx.onerror=resolve }) }
  var id = 'synth-cmp-' + Date.now()
  var title = 'SYNTH-CMP 压缩测试 ' + MARK
  var t0 = Date.now() - ROUNDS * 60000
  var messages = []
  var filler = '蓝鲸项目第R轮：负责人第I组，预算I00元，截止2026年12月，风险是备份和权限，结论先做最小版本。'
  function content(r) {
    var parts = []; var n = 1
    while (parts.join('').length < 1500) { parts.push(filler.split('R').join(String(r)).split('I').join(String(n))); n += 1 }
    return ('第' + r + '轮长文本（' + MARK + '）：' + parts.join('')).slice(0, 1500)
  }
  for (var r = 0; r < ROUNDS; r++) {
    var qid = id + '-u' + r, aid = id + '-a' + r
    var nextQ = r + 1 < ROUNDS ? id + '-u' + (r + 1) : id + '-u-' + ROUNDS
    messages.push({ id: qid, role: 'user', createdAt: t0 + r * 120000, content: content(r), files: [], parentId: r === 0 ? null : id + '-a' + (r - 1), selectedChildId: aid })
    messages.push({ id: aid, role: 'assistant', createdAt: t0 + r * 120000 + 60000, model: 'deepseek-flash', thinking: false, search: false, prefix: true, status: 'done', blocks: [{ type: 'text', text: '收到第' + r + '轮，继续保持。' }], parentId: qid, selectedChildId: nextQ })
  }
  var failQid = id + '-u-' + ROUNDS
  var failAid = id + '-a-' + ROUNDS
  messages.push({ id: failQid, role: 'user', createdAt: t0 + ROUNDS * 120000, content: '（上下文测试）请只回复两个字：收到' + MARK, files: [], parentId: id + '-a-' + (ROUNDS - 1), selectedChildId: failAid })
  messages.push({ id: failAid, role: 'assistant', createdAt: t0 + ROUNDS * 120000 + 30000, model: 'deepseek-flash', thinking: false, search: false, prefix: true, status: 'error', blocks: [], parentId: failQid, selectedChildId: null,
    error: { kind: 'http', status: 400, message: "This model's maximum context length is 32768 tokens. However, your messages resulted in 40000 tokens.", overflow: 'history', questionTokens: 24 } })
  var session = { id: id, title: title, createdAt: t0, updatedAt: Date.now(), messages: messages, rootMessageId: messages[0].id }
  var summary = { id: id, title: title, pinned: false, createdAt: t0, updatedAt: Date.now(), fileIds: [] }
  await new Promise(function(resolve, reject){ var tx=db.transaction(['sessions','sessionSummaries'],'readwrite'); tx.objectStore('sessions').put(session); tx.objectStore('sessionSummaries').put(summary); tx.oncomplete=resolve; tx.onerror=function(){reject(tx.error)} })
  try { db.close() } catch(e) {}
  return { id: id, title: title, messages: messages.length, chars: messages.reduce(function(s,m){ return s + (m.content ? m.content.length : 0) }, 0) }
})()`)
console.log('已注入：', JSON.stringify(injected))

await evaluate('location.reload()').catch(() => {})
await sleep(2000)
await waitFor(`!!document.querySelector('[data-chat-composer] textarea')`, 30000, '重载')
// 打开侧边栏并进入合成会话
await evaluate(`(function(){
  var b = [...document.querySelectorAll('button')].find(function(x){ var t=(x.getAttribute('aria-label')||'')+' '+(x.title||''); return /菜单|边栏|历史|对话|menu|sidebar|history/i.test(t) })
  if (b) b.click()
  return !!b
})()`)
await sleep(800)
const clicked = await evaluate(`(function(){
  var nodes = [...document.querySelectorAll('*')].filter(function(el){ return el.children.length === 0 && (el.textContent||'').indexOf('SYNTH-CMP') !== -1 })
  var el = nodes[0]
  if (!el) return { ok: false }
  ;(el.closest('button, [role="button"], a, li, div') || el).click()
  return { ok: true }
})()`)
if (!clicked?.ok) throw new Error('没能打开合成会话')
await sleep(1500)
await waitFor(`document.querySelectorAll('[data-chat-role="user"]').length >= 5`, 20000, '会话渲染')

const buttonsBefore = await evaluate(`[...document.querySelectorAll('[data-chat-role="assistant"] button')].map(function(b){return (b.textContent||'').trim()}).filter(Boolean)`)
console.log('会话已打开，按钮：', JSON.stringify(buttonsBefore))
if (!buttonsBefore.some((b) => b.includes('压缩上下文并继续'))) throw new Error('没有出现压缩按钮')
screencap('cmplite_before')

console.log('\n点击「压缩上下文并继续」（真实摘要）…')
await evaluate(`(function(){
  var list = [...document.querySelectorAll('[data-chat-role="assistant"] button')]
  var b = list.find(function(x){return (x.textContent||'').trim().indexOf('压缩上下文并继续')!==-1})
  if (b) b.click()
  return !!b
})()`)
const started = Date.now()
let done = null
while (Date.now() - started < 300000) {
  const snap = await evaluate(`(function(){
    var list = [...document.querySelectorAll('[data-chat-role="assistant"]')]
    var last = list.length ? (list[list.length-1].textContent||'') : ''
    var buttons = [...document.querySelectorAll('[data-chat-role="assistant"] button')].map(function(b){return (b.textContent||'').trim()}).filter(Boolean)
    return { count: list.length, textLen: last.length, tail: last.slice(-240), buttons: buttons,
             streaming: !!document.querySelector('[aria-label="停止生成"], [aria-label="Stop"]') }
  })()`)
  if (!snap.streaming && snap.buttons.length === 0 && snap.textLen > 0) {
    done = snap
    break
  }
  if (/压缩失败|无法|太少|装不下|再点一次/.test(snap.tail)) {
    done = snap
    break
  }
  await sleep(1500)
}
console.log('结果（约 ' + Math.round((Date.now() - started) / 1000) + 's）：', JSON.stringify(done, null, 2))
screencap('cmplite_after')
const memory = await evaluate(`(function(){
  try {
    var keys = Object.keys(localStorage).filter(function(k){return k.indexOf('ds.chat-context-memory.v1:')===0})
    var hit = keys.filter(function(k){ return (localStorage.getItem(k)||'').indexOf(${JSON.stringify(MARK)}) !== -1 })
    return hit.map(function(k){ return JSON.parse(localStorage.getItem(k)) })
  } catch(e) { return [] }
})()`)
console.log('记忆记录：', JSON.stringify(memory))
console.log(done && done.textLen > 0 ? 'OK=true（压缩后已有新回答）' : 'WARN=没有拿到新回答')

// 清理
try {
  const ids = await evaluate(`(async function(){
    var db = await new Promise(function(resolve, reject){ var r=indexedDB.open('chat-demo'); r.onsuccess=function(){resolve(r.result)}; r.onerror=function(){reject(r.error)} })
    var sessions = await new Promise(function(resolve){ var tx=db.transaction('sessions','readonly'); var r=tx.objectStore('sessions').getAll(); r.onsuccess=function(){resolve(r.result||[])}; r.onerror=function(){resolve([])} })
    var ids = sessions.filter(function(s){ return (s.title||'').indexOf('SYNTH-CMP')===0 }).map(function(s){return s.id})
    if (ids.length) { await new Promise(function(resolve){ var tx=db.transaction(['sessions','sessionSummaries'],'readwrite'); ids.forEach(function(id){tx.objectStore('sessions').delete(id); tx.objectStore('sessionSummaries').delete(id)}); tx.oncomplete=resolve; tx.onerror=resolve }) }
    try { db.close() } catch(e) {}
    try { Object.keys(localStorage).filter(function(k){return k.indexOf('ds.chat-context-memory.v1:')===0}).forEach(function(k){ if (ids.some(function(id){return k.indexOf(id)!==-1})) localStorage.removeItem(k) }) } catch(e) {}
    return ids
  })()`)
  console.log('已清理：', JSON.stringify(ids))
} catch {}
if (providerChanged) {
  try {
    await evaluate(`window.chatDisplayPrefs.save('provider', ${JSON.stringify(originalProvider)})`)
    console.log('已还原 provider=' + originalProvider)
    await evaluate('location.reload()').catch(() => {})
  } catch {}
}
ws.close()
