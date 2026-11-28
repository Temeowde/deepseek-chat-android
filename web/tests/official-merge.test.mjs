/**
 * 官方同步合并去重：导入/本地续聊的消息不能被官方内容覆盖，也不能成对重复。
 * 运行：node --experimental-transform-types --disable-warning=ExperimentalWarning web/tests/official-merge.test.mjs
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const cwd = process.cwd()
const WEB = existsSync(path.join(cwd, 'src/services/chat/officialMerge.ts'))
  ? cwd
  : existsSync(path.join(cwd, 'web/src/services/chat/officialMerge.ts'))
    ? path.join(cwd, 'web')
    : null
if (!WEB) {
  console.error('找不到 web/src，请在仓库根或 web/ 目录运行')
  process.exit(2)
}
const { mergeOfficialWithLocal, dedupeOfficialSessionMessages } = await import(
  pathToFileURL(path.join(WEB, 'src/services/chat/officialMerge.ts')).href
)

const user = (id, content, createdAt) => ({ id, role: 'user', content, createdAt })
const reply = (id, text, createdAt) => ({ id, role: 'assistant', createdAt, blocks: text === '' ? [] : [{ type: 'text', text }] })

let passed = 0
const failures = []
const run = (name, fn) => {
  try {
    fn()
    passed += 1
    console.log('PASS  ' + name)
  } catch (error) {
    failures.push({ name, error })
    console.error('FAIL  ' + name + '\n      ' + (error?.message ?? error))
  }
}

run('官方 + 导入的同内容消息不重复保留，本地独有消息一条不丢', () => {
  const official = [user('o_1', '你好', 100), reply('o_2', '你好呀', 101)]
  const local = [
    user('1', '你好', 100),
    reply('2', '你好呀', 101),
    user('3', '16464', 102),
    reply('4', '收到，16464', 103),
  ]
  const result = mergeOfficialWithLocal(official, local)
  assert.equal(result.messages.length, 4)
  assert.equal(result.deduped, 2)
  assert.deepEqual(result.messages.map((m) => m.id), ['o_1', 'o_2', '3', '4'])
})

run('本地独有内容按时间插到官方序列中间', () => {
  const official = [user('o_1', 'a', 100), reply('o_2', 'b', 300)]
  const local = [user('9', '本地补充', 200)]
  const result = mergeOfficialWithLocal(official, local)
  assert.deepEqual(result.messages.map((m) => m.id), ['o_1', '9', 'o_2'])
})

run('空白助手消息不参与内容去重（不能把两条空回答合成一条）', () => {
  const official = [user('o_1', '问题', 100), reply('o_2', '', 101)]
  const local = [reply('2', '', 101), reply('3', '', 102)]
  const result = mergeOfficialWithLocal(official, local)
  assert.equal(result.deduped, 0)
  assert.equal(result.messages.length, 4)
})

run('本地重复消息（同 id 或同内容）会被去掉，只留一份', () => {
  const official = [user('o_1', 'q', 100)]
  const local = [user('5', 'x', 101), user('5', 'x', 101), user('6', 'x', 102)]
  const result = mergeOfficialWithLocal(official, local)
  assert.equal(result.messages.length, 2)
  assert.equal(result.deduped, 2)
  assert.deepEqual(result.messages.map((m) => m.id), ['o_1', '5'])
})

run('本地存量去重：只删和 o_ 官方消息内容相同的副本，本地独有消息保留', () => {
  const messages = [
    user('o_1', 'q', 100),
    reply('o_2', 'a', 101),
    user('1', 'q', 100),
    reply('2', 'a', 101),
    user('x-1', '16464', 102),
    reply('x-2', '收到', 103),
  ]
  const result = dedupeOfficialSessionMessages(messages)
  assert.equal(result.deduped, 2)
  assert.deepEqual(result.messages.map((m) => m.id), ['o_1', 'o_2', 'x-1', 'x-2'])
})

run('没有 o_ 官方消息的会话不动（可能只是用户真的重复问了同样的话）', () => {
  const messages = [user('1', 'q', 100), reply('2', 'a', 101), user('3', 'q', 102), reply('4', 'a', 103)]
  const result = dedupeOfficialSessionMessages(messages)
  assert.equal(result.deduped, 0)
  assert.equal(result.messages.length, 4)
})

console.log(`\n结果：${passed} PASS / ${failures.length} FAIL（共 ${passed + failures.length} 组）`)
if (failures.length > 0) {
  process.exitCode = 1
} else {
  console.log('全部通过')
}
