#!/usr/bin/env node
/**
 * 上下文超限按钮：真机端到端模拟验证（不联网、不需要真实爆上下文）
 *
 * 原理：页面加载后替换 window.fetch，只拦截 POST /anthropic/v1/messages；
 *       用「mock 队列」回放 400 超限 / 摘要 SSE / 成功 SSE，从中断言真实发出的请求体。
 *       测试结束 reload 页面即恢复，不改 App 代码。
 *
 * 覆盖两个场景：
 *   A 历史太长 → 400 context length →「压缩上下文并继续」→ 摘要请求 → 记忆落库 → 自动重发（带摘要/跳过旧轮）→ 再发一条仍带摘要
 *   B 当前这条太大 → 400 user input too long →「截断后发送」→ 重发正文变短 + 截断标记
 *
 * 前置条件：
 *   1) 设备装的是含本功能的 debuggable 包（内含此功能、versionCode 高于设备现值）；
 *   2) provider=deepseek 且已有任意非空 API Key（不会真实联网；可用 E2E_SET_KEY=1 临时写入 mock key）；
 *   3) 设备解锁、App 在前台；CDP 端口由脚本自动 forward。
 *
 * 用法：
 *   node tools/verify-context-overflow.mjs
 * 环境变量：
 *   DEVICE=<serial>  CDP_PORT=9333  E2E_SET_PROVIDER=1  E2E_SET_KEY=1  E2E_SKIP_CLEANUP=1
 */
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB ?? 'adb'
const DEVICE = process.env.DEVICE ?? ''
const PORT = Number(process.env.CDP_PORT ?? 9333)
const PKG = 'com.temeowde.dschat'
const TAG = 'E2E' + Date.now().toString(36).toUpperCase()

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok })
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  → ' + detail : ''))
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const adb = (...args) => {
  const full = DEVICE ? ['-s', DEVICE, ...args] : args
  try {
    return execFileSync(ADB, full, { encoding: 'utf8', timeout: 60000 }).trim()
  } catch (error) {
    return String((error && error.stdout) || '').trim()
  }
}

// ---------- CDP 连接 ----------
const pids = adb('shell', 'pidof', PKG)
if (!pids) {
  console.error('App 未运行：adb shell monkey -p ' + PKG + ' -c android.intent.category.LAUNCHER 1')
  process.exit(2)
}
const appPid = pids.split(/\s+/)[0]
adb('forward', 'tcp:' + PORT, 'localabstract:webview_devtools_remote_' + appPid)
let targets = []
try {
  targets = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json()
} catch {
  console.error('CDP 连不上：包可能不是 debuggable，或 pid 已变（' + appPid + '）')
  process.exit(2)
}
const pages = targets.filter((item) => item.webSocketDebuggerUrl)
const target = pages.find((item) => /android_asset\/chat\/index\.html/.test(item.url || '')) || pages.find((item) => item.type === 'page')
if (!target) {
  console.error('没有可用 page：' + JSON.stringify(targets.map((item) => [item.type, item.url])))
  process.exit(2)
}
console.log('CDP target: ' + target.url)

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', () => reject(new Error('ws error')), { once: true })
})
let seq = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id && pending.has(message.id)) {
    const slot = pending.get(message.id)
    pending.delete(message.id)
    slot.resolve(message)
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
        reject(new Error('cdp timeout: ' + method))
      }
    }, 60000)
  })
await call('Runtime.enable').catch(() => {})
const evaluate = async (expression) => {
  const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const details = response.result && response.result.exceptionDetails
  if (details) throw new Error('page exception: ' + String((details.exception && details.exception.description) || details.text))
  return response.result && response.result.result ? response.result.result.value : undefined
}
const waitFor = async (expression, timeout, label) => {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try {
      last = await evaluate(expression)
      if (last) return last
    } catch (error) {
      last = String(error.message)
    }
    await sleep(150)
  }
  throw new Error('等待超时：' + label + '（最后值 ' + JSON.stringify(last) + '）')
}
const reload = async () => {
  try {
    await evaluate('location.reload()')
  } catch {
    // 连接会被重载打断
  }
  await sleep(1500)
  await waitFor('!!document.querySelector("[data-chat-composer] textarea")', 30000, '页面渲染输入框')
}

