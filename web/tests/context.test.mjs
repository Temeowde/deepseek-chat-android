/**
 * 上下文超限功能：单元级验证（离线，不需要设备/网络/构建）
 *
 * 运行（Node >= 22，需 transform-types 以支持 TS 参数属性风格之外的源码；本机 Node 24 验证）：
 *   cd web
 *   node --experimental-transform-types --disable-warning=ExperimentalWarning tests/context.test.mjs
 *
 * 覆盖：
 *  - contextMemory：估算、读写、损坏数据、存储异常容错
 *  - describe：getContextLimit 文案解析、describeReply 的 action 分流
 *  - reply：toRequestMessages 在有/无摘要记忆时的输出（普通聊天必须完全不变）
 * 压缩模块的重实践（真实摘要调用/分块）由端到端脚本覆盖：
 *   tools/verify-context-overflow.mjs
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerHooks } from 'node:module'

const cwd = process.cwd()
const WEB = existsSync(path.join(cwd, 'src/services/chat/contextMemory.ts'))
  ? cwd
  : existsSync(path.join(cwd, 'web/src/services/chat/contextMemory.ts'))
    ? path.join(cwd, 'web')
    : null
if (!WEB) {
  console.error('找不到 web/src，请在仓库根或 web/ 目录运行')
  process.exit(2)
}
const SRC = path.join(WEB, 'src')
const CHAT = path.join(SRC, 'services/chat')
const chat = (name) => pathToFileURL(path.join(CHAT, name)).href

// 生产源码用 NodeNext 的 './x.js' 说明符，真实文件是 x.ts：找不到 .js 时回退 .ts
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.js') && (specifier.startsWith('./') || specifier.startsWith('../'))) {
      try {
        return nextResolve(specifier, context)
      } catch (error) {
        if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
        const url = new URL(specifier, context.parentURL)
        url.pathname = url.pathname.slice(0, -3) + '.ts'
        return { url: url.href, shortCircuit: true }
      }
    }
    return nextResolve(specifier, context)
  },
})

// settings.ts 等模块顶层会访问浏览器全局
const storage = new Map()
let storageThrows = { get: false, set: false, remove: false }
globalThis.localStorage = {
  getItem: (key) => {
    if (storageThrows.get) throw new Error('storage blocked')
    return storage.has(key) ? storage.get(key) : null
  },
  setItem: (key, value) => {
    if (storageThrows.set) throw new Error('quota exceeded')
    storage.set(key, String(value))
  },
  removeItem: (key) => {
    if (storageThrows.remove) throw new Error('storage blocked')
    storage.delete(key)
  },
}
globalThis.window = {
  chatDisplayPrefs: { read: (_key, fallback) => fallback, save: () => true },
  addEventListener: () => {},
  removeEventListener: () => {},
}
globalThis.__API_ORIGIN__ = 'https://api.deepseek.com'

const memory = await import(chat('contextMemory.ts'))
const { getContextRounds, toRequestMessages } = await import(chat('reply.ts'))
const { getContextLimit, describeReply } = await import(chat('describe.ts'))
const { useSettings } = await import(pathToFileURL(path.join(SRC, 'services/settings.ts')).href)

let passed = 0
const failures = []
const run = (name, fn) => {
  try {
    fn()
    passed += 1
    console.log('PASS  ' + name)
  } catch (error) {
    failures.push({ name, error })
    console.log('FAIL  ' + name + '\n      ' + String(error?.message ?? error).replaceAll('\n', '\n      '))
  }
}

/* ---------------- contextMemory ---------------- */
run('estimateTokens：空值 0、非空为正、中文/英文/emoji 可复现', () => {
  assert.equal(memory.CHARS_PER_TOKEN, 1.2)
  assert.equal(memory.estimateTokens(null), 0)
  assert.equal(memory.estimateTokens(''), 0)
  assert.equal(memory.estimateTokens('a'), 1)
  assert.equal(memory.estimateTokens('abcd'), 4)
  assert.equal(memory.estimateTokens('中文'), 2)
  assert.equal(memory.estimateTokens('😀'), 2)
  assert.equal(memory.estimateTokens('a'.repeat(1000)), 834)
})

