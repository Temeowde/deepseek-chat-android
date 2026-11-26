/**
 * 真机导入 ZIP 测试：把 sample-one-session.zip（1879 条消息、273 张长截图）
 * 通过 WebView 的 file input 直接喂给 App 的"导入历史对话"，不经过系统文件选择器。
 * 运行：$env:ADB='...'; node tools/import-zip-probe.mjs
 */
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB ?? 'adb'
const PORT = Number(process.env.CDP_PORT ?? 9345)
const PKG = 'com.temeowde.dschat'
const ZIP = process.env.ZIP_PATH ?? '/sdcard/Download/sample-one-session.zip'

const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8', timeout: 120000 }).trim()
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
const evaluate = async (expression, byValue = true) => {
  const res = await call('Runtime.evaluate', { expression, returnByValue: byValue, awaitPromise: true })
  const details = res.result?.exceptionDetails
  if (details) throw new Error('page exception: ' + (details.exception?.description || details.text))
  return byValue ? res.result?.result?.value : res.result
}
const waitFor = async (expression, timeout, label) => {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try {
      last = await evaluate(expression)
    } catch (error) {
      last = String(error.message)
    }
    if (last) return last
    await sleep(500)
  }
  throw new Error('等待超时：' + label + '（' + JSON.stringify(last) + '）')
}

await evaluate('location.reload()').catch(() => {})
await sleep(2000)
await waitFor(`!!document.querySelector('[data-chat-composer] textarea')`, 30000, '页面加载')

// 打开设置 → 数据管理
const clickText = async (text) =>
  evaluate(`(function(){
    var want = ${JSON.stringify(text)}
    var nodes = [...document.querySelectorAll('*')].filter(function(el){ return el.children.length === 0 && (el.textContent||'').trim() === want })
    var el = nodes[0]
    if (!el) return { ok: false }
    ;(el.closest('button, [role="button"], a, li, div') || el).click()
    return { ok: true }
  })()`)
let opened = await clickText('数据管理')
if (!opened?.ok) {
  const settings = await evaluate(`(function(){
    var b = [...document.querySelectorAll('button')].find(function(x){ return (x.getAttribute('aria-label')||'') === '设置' })
    if (b) b.click()
    return !!b
  })()`)
  console.log('打开设置：' + settings)
  await sleep(1200)
  opened = await clickText('数据管理')
}
console.log('打开数据管理：', JSON.stringify(opened))
if (!opened?.ok) throw new Error('找不到数据管理入口')
await sleep(1200)
await waitFor(`document.body.textContent.indexOf('导入历史对话') !== -1`, 15000, '数据管理页')

// 列出 file input
const inputs = await evaluate(`(function(){
  return [...document.querySelectorAll('input[type=file]')].map(function(el, i){
    return { i: i, accept: el.accept || '', hidden: el.hidden, disabled: el.disabled,
             parent: (el.closest('button, [role="button"], label') || el.parentElement || {}).textContent ? (el.closest('button, [role="button"], label') || el.parentElement).textContent.trim().slice(0,40) : '' }
  })
})()`)
console.log('file inputs：', JSON.stringify(inputs))
if (!inputs || inputs.length === 0) throw new Error('页面里没有 file input，需要改走系统文件选择器')

// 选择最像"导入 zip"的 input（accept 含 zip 或 .zip）
const index = inputs.findIndex((item) => item.accept.includes('zip')) >= 0
  ? inputs.findIndex((item) => item.accept.includes('zip'))
  : 0
const objectId = await evaluate(`document.querySelectorAll('input[type=file]')[${index}]`, false)
const objectIdValue = objectId?.result?.objectId
if (!objectIdValue) throw new Error('拿不到 file input 的 objectId')
await call('DOM.setFileInputFiles', { files: [ZIP], objectId: objectIdValue })
console.log('已把 ZIP 设置到 input，等待确认框…')
const fileInfo = await evaluate(`(function(){
  var el = document.querySelectorAll('input[type=file]')[${index}]
  var f = el && el.files && el.files[0]
  return f ? { name: f.name, size: f.size, type: f.type, lastModified: f.lastModified } : null
})()`)
console.log('选中的文件：', JSON.stringify(fileInfo))
if (process.env.ONLY_SET === '1') {
  await evaluate('location.reload()').catch(() => {})
  ws.close()
  process.exit(0)
}
if (process.env.PICKER === '1') {
  // Android WebView 里 CDP 注入无效：改为点击 input 打开系统文件选择器，再交给 adb/uiautomator
  await evaluate(`document.querySelectorAll('input[type=file]')[${index}].click()`)
  console.log('已打开系统文件选择器')
  ws.close()
  process.exit(0)
}

// 出现"确认导入历史对话？"后选「合并到本地历史」
await sleep(1500)
const hasDialog = await evaluate(`document.body.textContent.indexOf('确认导入历史对话') !== -1`).catch(() => false)
console.log('确认框：' + hasDialog)
if (hasDialog) {
  const dialogButtons = await evaluate(`[...document.querySelectorAll('button')].map(function(b){return (b.textContent||'').trim()}).filter(function(t){return t && (t.indexOf('合并')!==-1||t.indexOf('覆盖')!==-1||t.indexOf('取消')!==-1||t.indexOf('确认')!==-1||t.indexOf('导入')!==-1)})`)
  console.log('确认框按钮：', JSON.stringify(dialogButtons))
  const pickMerge = await evaluate(`(function(){
    var nodes = [...document.querySelectorAll('button, [role="button"], label')].filter(function(el){ return (el.textContent||'').trim().indexOf('合并到本地历史') !== -1 })
    var el = nodes[0]
    if (!el) return { ok: false }
    el.click()
    return { ok: true, tag: el.tagName, text: (el.textContent||'').trim().slice(0,20) }
  })()`)
  console.log('选择合并：', JSON.stringify(pickMerge))
  await sleep(500)
  const confirm = await evaluate(`(function(){
    var nodes = [...document.querySelectorAll('button')].filter(function(el){ return (el.textContent||'').trim() === '确认导入' })
    var el = nodes[0]
    if (!el) return { ok: false }
    el.click()
    return { ok: true }
  })()`)
  console.log('点击确认导入：', JSON.stringify(confirm))
}
await sleep(1000)

// 轮询导入结果
const started = Date.now()
let lastText = ''
let done = false
while (Date.now() - started < 900000) {
  const state = await evaluate(`(function(){
    var text = document.body.textContent || ''
    return {
      importing: /导入中|正在导入|读取中|解压|解析/.test(text),
      dialogGone: text.indexOf('确认导入历史对话') === -1,
      done: /导入完成|已导入|导入成功/.test(text),
      failed: /导入失败|无法导入|文件格式/.test(text),
      tail: text.slice(-300)
    }
  })()`).catch(() => null)
  if (state) {
    if (state.tail !== lastText) {
      lastText = state.tail
      console.log('…', String(state.tail).replaceAll('\n', ' ').slice(-200))
    }
    if (state.failed) {
      console.log('导入失败')
      break
    }
    if (state.done || (state.dialogGone && !state.importing && Date.now() - started > 10000)) {
      done = true
      break
    }
  }
  await sleep(3000)
}
console.log('导入结束（' + Math.round((Date.now() - started) / 1000) + 's，done=' + done + '）')
await evaluate('location.reload()').catch(() => {})
ws.close()
