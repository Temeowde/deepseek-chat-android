/**
 * 真实"上下文聊满 → 继续聊"探测：
 * 在 App 的 IndexedDB 里注入一个约 105 万 tokens 的合成会话（不花钱），打开后发一条短消息，
 * 让真实接口返回"上下文超限"，观察「压缩上下文并继续」→ 点击 → 真实摘要 → 自动重发 → 继续聊天。
 *
 * 运行：$env:ADB='D:\AndroidToolchain\sdk\platform-tools\adb.exe'; node tools/real-context-full-probe.mjs
 * 注意：会真实调用 API（失败请求 + 10 次摘要 + 约 100 万 tokens 的重发请求，费用约 ¥1–4）。
 */
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB ?? 'adb'
const PORT = Number(process.env.CDP_PORT ?? 9336)
const PKG = 'com.temeowde.dschat'
const ROUNDS = Number(process.env.ROUNDS ?? 85)
const USER_CHARS = Number(process.env.USER_CHARS ?? 20000)
const MARK = 'CTXFULL' + Date.now().toString(36).toUpperCase()

const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8', timeout: 60000 }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const screencap = (name) => {
  try {
    adb('shell', 'screencap', '-p', `/sdcard/${name}.png`)
    adb('pull', `/sdcard/${name}.png`, String.raw`C:\Users\zzzy\AppData\Local\Temp\dschat-work\${name}.png`)
    console.log('截图：C:\\Users\\zzzy\\AppData\\Local\\Temp\\dschat-work\\' + name + '.png')
  } catch (error) {
    console.log('截图失败：' + error.message)
  }
}

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
const state = () =>
  evaluate(`(function(){
    var list = [...document.querySelectorAll('[data-chat-role="assistant"]')]
    var last = list.length ? (list[list.length-1].textContent||'') : ''
    var buttons = [...document.querySelectorAll('[data-chat-role="assistant"] button')].map(function(b){return (b.textContent||'').trim()}).filter(Boolean)
    return {
      assistantCount: list.length,
      userCount: document.querySelectorAll('[data-chat-role="user"]').length,
      textLen: last.length,
      tail: last.slice(-300),
      buttons: buttons,
      streaming: !!document.querySelector('[aria-label="停止生成"], [aria-label="Stop"]')
    }
  })()`)

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
  if (process.env.E2E_SET_PROVIDER !== '1') {
    throw new Error('provider 必须是 deepseek，当前 ' + env.provider + '（可加 E2E_SET_PROVIDER=1 自动切换并在结束后还原）')
  }
  await evaluate(`window.chatDisplayPrefs.save('provider', 'deepseek')`)
  providerChanged = true
  await evaluate('location.reload()').catch(() => {})
  await sleep(2000)
  await waitFor(`!!document.querySelector('[data-chat-composer] textarea')`, 30000, '切换 provider 后重载')
  env = await readEnv()
  console.log('已临时切换 provider=deepseek，结束后还原为 ' + originalProvider + '；当前：' + JSON.stringify(env))
}
if (env.provider !== 'deepseek') throw new Error('provider 必须是 deepseek，当前 ' + env.provider)
if (!(env.keyLen > 0)) throw new Error('没有 API Key')

