/**
 * 长对话「上下文记忆」的本地存储。
 *
 * 只有用户在"上下文已满"提示上主动点「压缩上下文并继续」时才会写入；
 * 普通聊天完全不会读写这里，也不会改变任何请求内容。
 *
 * 结构：一个会话只保留一份“滚动摘要 + 已覆盖的轮次数”。
 * 发送请求时，被覆盖的早期轮次用这份摘要替代（见 reply.ts 的 toRequestMessages）。
 */
export type ContextMemory = {
  /** 早期对话的滚动摘要（中文要点） */
  summary: string
  /** 已经压缩掉的轮次数（一轮 = 一条提问 + 一条回答） */
  coveredRounds: number
  /**
   * 压缩时覆盖前缀的首条提问 id。
   * 用于校验摘要仍然对应当前分支：切到别的分支/导入替换历史后 id 不匹配，就忽略旧摘要。
   */
  anchorId?: string
  updatedAt: number
}

const KEY_PREFIX = 'ds.chat-context-memory.v1:'

/** 中文场景下保守估算：1 token ≈ 1.6 个字符（宁可高估，提前多压一点） */
export const CHARS_PER_TOKEN = 1.6

export const estimateTokens = (text: string | null | undefined): number => {
  if (!text) {
    return 0
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

const keyOf = (sessionId: string) => `${KEY_PREFIX}${sessionId}`

export const readContextMemory = (sessionId: string): ContextMemory | null => {
  try {
    const raw = localStorage.getItem(keyOf(sessionId))
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<ContextMemory>
    if (
      typeof parsed.summary !== 'string' ||
      !parsed.summary.trim() ||
      typeof parsed.coveredRounds !== 'number' ||
      !(parsed.coveredRounds > 0)
    ) {
      return null
    }
    return {
      summary: parsed.summary,
      coveredRounds: Math.floor(parsed.coveredRounds),
      ...(typeof parsed.anchorId === 'string' && parsed.anchorId ? { anchorId: parsed.anchorId } : {}),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  } catch {
    return null
  }
}

/** 写入成功返回 true；存储满/隐私模式等失败返回 false（调用方必须据此决定是否继续）。 */
export const writeContextMemory = (sessionId: string, memory: ContextMemory): boolean => {
  try {
    localStorage.setItem(keyOf(sessionId), JSON.stringify(memory))
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

/** 清空全部上下文摘要（导入/替换历史、清空全部历史时用）。 */
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
