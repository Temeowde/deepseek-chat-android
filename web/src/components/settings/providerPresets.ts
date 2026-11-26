/**
 * 自定义 API 的常见供应商预设。
 *
 * 只放「固定 Base URL + API Key + OpenAI Chat Completions」的供应商：
 * DSH/pi-ai 内置目录里符合这个条件的 21 个，加上国内常用的 5 个 DeepSeek 供应商。
 * 其它 Anthropic / Responses / Bedrock / Azure / OAuth 供应商没有放进来，因为
 * 安卓端的自定义通道只实现了 OpenAI Chat Completions，加进来也连不上。
 */
export type ProviderPreset = {
  id: string
  label: string
  baseUrl: string
  model: string
  /** 默认展示的常用项 */
  common?: boolean
  /** 选中后显示在预设下方的小提示 */
  note?: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  // 国内常用的 DeepSeek 第三方供应商
  {
    id: 'siliconflow',
    label: '硅基流动',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    common: true,
  },
  {
    id: 'dashscope',
    label: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'deepseek-v3',
    common: true,
    note: '新版百炼可能要求在控制台复制专属 Base URL；这里填的是通用兼容地址。',
  },
  {
    id: 'lkeap',
    label: '腾讯云 LKEAP',
    baseUrl: 'https://api.lkeap.cloud.tencent.com/v1',
    model: 'deepseek-v3',
  },
  // 第二行再放一个国内常用 + OpenCode Go；其余国外供应商收进「更多」
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    model: 'deepseek-v4.1-flash',
    common: true,
    note: '订阅制；需要 OpenCode Go 控制台里的 API Key。',
  },
  {
    id: 'ark',
    label: '火山方舟',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: '',
    common: true,
    note: '火山方舟的「模型」要填控制台创建的 ep- 接入点 ID，不是模型名。',
  },
  {
    id: 'qianfan',
    label: '百度千帆',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    model: 'deepseek-v3',
    common: true,
  },

  // DSH 内置的 OpenAI 兼容供应商
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'deepseek/deepseek-chat',
  },
  {
    id: 'together',
    label: 'Together',
    baseUrl: 'https://api.together.ai/v1',
    model: 'deepseek-ai/DeepSeek-V4.1-Flash',
  },
  {
    id: 'fireworks',
    label: 'Fireworks',
    baseUrl: 'https://api.fireworks.ai/inference',
    model: 'accounts/fireworks/models/deepseek-v4p1-flash',
  },
  {
    id: 'ant-ling',
    label: 'Ant Ling',
    baseUrl: 'https://api.ant-ling.com/v1',
    model: 'Ling-2.6-1T',
  },
  {
    id: 'baseten',
    label: 'Baseten',
    baseUrl: 'https://inference.baseten.co/v1',
    model: 'deepseek-ai/DeepSeek-V4.1-Flash',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    model: 'gpt-oss-120b',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek 官方（自定义）',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    baseUrl: 'https://router.huggingface.co/v1',
    model: 'deepseek-ai/DeepSeek-V3',
  },
  {
    id: 'moonshotai',
    label: 'Moonshot AI',
    baseUrl: 'https://api.moonshot.ai/v1',
    model: 'kimi-k2.6',
  },
  {
    id: 'moonshotai-cn',
    label: 'Moonshot AI 国内',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2.6',
  },
  {
    id: 'nvidia',
    label: 'NVIDIA',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'meta/llama-3.3-70b-instruct',
  },
  {
    id: 'qwen-token-plan',
    label: 'Qwen Token Plan',
    baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    model: 'deepseek-v3.2',
  },
  {
    id: 'qwen-token-plan-cn',
    label: 'Qwen Token Plan 国内',
    baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    model: 'deepseek-v3.2',
  },
  {
    id: 'qwen-token-plan-individual',
    label: 'Qwen Token Plan 个人',
    baseUrl: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    model: 'deepseek-v4-flash-0731',
  },
  {
    id: 'xiaomi',
    label: 'Xiaomi',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.5',
  },
  {
    id: 'xiaomi-token-plan-ams',
    label: 'Xiaomi Token Plan AMS',
    baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
    model: 'mimo-v2.5',
  },
  {
    id: 'xiaomi-token-plan-cn',
    label: 'Xiaomi Token Plan 国内',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
    model: 'mimo-v2.5',
  },
  {
    id: 'xiaomi-token-plan-sgp',
    label: 'Xiaomi Token Plan SGP',
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
    model: 'mimo-v2.5',
  },
  {
    id: 'zai',
    label: 'Z.AI',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    model: 'glm-4.7',
  },
  {
    id: 'zai-coding-cn',
    label: 'Z.AI Coding CN',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    model: 'glm-5.3',
  },
]