// ---------- 注入页面的 mock（被 toString() 送到页面执行） ----------
function pageMock(TAG) {
  var SIM = window.__e2e
  if (SIM && SIM.active) return { ok: false, reason: 'mock already active' }
  var SUMMARY_PREFIX = '【以下是本对话更早内容的摘要'
  var ACK_TEXT = '好的，我已了解之前对话的要点'
  var COMPRESS_SYS = 'You are a context-compression assistant'
  var isEn = String(document.documentElement.lang || '').indexOf('en') === 0
  var L = {
    send: isEn ? 'Send' : '发送',
    newChat: isEn ? 'New chat' : '开启新对话',
    compress: isEn ? 'Compress context & continue' : '压缩上下文并继续',
    trim: isEn ? 'Trim & send' : '截断后发送',
  }
  var S = (window.__e2e = {
    active: true,
    tag: TAG,
    queue: [],
    requests: [],
    errors: [],
    passthrough: [],
    memoryBaseline: [],
    L: L,
  })
  try {
    S.memoryBaseline = Object.keys(localStorage).filter(function (key) {
      return key.indexOf('ds.chat-context-memory.v1:') === 0
    })
  } catch (error) {}
  window.addEventListener('error', function (event) {
    S.errors.push('window.error: ' + String(event.message || ''))
  })

  function contentText(content) {
    if (typeof content === 'string') return content
    if (Object.prototype.toString.call(content) === '[object Array]') {
      return content
        .map(function (block) {
          return block && block.type === 'text' ? block.text || '' : '[' + (block && block.type) + ']'
        })
        .join('')
    }
    return ''
  }
  function compact(content) {
    var text = contentText(content)
    return {
      len: text.length,
      head: text.slice(0, 96),
      tail: text.slice(-64),
      text: text.length <= 2000 ? text : undefined,
      hasSummary: text.indexOf(SUMMARY_PREFIX) === 0,
    }
  }
  function compactMessages(messages) {
    return (messages || []).map(function (message) {
      if (message.role === 'user') {
        var item = compact(message.content)
        item.role = 'user'
        return item
      }
      if (message.role === 'assistant') {
        var raw = ''
        try {
          raw = JSON.stringify(message.content)
        } catch (error) {}
        return { role: 'assistant', json: raw.slice(0, 1500), hasAck: raw.indexOf(ACK_TEXT) !== -1 }
      }
      return { role: message.role || '?' }
    })
  }
  function sse(text, title) {
    var encoder = new TextEncoder()
    var stream = new ReadableStream({
      start: function (controller) {
        var emit = function (event) {
          controller.enqueue(encoder.encode('event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n'))
        }
        emit({ type: 'message_start', message: {} })
        emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
        emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text } })
        emit({ type: 'content_block_stop', index: 0 })
        var delta = { stop_reason: 'end_turn' }
        if (title) delta.title = title
        emit({ type: 'message_delta', delta: delta })
        emit({ type: 'message_stop' })
        controller.close()
      },
    })
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  function httpError(message) {
    return new Response(JSON.stringify({ error: { message: message } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  var originalFetch = window.fetch.bind(window)
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input)
    if (url.indexOf('/anthropic/v1/messages') === -1) {
      if (/^https?:/i.test(url)) S.passthrough.push(url.slice(0, 160))
      return originalFetch(input, init)
    }
    var body = {}
    try {
      body = JSON.parse((init && init.body) || '{}')
    } catch (error) {
      S.errors.push('请求体不是 JSON')
    }
    var system = String(body.system || '')
    S.requests.push({
      i: S.requests.length,
      kind: system.indexOf(COMPRESS_SYS) === 0 ? 'summary' : 'chat',
      systemHead: system.slice(0, 48),
      n: Object.prototype.toString.call(body.messages) === '[object Array]' ? body.messages.length : -1,
      messages: compactMessages(body.messages),
    })
    var step = S.queue.shift()
    if (!step) {
      S.errors.push('mock 队列为空：request #' + (S.requests.length - 1))
      return httpError('E2E mock queue empty')
    }
    if (step.error) return httpError(step.error)
    return sse(step.text, step.title)
  }

  function nodes(role) {
    return Array.prototype.slice.call(document.querySelectorAll('[data-chat-role="' + role + '"]'))
  }
  S.composerReady = function () {
    var textarea = document.querySelector('[data-chat-composer] textarea')
    return !!textarea && !textarea.disabled
  }
  S.newChat = function () {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('button'))
    var button = buttons.filter(function (item) {
      return (item.getAttribute('aria-label') || '') === L.newChat
    })[0]
    if (!button) {
      button = buttons.filter(function (item) {
        return (item.textContent || '').trim() === L.newChat
      })[0]
    }
    if (!button) return { ok: false, reason: '找不到新对话按钮' }
    button.click()
    return { ok: true }
  }
  S.send = function (text) {
    var textarea = document.querySelector('[data-chat-composer] textarea')
    if (!textarea) return Promise.resolve({ ok: false, reason: '没有输入框' })
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    var deadline = Date.now() + 8000
    return new Promise(function (resolve) {
      function tick() {
        var scope = document.querySelector('[data-chat-composer]') || document
        var button = Array.prototype.slice.call(scope.querySelectorAll('button')).filter(function (item) {
          return (item.getAttribute('aria-label') || '') === L.send
        })[0]
        if (button && button.getAttribute('aria-disabled') !== 'true') {
          button.click()
          resolve({ ok: true, len: text.length })
          return
        }
        if (Date.now() > deadline) {
          resolve({
            ok: false,
            reason: '发送按钮不可用',
            labels: Array.prototype.slice.call(scope.querySelectorAll('button')).map(function (item) {
              return item.getAttribute('aria-label')
            }),
          })
          return
        }
        setTimeout(tick, 60)
      }
      tick()
    })
  }
  S.hasText = function (marker) {
    return nodes('assistant').some(function (node) {
      return (node.textContent || '').indexOf(marker) !== -1
    })
  }
  S.hasButton = function (label) {
    return nodes('assistant').some(function (node) {
      return Array.prototype.slice.call(node.querySelectorAll('button')).some(function (button) {
        return (button.textContent || '').trim().indexOf(label) !== -1
      })
    })
  }
  S.clickByText = function (label) {
    var button = Array.prototype.slice.call(document.querySelectorAll('[data-chat-role="assistant"] button')).filter(function (item) {
      return (item.textContent || '').trim().indexOf(label) !== -1
    })[0]
    if (!button) return { ok: false, reason: '找不到按钮 ' + label }
    if (button.disabled) return { ok: false, reason: '按钮 disabled ' + label }
    button.click()
    return { ok: true }
  }
  S.noticeText = function () {
    var list = nodes('assistant')
    return list.length ? (list[list.length - 1].textContent || '').slice(0, 600) : ''
  }
  S.lastUserText = function () {
    var list = nodes('user')
    return list.length ? list[list.length - 1].textContent || '' : ''
  }
  S.memoryNew = function () {
    try {
      return Object.keys(localStorage).filter(function (key) {
        return key.indexOf('ds.chat-context-memory.v1:') === 0 && S.memoryBaseline.indexOf(key) === -1
      })
    } catch (error) {
      return []
    }
  }
  S.memoryValue = function (key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null')
    } catch (error) {
      return null
    }
  }
  S.queueStep = function (step) {
    S.queue.push(step)
    return S.queue.length
  }
  S.request = function (index) {
    return S.requests[index] || null
  }
  S.report = function () {
    return { requests: S.requests, queue: S.queue, errors: S.errors, passthrough: S.passthrough }
  }
  return { ok: true, L: L, isEn: isEn, memoryBaseline: S.memoryBaseline }
}