run('contextMemory：读写往返、session 隔离、key 前缀（v2 分段）', () => {
  storage.clear()
  storageThrows = { get: false, set: false, remove: false }
  assert.equal(memory.readContextMemory('s1'), null)
  memory.writeContextMemory('s1', {
    segments: [{ summary: '摘要A', from: 0, to: 3 }],
    coveredRounds: 3,
    updatedAt: 123,
  })
  memory.writeContextMemory('s2', {
    segments: [{ summary: '摘要B', from: 0, to: 1 }],
    coveredRounds: 1,
    updatedAt: 456,
  })
  assert.deepEqual(memory.readContextMemory('s1'), {
    segments: [{ summary: '摘要A', from: 0, to: 3 }],
    coveredRounds: 3,
    updatedAt: 123,
  })
  assert.ok([...storage.keys()].includes('ds.chat-context-memory.v1:s1'))
  memory.clearContextMemory('s1')
  assert.equal(memory.readContextMemory('s1'), null)
  assert.equal(memory.readContextMemory('s2').segments[0].summary, '摘要B')
})

run('contextMemory：旧版单份 summary 自动迁移成一段', () => {
  storage.clear()
  storage.set('ds.chat-context-memory.v1:legacy', JSON.stringify({
    summary: '旧摘要', coveredRounds: 4, anchorId: 'a0', updatedAt: 9,
  }))
  assert.deepEqual(memory.readContextMemory('legacy'), {
    segments: [{ summary: '旧摘要', from: 0, to: 4 }],
    coveredRounds: 4,
    anchorId: 'a0',
    updatedAt: 9,
  })
})

run('contextMemory：多段摘要带编号与 token 估算', () => {
  const multi = {
    segments: [
      { summary: '第一段', from: 0, to: 2 },
      { summary: '第二段', from: 2, to: 5 },
    ],
    coveredRounds: 5,
    updatedAt: 1,
  }
  const text = memory.memorySummaryText(multi)
  assert.ok(text.includes('【第 1/2 段】第一段'))
  assert.ok(text.includes('【第 2/2 段】第二段'))
  assert.equal(memory.memorySummaryTokens(multi), memory.estimateTokens(text))
})

run('contextMemory：损坏/非法数据一律 null，不抛', () => {
  storage.clear()
  const bad = [
    '{bad json',
    'null',
    '[]',
    JSON.stringify({ summary: '', coveredRounds: 2 }),
    JSON.stringify({ summary: 'S' }),
    JSON.stringify({ summary: 'S', coveredRounds: 0 }),
    JSON.stringify({ summary: 'S', coveredRounds: -1 }),
    JSON.stringify({ summary: 'S', coveredRounds: '3' }),
    JSON.stringify({ summary: 42, coveredRounds: 2 }),
  ]
  for (const raw of bad) {
    storage.set('ds.chat-context-memory.v1:s', raw)
    assert.equal(memory.readContextMemory('s'), null, raw)
  }
})

run('contextMemory：存储异常时读写删均静默容错', () => {
  storage.clear()
  storageThrows = { get: true, set: false, remove: false }
  assert.equal(memory.readContextMemory('s'), null)
  storageThrows = { get: false, set: true, remove: false }
  assert.doesNotThrow(() => memory.writeContextMemory('s', {
    segments: [{ summary: 'S', from: 0, to: 1 }],
    coveredRounds: 1,
    updatedAt: 1,
  }))
  storageThrows = { get: false, set: false, remove: true }
  assert.doesNotThrow(() => memory.clearContextMemory('s'))
  storageThrows = { get: false, set: false, remove: false }
})

