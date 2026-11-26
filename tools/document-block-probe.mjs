/**
 * document 内容块实测：验证"把长文本放进 document 块是否绕过 32,768 单条输入上限"。
 *
 * 用 App 里已保存的 API Key（只在内存里用，不打印），在 Node 侧直接请求
 * https://api.deepseek.com/anthropic/v1/messages：
 *   1) 60,000 汉字（≈34,379 tokens，已知作为纯文本会被 32K 拒绝）放进 document{source:{type:'text'}}
 *   2) 若 1 被拒：把同样文本用 user_data 上传成 file_id，再用 document{source:{type:'file'}} 引用
 *   3) 清理上传的文件
 *
 * 运行：$env:ADB='D:\AndroidToolchain\sdk\platform-tools\adb.exe'; node tools/document-block-probe.mjs
 * 成本：< ¥0.2。
 */
import { execFileSync } from 'node:child_process'

const ADB = process.env.ADB ?? 'adb'
const PORT = Number(process.env.CDP_PORT ?? 9339)
const PKG = 'com.temeowde.dschat'
const ORIGIN = 'https://api.deepseek.com'
const CHARS = Number(process.env.CHARS ?? 60000)

const adb = (...args) => execFileSync(ADB, args, { encoding: 'utf8', timeout: 60000 }).trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
    }, 120000)
  })
await call('Runtime.enable').catch(() => {})
const evaluate = async (expression) => {
  const res = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  const details = res.result?.exceptionDetails
  if (details) throw new Error('page exception: ' + (details.exception?.description || details.text))
  return res.result?.result?.value
}

const apiKey = await evaluate(`(function(){
  try { return String((window.DeepSeekAndroid && window.DeepSeekAndroid.getApiKey && window.DeepSeekAndroid.getApiKey()) || '') }
  catch (e) { return '' }
})()`)
if (!apiKey) throw new Error('拿不到 App 里保存的 API Key')
console.log('已从 App 读取 API Key（长度 ' + apiKey.length + '，不显示内容）')

const sentence = '蓝鲸项目第R段：负责人第I组，预算I00元，截止2026年12月，风险是数据备份和权限控制，结论是先完成最小可用版本再补充细节。'
let text = ''
for (let i = 1; text.length < CHARS; i += 1) {
  text += sentence.replaceAll('R', String(i)).replaceAll('I', String(i))
}
text = text.slice(0, CHARS)
const questions = '这份文档的第一段主要讲了什么？请用一句话回答。'
console.log('测试文本：' + text.length + ' 字符（≈' + Math.ceil(text.length / 1.6) + ' tokens）')

const post = async (url, body, headers = {}) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, ...headers },
    body: JSON.stringify(body),
  })
  const raw = await response.text()
  let json = null
  try {
    json = JSON.parse(raw)
  } catch {}
  return { status: response.status, json, raw }
}
const brief = (result) => ({
  status: result.status,
  error: result.json?.error?.message?.slice(0, 300),
  type: result.json?.type,
  content: Array.isArray(result.json?.content)
    ? result.json.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .slice(0, 200)
    : undefined,
  usage: result.json?.usage,
})

console.log('\n=== 实验 1：60k 字文本放进 document 内容块 ===')
const questionInDoc = process.env.Q_IN_DOC === '1'
const inline = await post(`${ORIGIN}/anthropic/v1/messages`, {
  model: 'deepseek-flash',
  max_tokens: 64,
  thinking: { type: 'disabled' },
  messages: [
    {
      role: 'user',
      content: questionInDoc
        ? [
            {
              type: 'document',
              source: {
                type: 'text',
                media_type: 'text/plain',
                data: '请用一句话总结这份文档的主要内容。\n\n' + text,
              },
            },
          ]
        : [
            { type: 'document', source: { type: 'text', media_type: 'text/plain', data: text } },
            { type: 'text', text: questions },
          ],
    },
  ],
})
console.log(JSON.stringify(brief(inline), null, 2))

let fileId = null
if (inline.status === 200) {
  console.log('\n结论：document 内联文本【通过】——不受 32K 单条限制。')
} else {
  console.log('\n实验 1 未通过，继续实验 2（user_data 上传 + file_id 引用）…')
  const form = new FormData()
  form.append('purpose', 'user_data')
  form.append('file', new Blob([text], { type: 'text/plain' }), 'probe-long.txt')
  const uploadResponse = await fetch(`${ORIGIN}/anthropic/v1/files`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-beta': 'files-api-2025-04-14' },
    body: form,
  })
  const uploadRaw = await uploadResponse.text()
  let uploadJson = null
  try {
    uploadJson = JSON.parse(uploadRaw)
  } catch {}
  console.log(
    '上传结果：' + JSON.stringify({ status: uploadResponse.status, id: uploadJson?.id, error: uploadJson?.error?.message?.slice(0, 200) })
  )
  fileId = uploadJson?.id ?? null
  if (fileId) {
    const byFile = await post(
      `${ORIGIN}/anthropic/v1/messages`,
      {
        model: 'deepseek-flash',
        max_tokens: 64,
        thinking: { type: 'disabled' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'document', source: { type: 'file', file_id: fileId } },
              { type: 'text', text: questions },
            ],
          },
        ],
      },
      { 'anthropic-beta': 'files-api-2025-04-14' }
    )
    console.log('\n=== 实验 2：file_id document 引用 ===')
    console.log(JSON.stringify(brief(byFile), null, 2))
    if (byFile.status === 200) {
      console.log('\n结论：file_id document【通过】——不受 32K 单条限制，大文件可以走文档引用。')
    } else {
      console.log('\n结论：file_id document 也被拒绝。')
    }
  }
}

if (fileId) {
  try {
    const del = await fetch(`${ORIGIN}/anthropic/v1/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { 'x-api-key': apiKey, 'anthropic-beta': 'files-api-2025-04-14' },
    })
    console.log('\n清理上传文件：HTTP ' + del.status)
  } catch (error) {
    console.log('\n清理上传文件失败：' + error.message)
  }
}
ws.close()
