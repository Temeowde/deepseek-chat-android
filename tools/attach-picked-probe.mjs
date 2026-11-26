/**
 * 真机验证附件面板勾选状态：
 * 打开 + 面板，选中两张"最近照片"→ 发送 → 再打开面板应无勾选，且能再次点选同一张。
 * 运行：$env:ADB='...'; node tools/attach-picked-probe.mjs
 */
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB ?? 'adb'
const PORT = Number(process.env.CDP_PORT ?? 9348)
const PKG = 'com.temeowde.dschat'
const MARK = 'PICK' + Date.now().toString(36).toUpperCase()
// 1x1 白色 JPEG data URL
const JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='

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
    }, 60000)
  })
await call('Runtime.enable').catch(() => {})
await call('Page.enable').catch(() => {})
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
    last = await evaluate(expression).catch((error) => String(error.message))
    if (last) return last
    await sleep(300)
  }
  throw new Error('等待超时：' + label + '（' + JSON.stringify(last) + '）')
}

// 每次新文档注入：写最近照片缓存（3 张假图）
await call('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { localStorage.setItem('ds.attach.recent.v1', JSON.stringify({ granted: true, items: [
    { id: 'fake-1', thumb: ${JSON.stringify(JPEG)} },
    { id: 'fake-2', thumb: ${JSON.stringify(JPEG)} },
    { id: 'fake-3', thumb: ${JSON.stringify(JPEG)} }
  ] })) } catch (e) {}`,
})
await evaluate('location.reload()').catch(() => {})
await sleep(2000)
await waitFor(`!!document.querySelector('[data-chat-composer] textarea')`, 30000, '页面加载')

// 原生桥替换：点照片时直接返回 data URL；recentMediaList 不覆盖缓存
await evaluate(`(function(){
  var bridge = window.DeepSeekAndroid
  if (!bridge) return false
  bridge.recentMediaList = function(){}
  bridge.recentMediaData = function(id){
    setTimeout(function(){ window.dsRecentMediaData && window.dsRecentMediaData(id, ${JSON.stringify(JPEG)}) }, 20)
  }
  return true
})()`)

const toggle = await evaluate(`(function(){
  var b = document.querySelector('.ds-attach-toggle')
  if (!b) return false
  b.click()
  return true
})()`)
if (!toggle) throw new Error('找不到 + 按钮')
await waitFor(`document.querySelector('.ds-attach-slot[data-open="true"]')`, 10000, '面板展开')
await waitFor(`document.querySelectorAll('.ds-attach-recent-item').length >= 2`, 10000, '最近照片渲染')
const itemCount = await evaluate(`document.querySelectorAll('.ds-attach-recent-item').length`)
console.log('最近照片数量：' + itemCount)

// 点选前两张
await evaluate(`(function(){
  var items = document.querySelectorAll('.ds-attach-recent-item')
  items[0].click(); items[1].click()
})()`)
await sleep(1500)
const pickedAfterSelect = await evaluate(`document.querySelectorAll('.ds-attach-recent-item[data-picked="true"]').length`)
console.log('选中后勾选数：' + pickedAfterSelect)
if (pickedAfterSelect !== 2) throw new Error('选中状态不符合预期')

// 输入文字并发送
await evaluate('window.__probeText = ' + JSON.stringify('附件勾选测试 ' + MARK))
await evaluate(`(function(){
  var t = document.querySelector('[data-chat-composer] textarea')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t, window.__probeText)
  t.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(1500)
const sendClicked = await evaluate(`(function(){
  var scope = document.querySelector('[data-chat-composer]') || document
  var b = [...scope.querySelectorAll('button')].find(function(x){return (x.getAttribute('aria-label')||'')==='发送'})
  if (!b || b.getAttribute('aria-disabled') === 'true') return { ok: false, disabled: true }
  b.click()
  return { ok: true }
})()`)
console.log('点击发送：' + JSON.stringify(sendClicked))
if (!sendClicked?.ok) throw new Error('发送按钮不可用（附件可能没上传成功）')
await waitFor(`document.querySelectorAll('[data-chat-role="user"]').length > 0 || document.body.textContent.indexOf(${JSON.stringify(MARK)}) !== -1`, 30000, '消息已发送')

// 重新打开面板，检查勾选是否清空
await sleep(800)
const reopened = await evaluate(`(function(){
  var slot = document.querySelector('.ds-attach-slot')
  if (slot && slot.getAttribute('data-open') === 'true') return true
  var b = document.querySelector('.ds-attach-toggle')
  if (!b) return false
  b.click()
  return true
})()`)
if (reopened) {
  await sleep(800)
}
const pickedAfterSend = await evaluate(`document.querySelectorAll('.ds-attach-recent-item[data-picked="true"]').length`)
console.log('发送后勾选数：' + pickedAfterSend)
const reselect = await evaluate(`(function(){
  var items = document.querySelectorAll('.ds-attach-recent-item')
  if (!items.length) return null
  items[0].click()
  return true
})()`)
await sleep(800)
const pickedAfterReselect = await evaluate(`document.querySelectorAll('.ds-attach-recent-item[data-picked="true"]').length`)
console.log('再次点击同一张后勾选数：' + pickedAfterReselect)
console.log(pickedAfterSend === 0 ? 'PASS：发送后勾选已清空' : 'FAIL：发送后仍有勾选 ' + pickedAfterSend)
console.log(reselect && pickedAfterReselect === 1 ? 'PASS：同一张照片可以再次选中' : 'FAIL：同一张照片无法再次选中')

ws.close()
