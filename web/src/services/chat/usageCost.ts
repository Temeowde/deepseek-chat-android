import type { MessageUsage } from '../api/types.js'

/**
 * 单轮消耗估算。
 *
 * 单价来自 DeepSeek 官方价格页（元 / 百万 tokens）：
 *   deepseek-flash   空闲 0.02 / 1 / 4      高峰 0.04 / 2 / 8
 *   deepseek-v4-pro  空闲 0.15 / 4.5 / 13.5 高峰 0.30 / 9 / 27
 * 顺序为：输入（缓存命中）/ 输入（缓存未命中）/ 输出。
 *
 * 高峰时段：北京时间周一至周五 9:00-12:00、14:00-18:00（法定节假日官方也按空闲，
 * 但本地无法可靠判断节假日，这里按周一至周五近似；界面上写「价格估算」）。
 */

export type UsagePrice = {
  /** 输入缓存命中，元 / 百万 tokens */
  cacheHit: number
  /** 输入缓存未命中，元 / 百万 tokens */
  cacheMiss: number
  /** 输出，元 / 百万 tokens */
  output: number
}

export type UsageTier = 'peak' | 'idle'

export type ModelPricing = {
  /** 模型上下文窗口（tokens），用于「上下文已占用 %」 */
  contextTokens: number
  idle: UsagePrice
  peak: UsagePrice
}

const FLASH: ModelPricing = {
  // 真实窗口是 2^20 = 1,048,576（实测溢出报错原文：
  // "This model's maximum context length is 1048576 tokens"），不是 1,000,000。
  contextTokens: 1_048_576,
  idle: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
}

const PRO: ModelPricing = {
  contextTokens: 1_048_576,
  idle: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
  peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
}

/** 官方接口会做 claude-* → deepseek-* 的映射，历史消息里可能留着映射前的名字 */
const PRICING_MODELS: [RegExp, ModelPricing][] = [
  [/^deepseek-flash$/i, FLASH],
  [/^deepseek-v4-flash$/i, FLASH],
  [/^deepseek-v4-pro$/i, PRO],
  [/^claude-opus/i, PRO],
  [/^claude/i, FLASH],
]

export const priceForModel = (model: string | null | undefined): ModelPricing | null => {
  if (!model) {
    return null
  }
  for (const [pattern, pricing] of PRICING_MODELS) {
    if (pattern.test(model)) {
      return pricing
    }
  }
  return null
}

const SHANGHAI_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** 请求时间是否处于官方「高峰时段」 */
export const isPeakTime = (at: number): boolean => {
  if (!Number.isFinite(at)) {
    return false
  }
  const parts = SHANGHAI_FORMAT.formatToParts(new Date(at))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  const weekday = get('weekday')
  if (weekday === 'Sat' || weekday === 'Sun') {
    return false
  }
  const hour = Number(get('hour'))
  const minute = Number(get('minute'))
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return false
  }
  const minutes = hour * 60 + minute
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)
}

export type UsageCostBreakdown = {
  model: string | null
  /** 是否认识这个模型的单价 */
  known: boolean
  tier: UsageTier
  /** 命中/未命中/输出三档单价（元 / 百万 tokens）；未知模型为 null */
  rates: UsagePrice | null
  cacheHitTokens: number
  cacheMissTokens: number
  outputTokens: number
  /** 本轮请求的输入 tokens（命中 + 未命中） */
  promptTokens: number
  cacheHitCost: number | null
  cacheMissCost: number | null
  outputCost: number | null
  totalCost: number | null
  /** 截止本轮，输入 tokens 占上下文窗口的比例（0~100） */
  contextPercent: number | null
}

const toCount = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/**
 * 根据 usage 估算本轮费用。
 * `at` 用来判断高峰/空闲时段，传回复开始时的时间（message.createdAt）。
 */
export const estimateUsageCost = (
  usage: MessageUsage | null | undefined,
  model: string | null | undefined,
  at: number
): UsageCostBreakdown | null => {
  if (!usage) {
    return null
  }
  const cacheHitTokens = toCount(usage.cache_read_input_tokens)
  const cacheMissTokens = toCount(usage.input_tokens) + toCount(usage.cache_creation_input_tokens)
  const outputTokens = toCount(usage.output_tokens)
  if (cacheHitTokens + cacheMissTokens + outputTokens === 0) {
    return null
  }
  const tier: UsageTier = isPeakTime(at) ? 'peak' : 'idle'
  const pricing = priceForModel(model)
  const promptTokens = cacheHitTokens + cacheMissTokens
  if (!pricing) {
    return {
      model: model ?? null,
      known: false,
      tier,
      rates: null,
      cacheHitTokens,
      cacheMissTokens,
      outputTokens,
      promptTokens,
      cacheHitCost: null,
      cacheMissCost: null,
      outputCost: null,
      totalCost: null,
      contextPercent: null,
    }
  }
  const rates = pricing[tier]
  const cacheHitCost = (cacheHitTokens * rates.cacheHit) / 1_000_000
  const cacheMissCost = (cacheMissTokens * rates.cacheMiss) / 1_000_000
  const outputCost = (outputTokens * rates.output) / 1_000_000
  return {
    model: model ?? null,
    known: true,
    tier,
    rates,
    cacheHitTokens,
    cacheMissTokens,
    outputTokens,
    promptTokens,
    cacheHitCost,
    cacheMissCost,
    outputCost,
    totalCost: cacheHitCost + cacheMissCost + outputCost,
    contextPercent: (promptTokens / pricing.contextTokens) * 100,
  }
}

/** 金额展示：保留到 8 位小数并去掉尾零（官方面板同样精确到 0.00000001 元） */
export const formatYuan = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '—'
  }
  if (value === 0) {
    return '0'
  }
  if (value >= 1) {
    return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  }
  return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
}

/** 消息底部小标签用：最多 4~6 位有效数字，避免太长 */
export const formatYuanCompact = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '—'
  }
  if (value === 0) {
    return '0'
  }
  if (value >= 0.01) {
    return value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  }
  if (value >= 0.0001) {
    return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  }
  return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
}

/** token 数展示：1234 → 1,234 */
export const formatTokens = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '0'
  }
  return Math.max(0, Math.floor(value)).toLocaleString('en-US')
}
