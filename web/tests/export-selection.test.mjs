/**
 * 部分导出：会话选择页的排序/搜索纯函数验证。
 *   cd web
 *   node --experimental-transform-types --disable-warning=ExperimentalWarning tests/export-selection.test.mjs
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const cwd = process.cwd()
const WEB = existsSync(path.join(cwd, 'src/services/chat/sessionStatsPure.ts'))
  ? cwd
  : existsSync(path.join(cwd, 'web/src/services/chat/sessionStatsPure.ts'))
    ? path.join(cwd, 'web')
    : null
if (!WEB) {
  console.error('找不到 web/src，请在仓库根或 web/ 目录运行')
  process.exit(2)
}
const { mergeSessionRows, filterByTitle, sortSessionRows } = await import(
  pathToFileURL(path.join(WEB, 'src/services/chat/sessionStatsPure.ts')).href
)

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

const summaries = [
  { id: 'a', title: '机械设计基础', createdAt: 100, updatedAt: 500 },
  { id: 'b', title: 'Bug 复现：上传失败', createdAt: 200, updatedAt: 900 },
  { id: 'c', title: '', createdAt: 300, updatedAt: 300 },
  { id: 'd', title: '置顶的老对话', createdAt: 400, updatedAt: 100, pinned: true },
]
const stats = [
  { id: 'a', title: '机械设计基础', pinned: false, createdAt: 100, updatedAt: 500, rounds: 30, hasContent: true },
  { id: 'b', title: 'Bug 复现：上传失败', pinned: false, createdAt: 200, updatedAt: 900, rounds: 3, hasContent: true },
  { id: 'c', title: '', pinned: false, createdAt: 300, updatedAt: 300, rounds: 0, hasContent: false },
  { id: 'd', title: '置顶的老对话', pinned: true, createdAt: 400, updatedAt: 100, rounds: 50, hasContent: true },
]

run('统计未就绪时：列表可先用摘要展示（rounds 0，不显示未同步）', () => {
  const rows = mergeSessionRows(summaries, null)
  assert.equal(rows.length, 4)
  assert.equal(rows[0].rounds, 0)
  assert.equal(rows[0].hasContent, undefined)
})

run('统计合并：轮次/是否有正文按会话 id 对齐', () => {
  const rows = mergeSessionRows(summaries, stats)
  const byId = new Map(rows.map((row) => [row.id, row]))
  assert.equal(byId.get('a').rounds, 30)
  assert.equal(byId.get('c').rounds, 0)
  assert.equal(byId.get('c').hasContent, false)
})

run('最近更新排序：置顶最前，其余按 updatedAt 倒序', () => {
  const rows = sortSessionRows(mergeSessionRows(summaries, stats), 'recent')
  assert.deepEqual(rows.map((row) => row.id), ['d', 'b', 'a', 'c'])
})

run('按轮次排序：置顶最前，其余按轮次倒序（同轮次按更新时间）', () => {
  const rows = sortSessionRows(mergeSessionRows(summaries, stats), 'rounds')
  assert.deepEqual(rows.map((row) => row.id), ['d', 'a', 'b', 'c'])
})

run('搜索标题：大小写不敏感、首尾空格忽略、空串返回全部', () => {
  const rows = mergeSessionRows(summaries, stats)
  assert.deepEqual(filterByTitle(rows, 'bug').map((row) => row.id), ['b'])
  assert.deepEqual(filterByTitle(rows, '  机械 ').map((row) => row.id), ['a'])
  assert.equal(filterByTitle(rows, '').length, 4)
  assert.equal(filterByTitle(rows, '不存在的标题').length, 0)
})

run('排序不修改原数组', () => {
  const rows = mergeSessionRows(summaries, stats)
  const before = rows.map((row) => row.id)
  sortSessionRows(rows, 'rounds')
  assert.deepEqual(rows.map((row) => row.id), before)
})

console.log(`\n结果：${passed} PASS / ${failures.length} FAIL（共 ${passed + failures.length} 组）`)
if (failures.length > 0) {
  process.exitCode = 1
} else {
  console.log('全部通过')
}