/* ---------------- describe ---------------- */
const LIMIT_CASES = [
  [null, null],
  ['', null],
  ['Internal server error', null],
  ['用户输入过长，最多 32768 tokens', null],
  ['maximum context length exceeded', null],
  ['user input too long, 614602 tokens exceeds max 32768 tokens (request_id: abc)', 32768],
  ['input is too long, 50000 tokens exceeds maximum of 32768 tokens', 32768],
  ['input too long, 3 tokens exceeds max 32768 tokens', null],
  ['input too long, 50000 tokens exceeds max 8000 tokens', null],
  ['maximum context length is 131072 tokens', 131072],
  ["This model's maximum context length is 131072 tokens. However, your messages resulted in 200000 tokens", 131072],
  ['maximum context length 8001 tokens', 8001],
  ['maximum context length 8000 tokens', null],
  ['maximum context length is 131072.5 tokens', 131072],
]
run('getContextLimit：两种报错、数字缺失/过小、普通错误', () => {
  for (const [message, expected] of LIMIT_CASES) {
    assert.equal(getContextLimit(message), expected, String(message))
  }
})

const replyOf = (overrides = {}) => ({
  id: 'a1',
  role: 'assistant',
  createdAt: 1,
  model: null,
  prefix: false,
  status: 'error',
  blocks: [],
  ...overrides,
})
const INPUT_EN = 'user input too long, 614602 tokens exceeds max 32768 tokens'
const CONTEXT_EN = 'maximum context length is 131072 tokens'

run('describeReply：overflow=input → trimInput；history → compressContext', () => {
  useSettings.setState({ locale: 'zh-CN' })
  assert.equal(
    describeReply(replyOf({ error: { message: INPUT_EN, status: 400, overflow: 'input' } })).action,
    'trimInput'
  )
  assert.equal(
    describeReply(replyOf({ error: { message: CONTEXT_EN, status: 400, overflow: 'history' } })).action,
    'compressContext'
  )
  assert.equal(
    describeReply(replyOf({ error: { message: CONTEXT_EN, status: 400 } })).action,
    'compressContext',
    'overflow 缺省（旧数据）默认压缩'
  )
  assert.equal(
    describeReply(replyOf({ error: { message: INPUT_EN, status: 400 } })).action,
    'trimInput',
    '旧数据没有 overflow 时，输入超限按文案回退为截断'
  )
})

run('describeReply：普通错误/401/402/429/500/network/upload 无超限按钮', () => {
  useSettings.setState({ locale: 'zh-CN' })
  assert.deepEqual(describeReply(replyOf({ error: { message: 'boom', status: 400 } })), { text: 'boom' })
  assert.equal(describeReply(replyOf({ error: { message: 'x', status: 401 } })).action, 'apiKey')
  assert.equal(describeReply(replyOf({ error: { message: 'x', status: 402 } })).action, 'topUp')
  assert.equal(describeReply(replyOf({ error: { message: 'x', status: 429 } })).action, undefined)
  assert.equal(describeReply(replyOf({ error: { message: 'x', status: 500 } })).action, undefined)
  assert.equal(describeReply(replyOf({ error: { kind: 'network', message: 'x' } })).action, undefined)
  assert.equal(describeReply(replyOf({ error: { kind: 'upload', message: '' } })).action, undefined)
})

/* ---------------- reply / 记忆注入 ---------------- */
const user = (i, content = 'Q' + i) => ({ id: 'u' + i, role: 'user', content, files: [], createdAt: i })
const answer = (i, text = 'A' + i, extra = {}) => ({
  id: 'a' + i,
  role: 'assistant',
  createdAt: i,
  model: null,
  prefix: false,
  status: 'done',
  blocks: [{ type: 'text', text }],
  ...extra,
})
const current = user(999, 'CURRENT')
const history = Array.from({ length: 8 }, (_, i) => [user(i), answer(i)]).flat()
const memoryOf = (summary, coveredRounds) => ({
  segments: coveredRounds > 0 ? [{ summary, from: 0, to: coveredRounds }] : [],
  coveredRounds,
  updatedAt: 1,
})
const summaryPair = (summary) => [
  { role: 'user', content: `【以下是本对话更早内容的摘要，请把它当作已经发生过的上下文】\n${summary}` },
  { role: 'assistant', content: [{ type: 'text', text: '好的，我已了解之前对话的要点，会在此基础上继续。' }] },
]

run('toRequestMessages：无 memory / null 时与普通聊天完全一致', () => {
  const plain = toRequestMessages(history, current)
  assert.deepEqual(toRequestMessages(history, current, undefined, false, undefined, null), plain)
  assert.deepEqual(toRequestMessages(history, current, undefined, false, undefined, memoryOf('S', 0)), plain)
})

