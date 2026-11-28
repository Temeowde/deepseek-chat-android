/**
 * 启动兜底与启动任务分片：防止再次出现「白屏/卡死/闪退」这一类问题。
 * 运行：node web/tests/startup-safety.test.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const cwd = process.cwd()
const WEB = existsSync(path.join(cwd, 'src/main.tsx'))
  ? cwd
  : existsSync(path.join(cwd, 'web/src/main.tsx'))
    ? path.join(cwd, 'web')
    : null
if (!WEB) {
  console.error('找不到 web/src，请在仓库根或 web/ 目录运行')
  process.exit(2)
}
const read = (rel) => readFileSync(path.join(WEB, rel), 'utf8')

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

run('index.html 有启动遮罩和兜底错误页（不是纯白屏）', () => {
  const html = read('src/index.html')
  assert.match(html, /id="boot-splash"/)
  assert.match(html, /id="boot-fatal"/)
  assert.match(html, /__dsBootReady/)
  assert.match(html, /__dsBootFail/)
  assert.match(html, /启动超时|启动失败/)
  assert.match(html, /重新加载/)
})

run('React 根节点包了 ErrorBoundary，main 中启动调用有 try/catch', () => {
  const main = read('src/main.tsx')
  assert.match(main, /ErrorBoundary/)
  assert.match(main, /try\s*{/)
  assert.match(main, /__dsBootFail/)
  const boundary = read('src/app/ErrorBoundary.tsx')
  assert.match(boundary, /componentDidCatch/)
  assert.match(boundary, /__dsBootFail/)
})

run('App 挂载后通知启动兜底页隐藏遮罩', () => {
  const app = read('src/app/App.tsx')
  assert.match(app, /__dsBootReady\?\.\(\)/)
})

run('IndexedDB 打开有超时，不会无限停在加载页', () => {
  const db = read('src/services/chat/db.ts')
  assert.match(db, /15_000/)
  assert.match(db, /打开超时/)
  assert.match(db, /blocked\(\)/)
})

run('官方后台任务延后、限量、分片，不挤在启动瞬间', () => {
  const sync = read('src/services/official/sync.ts')
  assert.match(sync, /official-dedupe-v1/)
  assert.match(sync, /setTimeout\(resolve, 24\)/)
  assert.match(sync, /1200/)
  const startup = read('src/services/startup.ts')
  assert.match(startup, /DELAY_MS = 5000/)
  assert.match(startup, /backfillMissingBodies\(12\)/)
  assert.doesNotMatch(sync, /registerOfficialSync[\s\S]{0,200}void dedupeStoredOfficialSessions\(\)/)
})

run('原生 WebView 兜底：安全创建 / 渲染进程崩溃 / 加载失败', () => {
  const java = read('../src/java/com/temeowde/dschat/ChatRecovery.java')
  assert.match(java, /createWebView/)
  assert.match(java, /onRenderProcessGone/)
  assert.match(java, /onReceivedError/)
  const client = read('../src/smali_classes2/com/temeowde/dschat/MainActivity$1.smali')
  assert.match(client, /onRenderProcessGone/)
  assert.match(client, /ChatRecovery;->onRenderProcessGone/)
  const activity = read('../src/smali_classes2/com/temeowde/dschat/MainActivity.smali')
  assert.match(activity, /android\/webkit\/WebView/)
})

console.log(`\n结果：${passed} PASS / ${failures.length} FAIL（共 ${passed + failures.length} 组）`)
if (failures.length > 0) {
  process.exitCode = 1
} else {
  console.log('全部通过')
}
