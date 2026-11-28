/**
 * 长对话「上下文记忆」的本地存储。
 *
 * 设计原则（防止压缩次数越多质量越差）：
 *   - **只追加、不改写**：每个 segment 只根据一段原始对话生成一次，之后永远不再参与摘要；
 *   - **压缩深度恒为 1**：请求里放的是「每段原文压一次的摘要」，不会对摘要再摘要；
 *   - 段数超上限时，合并最早两段也必须回到原始消息重新生成（原始消息还在本地），而不是合并两份摘要。
 *
 * 普通聊天完全不读这里；只有用户点压缩、或后台自动省钱压缩时才写入。
 */

export type ContextSegment = {
  /** 该段摘要（只根据原始对话生成，之后不再改写） */
  summary: string
  /** 覆盖 rounds 数组的起始下标（含） */
  from: number
  /** 覆盖 rounds 数组的结束下标（不含） */
  to: number
}

export type ContextMemory = {
  /** 早期对话的滚动摘要段，按时间顺序排列 */
  segments: ContextSegment[]
  /** 已覆盖的轮次数（= 有效 segment 的 to 最大值；便于旧逻辑兼容） */
  coveredRounds: number
  /**
   * 压缩时覆盖前缀的首条提问 id。
   * 用于校验摘要仍然对应当前分支：切到别的分支/导入替换历史后 id 不匹配，就忽略旧摘要。
   */
  anchorId?: string
  updatedAt: number
}

const KEY_PREFIX = 'ds.chat-context-memory.v1:'

/**
 * 中英混合场景的保守估算：1 token ≈ 1.2 个字符。
 * 实测中文对话约 1.2~1.5 字符/token，取 1.2 宁可高估 token（多压一点），
 * 避免「估算已压够、实际还超限」导致压缩后重发又爆满的死循环。
 */
export const CHARS_PER_TOKEN = 1.2

export const estimateTokens = (text: string | null | undefined): number => {
  if (!text) {
    return 0
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

const keyOf = (sessionId: string) => `${KEY_PREFIX}${sessionId}`

const isSegment = (value: unknown): value is ContextSegment => {
  if (!value || typeof value !== 'object') {
    return false
  }
  const segment = value as Partial<ContextSegment>
  return (
    typeof segment.summary === 'string' &&
    segment.summary.trim() !== '' &&
    typeof segment.from === 'number' &&
    typeof segment.to === 'number' &&
    Number.isFinite(segment.from) &&
    Number.isFinite(segment.to) &&
    segment.to > segment.from
  )
}

/** 把旧版「单份 summary」迁移成一段 segment，读旧数据不需要用户重压 */
const migrate = (parsed: Record<string, unknown>): ContextMemory | null => {
  if (Array.isArray(parsed.segments)) {
    const segments = parsed.segments.filter(isSegment).map((segment) => ({
      summary: segment.summary,
      from: Math.max(0, Math.floor(segment.from)),
      to: Math.max(0, Math.floor(segment.to)),
    }))
    if (segments.length === 0) {
      return null
    }
    const coveredRounds = Math.max(
      ...segments.map((segment) => segment.to),
      0
    )
    return {
      segments,
      coveredRounds,
      ...(typeof parsed.anchorId === 'string' && parsed.anchorId ? { anchorId: parsed.anchorId } : {}),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  }
  // v1：{ summary, coveredRounds } → 一段覆盖 [0, coveredRounds)
  if (
    typeof parsed.summary === 'string' &&
    parsed.summary.trim() &&
    typeof parsed.coveredRounds === 'number' &&
    parsed.coveredRounds > 0
  ) {
    const covered = Math.floor(parsed.coveredRounds)
    return {
      segments: [{ summary: parsed.summary, from: 0, to: covered }],
      coveredRounds: covered,
      ...(typeof parsed.anchorId === 'string' && parsed.anchorId ? { anchorId: parsed.anchorId } : {}),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  }
  return null
}

export const readContextMemory = (sessionId: string): ContextMemory | null => {
  try {
    const raw = localStorage.getItem(keyOf(sessionId))
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    return migrate(parsed)
  } catch {
    return null
  }
}

/** 写入成功返回 true；存储满/隐私模式等失败返回 false（调用方必须据此决定是否继续） */
export const writeContextMemory = (sessionId: string, memory: ContextMemory): boolean => {
  try {
    const data = {
      version: 2,
      segments: memory.segments,
      coveredRounds: memory.coveredRounds,
      ...(memory.anchorId ? { anchorId: memory.anchorId } : {}),
      updatedAt: memory.updatedAt,
    }
    localStorage.setItem(keyOf(sessionId), JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

export const clearContextMemory = (sessionId: string) => {
  try {
    localStorage.removeItem(keyOf(sessionId))
  } catch {
    // ignore
  }
}

/** 清空全部上下文摘要（导入/替换历史、清空全部历史时用） */
export const clearAllContextMemories = () => {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key && key.startsWith(KEY_PREFIX)) {
        keys.push(key)
      }
    }
    for (const key of keys) {
      localStorage.removeItem(key)
    }
  } catch {
    // ignore
  }
}

/** 请求里注入的摘要文本：多段带编号，段内容永远不变（保证前缀稳定、缓存可命中） */
export const memorySummaryText = (memory: ContextMemory): string => {
  if (memory.segments.length === 1) {
    return memory.segments[0].summary
  }
  return memory.segments
    .map((segment, index) => `【第 ${index + 1}/${memory.segments.length} 段】${segment.summary}`)
    .join('\n\n')
}

export const memorySummaryTokens = (memory: ContextMemory): number =>
  estimateTokens(memorySummaryText(memory))