// ---------- 主流程 ----------
let providerChanged = false
let keyMocked = false
let originalProvider = 'deepseek'

const readEnv = () =>
  evaluate(`(function () {
    var prefs = window.chatDisplayPrefs
    return {
      url: location.href,
      version: (document.querySelector('meta[name="application-version"]') || {}).content || '',
      provider: prefs ? prefs.read('provider', 'deepseek') : '(none)',
      keyLen: (function () { try { var b = window.DeepSeekAndroid; return String((b && b.getApiKey && b.getApiKey()) || '').length } catch (e) { return -1 } })(),
      composer: !!document.querySelector('[data-chat-composer] textarea')
    }
  })()`)

async function run() {
  console.log('\n=== 0. 环境自检 ===')
  await waitFor('!!document.querySelector("[data-chat-composer] textarea")', 30000, '页面渲染')
  let env = await readEnv()
  console.log('环境：' + JSON.stringify(env))
  check('页面是 App 的 chat/index.html', /android_asset\/chat\/index\.html/.test(env.url), env.url)
  check('输入框已渲染', env.composer === true)
  if (env.provider !== 'deepseek') {
    if (process.env.E2E_SET_PROVIDER !== '1') throw new Error('BLOCKED: provider=' + env.provider + '，加 E2E_SET_PROVIDER=1')
    originalProvider = env.provider
    await evaluate(`window.chatDisplayPrefs.save('provider', 'deepseek')`)
    providerChanged = true
    await reload()
    env = await readEnv()
  }
  check('provider = deepseek', env.provider === 'deepseek', env.provider)
  if (!(env.keyLen > 0)) {
    if (process.env.E2E_SET_KEY !== '1') throw new Error('BLOCKED: 没有 API Key，加 E2E_SET_KEY=1')
    const set = await evaluate(`(function () { try { return window.DeepSeekAndroid.setApiKey('sk-e2e-' + Date.now()) ? 'ok' : 'failed' } catch (e) { return String(e) } })()`)
    if (set !== 'ok') throw new Error('BLOCKED: 写入 mock Key 失败：' + set)
    keyMocked = true
    await reload()
    env = await readEnv()
  }
  check('已有 API Key（不会真实联网）', env.keyLen > 0, 'keyLen=' + env.keyLen)

  console.log('\n=== 1. 安装 fetch mock ===')
  const install = await evaluate('(' + pageMock.toString() + ')(' + JSON.stringify(TAG) + ')')
  if (!install || !install.ok) throw new Error('BLOCKED: mock 安装失败：' + JSON.stringify(install))
  const L = install.L
  check('mock 安装成功', true, 'tag=' + TAG)
  await evaluate('__e2e.queueStep(' + JSON.stringify({ text: 'E2E-PROBE' }) + ')')
  const probe = await evaluate(`(async function () {
    try {
      var response = await window.fetch('https://api.deepseek.com/anthropic/v1/messages', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ system: 'e2e-probe', messages: [] })
      })
      var text = await response.text()
      return { status: response.status, ok: text.indexOf('E2E-PROBE') !== -1 }
    } catch (error) { return { error: String(error) } }
  })()`)
  if (!probe || probe.status !== 200 || !probe.ok) throw new Error('BLOCKED: fetch mock 未生效：' + JSON.stringify(probe))
  check('fetch mock 生效', true)
  await evaluate('__e2e.requests = []; __e2e.queue = []; __e2e.errors = []')

  // ---------- 场景 A ----------
  console.log('\n=== 场景 A：历史太长 →「压缩上下文并继续」 ===')
  await evaluate('__e2e.newChat()')
  await waitFor('document.querySelectorAll("[data-chat-role=user]").length === 0', 10000, '新对话清空')
  const ROUNDS = 8
  for (let i = 1; i <= ROUNDS; i++) {
    const question = 'E2E-Q' + i + '-' + TAG
    const answer = 'E2E-A' + i + '-' + TAG
    await evaluate('__e2e.queueStep(' + JSON.stringify({ text: answer, title: i === 1 ? 'E2E ' + TAG : null }) + ')')
    const sent = await evaluate('__e2e.send(' + JSON.stringify(question) + ')')
    check('A 第 ' + i + ' 轮发送', sent && sent.ok, JSON.stringify(sent))
    await waitFor('__e2e.hasText(' + JSON.stringify(answer) + ')', 25000, 'A 第 ' + i + ' 轮回答')
  }
  const q9 = 'E2E-Q9-' + TAG
  await evaluate('__e2e.queueStep(' + JSON.stringify({ error: "This model's maximum context length is 32768 tokens. However, your messages resulted in 412345 tokens." }) + ')')
  const sent9 = await evaluate('__e2e.send(' + JSON.stringify(q9) + ')')
  check('A9 发送第 9 轮（mock 400 超限）', sent9 && sent9.ok, JSON.stringify(sent9))
  await waitFor('__e2e.hasButton(' + JSON.stringify(L.compress) + ')', 30000, 'A9 压缩按钮')
  check('A9 「压缩上下文并继续」按钮出现', true)
  const notice = await evaluate('__e2e.noticeText()')
  check('A9 错误提示带上限数值', String(notice).indexOf('32,768') !== -1, String(notice).slice(0, 160))
  check('A9 压缩前没有记忆', (await evaluate('__e2e.memoryNew().length')) === 0)

  const summaryText = 'E2E-SUMMARY-' + TAG + '：前两轮要点。'
  const regenAnswer = 'E2E-A10-' + TAG
  await evaluate('__e2e.queueStep(' + JSON.stringify({ text: summaryText }) + ')')
  await evaluate('__e2e.queueStep(' + JSON.stringify({ text: regenAnswer }) + ')')
  const clicked = await evaluate('__e2e.clickByText(' + JSON.stringify(L.compress) + ')')
  check('A10 点击压缩按钮', clicked && clicked.ok, JSON.stringify(clicked))
  await waitFor('__e2e.hasText(' + JSON.stringify(regenAnswer) + ')', 40000, 'A10 压缩后自动重发回答')
  await waitFor('__e2e.requests.length === 11', 15000, 'A10 摘要+重发请求')

  const after = await evaluate(`(function () {
    return {
      requests: __e2e.requests,
      memory: __e2e.memoryNew().map(function (key) { return __e2e.memoryValue(key) })
    }
  })()`)
  const summaryReq = after.requests[9]
  const regenReq = after.requests[10]
  const summaryUser = summaryReq.messages.filter((item) => item.role === 'user')[0] || {}
  const summaryPrompt = summaryUser.text || ''
  check('A10 摘要请求走压缩提示词', summaryReq.kind === 'summary', summaryReq.systemHead)
  check('A10 摘要请求含【对话内容】和第 1、2 轮', summaryPrompt.indexOf('【对话内容】') !== -1 && summaryPrompt.indexOf('E2E-Q1-') !== -1 && summaryPrompt.indexOf('E2E-Q2-') !== -1)
  check('A10 首次压缩不带【已有摘要】', summaryPrompt.indexOf('【已有摘要】') === -1)
  const regenUsers = regenReq.messages.filter((item) => item.role === 'user')
  const covered = 10 - regenUsers.length
  check('A10 重发首条是摘要', !!(regenUsers[0] && regenUsers[0].hasSummary && (regenUsers[0].text || '').indexOf('E2E-SUMMARY-') !== -1))
  check('A10 重发跳过已覆盖旧轮次', regenUsers.every((item) => item.head.indexOf('E2E-Q1-') === -1), 'covered=' + covered)
  check('A10 重发末条是第 9 轮提问', regenUsers.length > 0 && regenUsers[regenUsers.length - 1].head === q9)
  check('A10 记忆落库 1 条', after.memory.length === 1)
  check(
    'A10 记忆内容与请求一致',
    !!(after.memory[0] && String(after.memory[0].summary).indexOf('E2E-SUMMARY-') !== -1 && after.memory[0].coveredRounds === covered),
    after.memory[0] ? 'coveredRounds=' + after.memory[0].coveredRounds : 'none'
  )

  const q10 = 'E2E-Q10-' + TAG
  const a11 = 'E2E-A11-' + TAG
  await evaluate('__e2e.queueStep(' + JSON.stringify({ text: a11 }) + ')')
  const sent10 = await evaluate('__e2e.send(' + JSON.stringify(q10) + ')')
  check('A11 再发一条普通消息', sent10 && sent10.ok, JSON.stringify(sent10))
  await waitFor('__e2e.hasText(' + JSON.stringify(a11) + ')', 25000, 'A11 回答')
  const nextReq = await evaluate('__e2e.request(__e2e.requests.length - 1)')
  const nextUsers = nextReq.messages.filter((item) => item.role === 'user')
  check('A11 后续请求仍带摘要', !!(nextUsers[0] && nextUsers[0].hasSummary))
  check('A11 记忆没有重复写', (await evaluate('__e2e.memoryNew().length')) === 1)

  // ---------- 场景 B ----------
  console.log('\n=== 场景 B：当前这条太大 →「截断后发送」 ===')
  await evaluate('__e2e.newChat()')
  await waitFor('document.querySelectorAll("[data-chat-role=user]").length === 0', 10000, '新对话清空')
  const baseTotal = await evaluate('__e2e.requests.length')
  const HEAD = 'E2ETRIMHEAD-' + TAG + '-'
  const TAIL = '-E2ETRIMTAIL-' + TAG
  const LONG = HEAD + 'X'.repeat(46000 - HEAD.length - TAIL.length) + TAIL
  await evaluate('__e2e.queueStep(' + JSON.stringify({ error: 'user input too long, 999999 tokens exceeds max 32768 tokens (request_id: e2e-' + TAG + ')' }) + ')')
  const sentLong = await evaluate('__e2e.send(' + JSON.stringify(LONG) + ')')
  check('B1 发送 ' + LONG.length + ' 字长提问', sentLong && sentLong.ok, JSON.stringify(sentLong))
  await waitFor('__e2e.hasButton(' + JSON.stringify(L.trim) + ')', 45000, 'B1 截断按钮')
  check('B1 「截断后发送」按钮出现', true)
  const trimAnswer = 'E2E-TRIM-OK-' + TAG
  await evaluate('__e2e.queueStep(' + JSON.stringify({ text: trimAnswer }) + ')')
  const clickedTrim = await evaluate('__e2e.clickByText(' + JSON.stringify(L.trim) + ')')
  check('B2 点击截断按钮', clickedTrim && clickedTrim.ok, JSON.stringify(clickedTrim))
  await waitFor('__e2e.hasText(' + JSON.stringify(trimAnswer) + ')', 30000, 'B2 截断重发回答')
  check('B2 只新增一个重发请求', (await evaluate('__e2e.requests.length')) === baseTotal + 2)
  const trimReq = await evaluate('__e2e.request(' + (baseTotal + 1) + ')')
  const trimUser = trimReq.messages.filter((item) => item.role === 'user')[0] || {}
  check('B2 重发正文变短且保留开头', typeof trimUser.len === 'number' && trimUser.len > 26000 && trimUser.len < 26400 && trimUser.head === LONG.slice(0, 96), 'len=' + trimUser.len)
  check('B2 带截断标记且不含原结尾', typeof trimUser.tail === 'string' && trimUser.tail.indexOf('（内容过长，已截断后重发）') !== -1 && trimUser.tail.indexOf('E2ETRIMTAIL') === -1, trimUser.tail)
  const visible = await evaluate('__e2e.lastUserText()')
  check('B2 界面显示截断后的提问', String(visible).indexOf('（内容过长，已截断后重发）') !== -1, 'chars=' + String(visible).length)

  console.log('\n=== 3. 汇总 ===')
  const pageErrors = await evaluate('__e2e.errors')
  check('页面无异常、mock 队列未空转', Array.isArray(pageErrors) && pageErrors.length === 0, JSON.stringify(pageErrors))
  const passthrough = await evaluate('__e2e.passthrough')
  check(
    '全程没有真实聊天 API 请求（TTS/自动朗读不算）',
    !passthrough.some((url) => {
      if (url.indexOf('/v1/tools/tts') !== -1) return false
      return url.indexOf('api.deepseek.com') !== -1
    }),
    JSON.stringify(passthrough)
  )
}

