/**
 * WorkBuddy 可用模型。
 *
 * 这些 id 直接发给上游 `/v2/chat/completions`；积分倍率只用于设置页提示，
 * 不参与计费判断（真实扣费以返回的 usage/credit 为准）。
 */
export type WorkBuddyModel = {
  id: string
  name: string
  /** 积分倍率，0 表示当前免费 */
  credit: number
  /** 设置页的一行说明 */
  hint: string
  /** 是否建议展示思考过程 */
  reasoning: boolean
}

export const WORKBUDDY_MODELS: WorkBuddyModel[] = [
  {
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek-V4.1-Flash',
    credit: 0.11,
    hint: '1M 上下文，日常首选',
    reasoning: true,
  },
  {
    id: 'hy4flash-free',
    name: 'Hy4 Flash（限时免费）',
    credit: 0,
    hint: '免费试用至 11 月 30 日',
    reasoning: true,
  },
  {
    id: 'hy4std',
    name: 'Hy4',
    credit: 0.29,
    hint: '混元旗舰，长上下文',
    reasoning: true,
  },
  {
    id: 'glm-5.3-flash',
    name: 'GLM-5.3-Flash',
    credit: 0.08,
    hint: '轻量快速，成本低',
    reasoning: true,
  },
  {
    id: 'kimi-k2.8-preview',
    name: 'Kimi-K2.8-Preview',
    credit: 0.77,
    hint: '长文本阅读与写作',
    reasoning: true,
  },
  {
    id: 'minimax-m3.1-flash',
    name: 'MiniMax-M3.1-Flash',
    credit: 0.08,
    hint: '轻量多模态',
    reasoning: true,
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek-V4-Pro',
    credit: 0.51,
    hint: '复杂推理与代码',
    reasoning: true,
  },
]

export const DEFAULT_WORKBUDDY_MODEL = 'deepseek-v4.1-flash'

export const workBuddyModelOf = (id: string): WorkBuddyModel =>
  WORKBUDDY_MODELS.find((model) => model.id === id) ?? WORKBUDDY_MODELS[0]

export const workBuddyModelLabel = (model: WorkBuddyModel): string =>
  model.credit > 0 ? `${model.name} · ${model.credit} 积分` : `${model.name} · 免费`

export const workBuddyModelHint = (id: string): string => workBuddyModelOf(id).hint