console.log('\n注入合成会话（' + ROUNDS + ' 轮 × 约 ' + USER_CHARS + ' 字用户消息）…')
const injected = await evaluate(`(async function(){
  var MARK = ${JSON.stringify(MARK)}
  var ROUNDS = ${ROUNDS}
  var USER_CHARS = ${USER_CHARS}
  function openDb() {
    return new Promise(function(resolve, reject) {
      var r = indexedDB.open('chat-demo')
      r.onsuccess = function(){ resolve(r.result) }
      r.onerror = function(){ reject(r.error) }
    })
  }
  var db = await openDb()
  var sessions = await new Promise(function(resolve){ var tx=db.transaction('sessions','readonly'); var r=tx.objectStore('sessions').getAll(); r.onsuccess=function(){resolve(r.result||[])}; r.onerror=function(){resolve([])} })
  var old = sessions.filter(function(s){ return s.title && s.title.indexOf('SYNTH-CTX') === 0 }).map(function(s){ return s.id })
  if (old.length) {
    await new Promise(function(resolve){ var tx=db.transaction(['sessions','sessionSummaries'],'readwrite'); old.forEach(function(id){ tx.objectStore('sessions').delete(id); tx.objectStore('sessionSummaries').delete(id) }); tx.oncomplete=resolve; tx.onerror=resolve })
  }
  var id = 'synth-' + Date.now()
  var title = 'SYNTH-CTX 上下文测试 ' + MARK
  var t0 = Date.now() - ROUNDS * 120000
  var messages = []
  var totalChars = 0
  var sentence = '蓝鲸项目第R轮第I段：负责人第I组，预算I00元，截止2026年12月，风险是数据备份、权限控制、交付验收，结论是先完成最小可用版本再补充细节。'
  for (var r = 0; r < ROUNDS; r++) {
    var qid = id + '-u' + r
    var aid = id + '-a' + r
    var parts = []
    var n = 1
    while (parts.join('').length < USER_CHARS) {
      parts.push(sentence.split('R').join(String(r)).split('I').join(String(n)))
      n += 1
    }
    var content = '第' + r + '轮长文本（' + MARK + '）：' + parts.join('')
    content = content.slice(0, USER_CHARS)
    totalChars += content.length
    var nextQ = r + 1 < ROUNDS ? id + '-u' + (r + 1) : null
    messages.push({ id: qid, role: 'user', createdAt: t0 + r * 120000, content: content, files: [], parentId: r === 0 ? null : id + '-a' + (r - 1), selectedChildId: aid })
    messages.push({ id: aid, role: 'assistant', createdAt: t0 + r * 120000 + 60000, model: 'deepseek-flash', thinking: false, search: false, prefix: true, status: 'done', blocks: [{ type: 'text', text: '收到第' + r + '轮。' }], parentId: qid, selectedChildId: nextQ })
  }
  var session = { id: id, title: title, createdAt: t0, updatedAt: Date.now(), messages: messages, rootMessageId: messages[0].id }
  var summary = { id: id, title: title, pinned: false, createdAt: t0, updatedAt: Date.now(), fileIds: [] }
  await new Promise(function(resolve, reject) {
    var tx = db.transaction(['sessions','sessionSummaries'],'readwrite')
    tx.objectStore('sessions').put(session)
    tx.objectStore('sessionSummaries').put(summary)
    tx.oncomplete = resolve
    tx.onerror = function(){ reject(tx.error) }
  })
  try { db.close() } catch (e) {}
  return { id: id, title: title, messages: messages.length, chars: totalChars }
})()`)
console.log('已注入：', JSON.stringify(injected))

await evaluate('location.reload()').catch(() => {})
await sleep(2000)
await waitFor(`!!document.querySelector('[data-chat-composer] textarea')`, 30000, '页面重载')

// 打开侧边栏并点进合成会话
const opened = await evaluate(`(function(){
  var buttons = [...document.querySelectorAll('button')]
  var toggle = buttons.find(function(b){ var t=(b.getAttribute('aria-label')||'')+' '+(b.title||''); return /菜单|边栏|历史|对话|menu|sidebar|history/i.test(t) })
  if (toggle) toggle.click()
  return !!toggle
})()`)
console.log('打开侧边栏：' + opened)
await sleep(800)
const clicked = await evaluate(`(function(){
  var nodes = [...document.querySelectorAll('*')].filter(function(el){
    return el.children.length === 0 && (el.textContent||'').indexOf('SYNTH-CTX') !== -1
  })
  var el = nodes[0]
  if (!el) return { ok: false, reason: '找不到合成会话入口', labels: [...document.querySelectorAll('button')].map(function(b){return b.getAttribute('aria-label')}).filter(Boolean).slice(0,30) }
  var target = el.closest('button, [role="button"], a, li, div')
  if (target) target.click()
  return { ok: true, tag: target ? target.tagName : null }
})()`)
console.log('点击合成会话：' + JSON.stringify(clicked))
if (!clicked || !clicked.ok) throw new Error('没能打开合成会话')
await sleep(1500)
await waitFor(`document.querySelectorAll('[data-chat-role="user"]').length > 50`, 20000, '合成会话渲染')
console.log('会话已打开，用户消息数：' + (await evaluate(`document.querySelectorAll('[data-chat-role="user"]').length`)))