run('toRequestMessages：有摘要时注入摘要对并跳过已覆盖轮次', () => {
  const messages = toRequestMessages(history, current, undefined, false, undefined, memoryOf('S', 2))
  assert.deepEqual(messages.slice(0, 2), summaryPair('S'))
  assert.deepEqual(messages[2], { role: 'user', content: 'Q2' })
  assert.ok(!JSON.stringify(messages).includes('"Q0"'))
  assert.deepEqual(messages.at(-1), { role: 'user', content: 'CURRENT' })
})

run('toRequestMessages：覆盖轮数超界/锚点不符/非法摘要时忽略旧摘要', () => {
  const over = toRequestMessages(history, current, undefined, false, undefined, memoryOf('S', 99))
  assert.equal(over.length, 17, '覆盖轮数超界：忽略摘要，不 clamp 顶掉全部历史')
  const wrongAnchor = toRequestMessages(history, current, undefined, false, undefined, {
    segments: [{ summary: 'S', from: 0, to: 2 }],
    coveredRounds: 2,
    anchorId: 'other-branch-message',
    updatedAt: 1,
  })
  assert.equal(wrongAnchor.length, 17, '锚点不符：忽略旧摘要')
  const rightAnchor = toRequestMessages(history, current, undefined, false, undefined, {
    segments: [{ summary: 'S', from: 0, to: 2 }],
    coveredRounds: 2,
    anchorId: 'u0',
    updatedAt: 1,
  })
  assert.equal(rightAnchor.length, 15, '锚点匹配：正常跳过 2 轮')
  const empty = toRequestMessages(history, current, undefined, false, undefined, memoryOf('   ', 3))
  assert.equal(empty.length, 17, '空摘要不注入')
})

run('toRequestMessages：多段摘要按编号注入、跳过累计覆盖轮次', () => {
  const multi = {
    segments: [
      { summary: '第一段', from: 0, to: 2 },
      { summary: '第二段', from: 2, to: 4 },
    ],
    coveredRounds: 4,
    updatedAt: 1,
  }
  const messages = toRequestMessages(history, current, undefined, false, undefined, multi)
  assert.deepEqual(messages.slice(0, 2), summaryPair('【第 1/2 段】第一段\n\n【第 2/2 段】第二段'))
  assert.deepEqual(messages[2], { role: 'user', content: 'Q4' })
  assert.ok(!JSON.stringify(messages).includes('"Q0"'))
})

run('getContextRounds：只保留「提问 + 可用回答」轮次', () => {
  const mixed = [
    user(0, 'Q0'),
    answer(0, 'A0'),
    user(1, 'Q1'),
    answer(1, 'A1', { status: 'error' }),
    user(2, 'Q2'),
    answer(2, 'A2', { status: 'stopped' }),
    user(3, 'Q3'),
    answer(3, 'A3', { status: 'pending' }),
  ]
  assert.deepEqual(getContextRounds(mixed).map(([q]) => q.id), ['u0', 'u2'])
})

run('toRequestMessages：官方通道超长文本走 document 块，短文本保持原样', () => {
  const long = 'x'.repeat(30000)
  const short = '短问题'
  assert.equal(toRequestMessages([], user(0, short), undefined, false, undefined, null, false).at(-1).content, short)
  const longParam = toRequestMessages([], user(1, long), undefined, false, undefined, null, true).at(-1)
  assert.ok(Array.isArray(longParam.content), '超长文本应转换为内容块数组')
  const doc = longParam.content.find((block) => block.type === 'document')
  assert.equal(doc?.source?.type, 'text')
  assert.equal(doc?.source?.data, long)
  const shortParam = toRequestMessages([], user(2, short), undefined, false, undefined, null, true).at(-1)
  assert.equal(shortParam.content, short, '短文本保持原样')
})