async function cleanup() {
  console.log('\n=== 4. 清理 ===')
  try {
    if (process.env.E2E_SKIP_CLEANUP !== '1') {
      const info = await evaluate(`(async function () {
        var TAG = ${JSON.stringify(TAG)}
        var removed = []
        try {
          Object.keys(localStorage).filter(function (key) { return key.indexOf('ds.chat-context-memory.v1:') === 0 })
            .forEach(function (key) { if ((localStorage.getItem(key) || '').indexOf(TAG) !== -1) { localStorage.removeItem(key); removed.push(key) } })
        } catch (error) {}
        var db = await new Promise(function (resolve, reject) {
          var request = indexedDB.open('chat-demo')
          request.onsuccess = function () { resolve(request.result) }
          request.onerror = function () { reject(request.error) }
        })
        var sessions = await new Promise(function (resolve) {
          var tx = db.transaction('sessions', 'readonly')
          var request = tx.objectStore('sessions').getAll()
          request.onsuccess = function () { resolve(request.result || []) }
          request.onerror = function () { resolve([]) }
        })
        var ids = sessions.filter(function (session) { try { return JSON.stringify(session).indexOf(TAG) !== -1 } catch (error) { return false } }).map(function (session) { return session.id })
        if (ids.length) {
          await new Promise(function (resolve) {
            var tx = db.transaction(['sessions', 'sessionSummaries'], 'readwrite')
            ids.forEach(function (id) { tx.objectStore('sessions').delete(id); tx.objectStore('sessionSummaries').delete(id) })
            tx.oncomplete = resolve
            tx.onerror = resolve
          })
        }
        try { db.close() } catch (error) {}
        return { removed: removed, ids: ids }
      })()`)
      console.log('  删除记忆键：' + JSON.stringify(info.removed))
      console.log('  删除测试会话：' + JSON.stringify(info.ids))
    }
    if (providerChanged) {
      await evaluate(`window.chatDisplayPrefs.save('provider', ${JSON.stringify(originalProvider)})`)
      console.log('  还原 provider=' + originalProvider)
    }
    if (keyMocked) {
      await evaluate(`(function () { try { window.DeepSeekAndroid.clearApiKey(); return 'ok' } catch (e) { return String(e) } })()`)
      console.log('  已清除临时 mock Key')
    }
  } catch (error) {
    console.error('  清理失败：' + error.message)
  }
  try {
    await evaluate('location.reload()')
    console.log('  已 reload 页面（fetch 补丁消失）')
  } catch {}
  try {
    ws.close()
  } catch {}
}

try {
  await run()
} catch (error) {
  const message = String((error && error.message) || error)
  if (message.startsWith('BLOCKED: ')) {
    console.error('\n阻塞：' + message.slice(9))
    process.exitCode = 3
  } else {
    console.error('\n执行中断：' + message)
    process.exitCode = 1
  }
  try {
    const report = await evaluate('__e2e && __e2e.report ? __e2e.report() : null')
    if (report) console.error('mock 报告：' + JSON.stringify(report).slice(0, 6000))
  } catch {}
} finally {
  await cleanup()
  const failed = results.filter((item) => !item.ok)
  console.log('\n结果：' + (results.length - failed.length) + ' PASS / ' + failed.length + ' FAIL')
  if (failed.length) console.log('失败项：' + failed.map((item) => item.name).join('；'))
  if (failed.length && !process.exitCode) process.exitCode = 1
}