console.log('\n发送一条短消息，触发真实上下文超限…')
await evaluate('window.__probeText = ' + JSON.stringify('这是上下文测试，请只回复两个字：' + MARK))
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
let overflow = null
while (Date.now() - started < 360000) {
  const snap = await state()
  const limited = snap.buttons.some((b) => b.includes('压缩上下文并继续') || b.includes('截断后发送'))
  if (limited || /上下文|context length|超过单次上限/.test(snap.tail)) {
    overflow = snap
    break
  }
  await sleep(1500)
}
if (!overflow) throw new Error('360 秒内没有出现超限提示')
console.log('超限提示（约 ' + Math.round((Date.now() - started) / 1000) + 's）：', JSON.stringify(overflow, null, 2))
screencap('ctxfull_error')

const compress = overflow.buttons.some((b) => b.includes('压缩上下文并继续'))
if (!compress) {
  console.log('出现的是截断按钮而不是压缩按钮，分类可能不符合预期；结束。')
} else {
  console.log('\n点击「压缩上下文并继续」（真实摘要调用，需要一些时间）…')
  await evaluate(`(function(){
    var list = [...document.querySelectorAll('[data-chat-role="assistant"] button')]
    var b = list.find(function(x){return (x.textContent||'').trim().indexOf('压缩上下文并继续')!==-1})
    if (b) b.click()
    return !!b
  })()`)
  const t2 = Date.now()
  let done = null
  while (Date.now() - t2 < 900000) {
    const snap = await state()
    const stillButton = snap.buttons.some((b) => b.includes('压缩上下文并继续'))
    if (snap.textLen > 0 && !snap.streaming && !stillButton && snap.userCount > 0) {
      done = snap
      break
    }
    if (Date.now() - t2 > 30000 && /已压缩|压缩失败|再点一次|太少|装不下/.test(snap.tail)) {
      done = snap
      break
    }
    await sleep(2000)
  }
  console.log('压缩+重发结果（约 ' + Math.round((Date.now() - t2) / 1000) + 's）：', JSON.stringify(done, null, 2))
  screencap('ctxfull_after')
  if (done && /SHADOW|收到/.test(done.tail) && !done.buttons.some((b) => b.includes('压缩上下文并继续'))) {
    console.log('OK=true（压缩后已继续对话）')
  }
}

// 清理：合成会话 + 对应记忆
try {
  const ids = await evaluate(`(async function(){
    var MARK = ${JSON.stringify(MARK)}
    var db = await new Promise(function(resolve, reject){ var r=indexedDB.open('chat-demo'); r.onsuccess=function(){resolve(r.result)}; r.onerror=function(){reject(r.error)} })
    var sessions = await new Promise(function(resolve){ var tx=db.transaction('sessions','readonly'); var r=tx.objectStore('sessions').getAll(); r.onsuccess=function(){resolve(r.result||[])}; r.onerror=function(){resolve([])} })
    var ids = sessions.filter(function(s){ return (s.title||'').indexOf('SYNTH-CTX')===0 }).map(function(s){ return s.id })
    if (ids.length) {
      await new Promise(function(resolve){ var tx=db.transaction(['sessions','sessionSummaries'],'readwrite'); ids.forEach(function(id){tx.objectStore('sessions').delete(id); tx.objectStore('sessionSummaries').delete(id)}); tx.oncomplete=resolve; tx.onerror=resolve })
    }
    try { db.close() } catch(e) {}
    try { Object.keys(localStorage).filter(function(k){return k.indexOf('ds.chat-context-memory.v1:')===0}).forEach(function(k){ if(ids.some(function(id){return k.indexOf(id)!==-1})) localStorage.removeItem(k) }) } catch(e) {}
    return ids
  })()`)
  console.log('已清理合成会话：', JSON.stringify(ids))
} catch {}
if (providerChanged) {
  try {
    await evaluate(`window.chatDisplayPrefs.save('provider', ${JSON.stringify(originalProvider)})`)
    console.log('已还原 provider=' + originalProvider)
    await evaluate('location.reload()').catch(() => {})
  } catch {}
}
ws.close()