run('toRequestMessages：文本附件带 documentText 时生成内联 document 块', () => {
  const attachment = {
    id: 'f1',
    serverId: null,
    name: 'a.txt',
    size: 4,
    isImage: false,
    mimeType: 'text/plain',
    documentText: '附件正文',
  }
  const question = { ...user(3, '请总结'), files: [attachment] }
  const param = toRequestMessages([], question, undefined, false, undefined, null, false).at(-1)
  assert.ok(Array.isArray(param.content))
  assert.deepEqual(param.content[0], {
    type: 'document',
    source: { type: 'text', media_type: 'text/plain', data: '附件正文' },
  })
})

run('toRequestMessages：历史图片超过上限时只保留最近的图片并加占位文字', () => {
  const image = (id, size = 1000) => ({
    id,
    serverId: 'file-' + id,
    name: id + '.png',
    size,
    isImage: true,
    mimeType: 'image/png',
  })
  const rounds = []
  for (let i = 0; i < 150; i += 1) {
    const question = { ...user(i, 'Q' + i), files: [image('img' + i)] }
    rounds.push(question, answer(i, 'A' + i))
  }
  const messages = toRequestMessages(rounds, current)
  let imageBlocks = 0
  let placeholders = 0
  for (const message of messages) {
    if (message.role !== 'user') continue
    if (Array.isArray(message.content)) {
      imageBlocks += message.content.filter((block) => block.type === 'image').length
      const texts = message.content.filter((block) => block.type === 'text').map((block) => block.text)
      placeholders += texts.filter((text) => text.includes('张图片已省略')).length
    } else if (typeof message.content === 'string' && message.content.includes('张图片已省略')) {
      placeholders += 1
    }
  }
  assert.ok(imageBlocks > 0 && imageBlocks <= 20, '请求里的图片块应不超过 20，实际 ' + imageBlocks)
  assert.ok(placeholders >= 130, '被省略的较早图片应有占位提示，实际 ' + placeholders)
})

run('toRequestMessages：没有 serverId 的图片不会发送，但也算"已省略"并给出占位', () => {
  const pendingImage = {
    id: 'pending-img',
    serverId: null,
    name: 'pending.png',
    size: 1000,
    isImage: true,
    mimeType: 'image/png',
  }
  const question = { ...user(9, '看这张图'), files: [pendingImage] }
  const param = toRequestMessages([], question).at(-1)
  assert.ok(!JSON.stringify(param).includes('"type":"image"'), '没有上传的图片不应出现在请求里')
  const text = Array.isArray(param.content)
    ? param.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
    : param.content
  assert.ok(text.includes('张图片已省略'), '应提示图片已省略，实际：' + text)
})

run('toRequestMessages：图片总量超过 32MiB 预算时按体积保留最近的图片', () => {
  const image = (id, size) => ({
    id,
    serverId: 'file-' + id,
    name: id + '.png',
    size,
    isImage: true,
    mimeType: 'image/png',
  })
  const rounds = []
  for (let i = 0; i < 3; i += 1) {
    const question = { ...user(i, 'Q' + i), files: [image('big' + i, 30 * 1024 * 1024)] }
    rounds.push(question, answer(i, 'A' + i))
  }
  const messages = toRequestMessages(rounds, current)
  let imageBlocks = 0
  for (const message of messages) {
    if (message.role === 'user' && Array.isArray(message.content)) {
      imageBlocks += message.content.filter((block) => block.type === 'image').length
    }
  }
  assert.equal(imageBlocks, 1, '32MiB 预算下 3 张 30MiB 图片只能保留 1 张')
})

run('describeReply：图片太多的服务端错误给出可操作中文提示', () => {
  useSettings.setState({ locale: 'zh-CN' })
  const notice = describeReply(
    replyOf({ error: { message: 'too many images in request, maximum 600', status: 400 } })
  )
  assert.ok(notice?.text.includes('图片太多'), String(notice?.text))
})

/* ---------------- 汇总 ---------------- */
console.log('')
console.log(`结果：${passed} PASS / ${failures.length} FAIL（共 ${passed + failures.length} 组）`)
if (failures.length) {
  for (const item of failures) console.log('- ' + item.name + '：' + String(item.error?.message ?? item.error))
  process.exitCode = 1
} else {
  console.log('全部通过')
}
