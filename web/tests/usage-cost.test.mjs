/**
 * 本轮消耗额度：单价/时段/占用率估算的单元验证。
 *   cd web
 *   node --experimental-transform-types --disable-warning=ExperimentalWarning tests/usage-cost.test.mjs
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const cwd = process.cwd()
const WEB = existsSync(path.join(cwd, 'src/services/chat/usageCost.ts'))
  ? cwd
  : existsSync(path.join(cwd, 'web/src/services/chat/usageCost.ts'))
    ? path.join(cwd, 'web')
    : null
if (!WEB) {
  console.error('找不到 web/src，请在仓库根或 web/ 目录运行')
  process.exit(2)
}
const SRC = path.join(WEB, 'src')
const { estimateUsageCost, formatTokens, formatYuan, isPeakTime, priceForModel } = await import(
  pathToFileURL(path.join(SRC, 'services/chat/usageCost.ts')).href
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

const usage = {
  input_tokens: 161,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 768,
  output_tokens: 240,
}

// 北京时间周六 10:00 → 空闲
const SAT_10 = Date.parse('2026-11-28T02:00:00Z')
// 北京时间周五 10:00 → 高峰
const FRI_10 = Date.parse('2026-11-27T02:00:00Z')

run('flash 空闲时段：与官方截图数字一致（0.00113636 元）', () => {
  const cost = estimateUsageCost(usage, 'deepseek-flash', SAT_10)
  assert.equal(cost.tier, 'idle')
  assert.equal(cost.cacheHitTokens, 768)
  assert.equal(cost.cacheMissTokens, 161)
  assert.equal(cost.outputTokens, 240)
  assert.equal(formatYuan(cost.totalCost), '0.00113636')
  assert.equal(cost.promptTokens, 929)
})

run('flash 高峰时段：命中/未命中/输出都翻倍', () => {
  const cost = estimateUsageCost(usage, 'deepseek-flash', FRI_10)
  assert.equal(cost.tier, 'peak')
  assert.equal(formatYuan(cost.totalCost), '0.00227272')
})

run('v4-pro 空闲时段单价（0.15 / 4.5 / 13.5）', () => {
  const cost = estimateUsageCost(usage, 'deepseek-v4-pro', SAT_10)
  assert.equal(cost.known, true)
  assert.equal(formatYuan(cost.totalCost), '0.0040797')
})

run('claude-* 按官方映射回 DeepSeek 单价', () => {
  assert.equal(priceForModel('claude-opus-5-5'), priceForModel('deepseek-v4-pro'))
  assert.equal(priceForModel('claude-sonnet-5-5'), priceForModel('deepseek-flash'))
})

run('未知模型：只给 token 用量，不算金额和占用率', () => {
  const cost = estimateUsageCost(usage, 'gpt-4o', SAT_10)
  assert.equal(cost.known, false)
  assert.equal(cost.totalCost, null)
  assert.equal(cost.contextPercent, null)
  assert.equal(cost.promptTokens, 929)
})

run('cache_creation 计入未命中输入', () => {
  const cost = estimateUsageCost(
    { input_tokens: 100, cache_creation_input_tokens: 50, cache_read_input_tokens: 850, output_tokens: 10 },
    'deepseek-flash',
    SAT_10
  )
  assert.equal(cost.cacheMissTokens, 150)
  assert.equal(cost.promptTokens, 1000)
})

run('上下文占用率按 1,048,576 窗口计算（API 实测上限）', () => {
  const cost = estimateUsageCost(
    { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 },
    'deepseek-flash',
    SAT_10
  )
  assert.equal(cost, null)
  const big = estimateUsageCost(
    { input_tokens: 100_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 },
    'deepseek-flash',
    SAT_10
  )
  // 100,000 / 1,048,576 = 9.5367% → 保留 1 位 9.5
  assert.equal(Math.round(big.contextPercent * 10) / 10, 9.5)
  const full = estimateUsageCost(
    { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_048_576, output_tokens: 1 },
    'deepseek-flash',
    SAT_10
  )
  assert.equal(Math.round(full.contextPercent), 100)
})

run('高峰时段边界：9:00-12:00、14:00-18:00（北京时间）', () => {
  const at = (utc) => Date.parse(utc)
  assert.equal(isPeakTime(at('2026-11-27T01:00:00Z')), true) // 09:00
  assert.equal(isPeakTime(at('2026-11-27T03:59:00Z')), true) // 11:59
  assert.equal(isPeakTime(at('2026-11-27T04:00:00Z')), false) // 12:00
  assert.equal(isPeakTime(at('2026-11-27T05:59:00Z')), false) // 13:59
  assert.equal(isPeakTime(at('2026-11-27T06:00:00Z')), true) // 14:00
  assert.equal(isPeakTime(at('2026-11-27T09:59:00Z')), true) // 17:59
  assert.equal(isPeakTime(at('2026-11-27T10:00:00Z')), false) // 18:00
  assert.equal(isPeakTime(at('2026-11-28T02:00:00Z')), false) // 周六 10:00
  assert.equal(isPeakTime(at('2026-11-30T02:00:00Z')), true) // 周一 10:00
})

run('数字格式化：金额去尾零、token 千分位', () => {
  assert.equal(formatYuan(0), '0')
  assert.equal(formatYuan(0.02), '0.02')
  assert.equal(formatYuan(1), '1')
  assert.equal(formatYuan(1.5), '1.5')
  assert.equal(formatTokens(1234), '1,234')
  assert.equal(formatTokens(0), '0')
})

console.log(`\n结果：${passed} PASS / ${failures.length} FAIL（共 ${passed + failures.length} 组）`)
if (failures.length > 0) {
  process.exitCode = 1
} else {
  console.log('全部通过')
}
