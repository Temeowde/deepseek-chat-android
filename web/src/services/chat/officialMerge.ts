import type { Message } from './types.js'

/** 取一条消息的纯文本（用户取 content，助手取 text 块拼接） */
export const messagePlainText = (message: Message): string => {
  if (message.role === 'user') {
    return message.content
  }
  return message.blocks
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
}

/** 内容指纹：角色 + 去掉所有空白后的全文；空文本返回空串（空回答不能拿来去重） */
export const messageContentKey = (message: Message): string => {
  const text = messagePlainText(message).replace(/\s+/g, '')
  return text ? `${message.role}|${text}` : ''
}

/**
 * 官方消息 + 本地消息合并（按内容去重，只增不减）。
 *
 * 背景：官方同步返回的消息 id 是 o_*，而导入归档/API 续聊的消息 id 是数字或 UUID；
 * 以前只按 id 判断本地独有，结果同一段问答在官方和本地各有一份 → 会话里出现成对重复。
 * 这里在保留全部官方消息的前提下：
 * - id 已在官方里的本地消息跳过；
 * - 和官方（或前面已保留的本地消息）内容完全相同的本地消息跳过（重复）；
 * - 其余本地消息按 createdAt 插到官方消息序列里（本地独有内容一条不丢）。
 */
export const mergeOfficialWithLocal = (
  official: readonly Message[],
  local: readonly Message[]
): { messages: Message[]; deduped: number } => {
  const knownIds = new Set(official.map((message) => message.id))
  const seen = new Set<string>()
  for (const message of official) {
    const key = messageContentKey(message)
    if (key) {
      seen.add(key)
    }
  }
  const merged = [...official]
  let deduped = 0
  const candidates = local
    .filter((message) => !knownIds.has(message.id))
    .sort((left, right) => left.createdAt - right.createdAt)
  for (const message of candidates) {
    const key = messageContentKey(message)
    if (key && seen.has(key)) {
      deduped += 1
      continue
    }
    if (key) {
      seen.add(key)
    }
    // 按时间插到官方序列中的对应位置
    let index = merged.length
    for (let i = merged.length - 1; i >= 0; i -= 1) {
      if (merged[i].createdAt <= message.createdAt) {
        index = i + 1
        break
      }
      index = i
    }
    merged.splice(index, 0, message)
  }
  return { messages: merged, deduped }
}

/** 会话里是否存在内容完全重复的消息（同内容或同 id），用于决定是否在同步时顺手去重 */
export const hasDuplicateMessages = (messages: readonly Message[]): boolean => {
  const ids = new Set<string>()
  const keys = new Set<string>()
  for (const message of messages) {
    if (ids.has(message.id)) {
      return true
    }
    ids.add(message.id)
    const key = messageContentKey(message)
    if (key) {
      if (keys.has(key)) {
        return true
      }
      keys.add(key)
    }
  }
  return false
}

/**
 * 就地清理一个官方会话里的重复消息（不联网）。
 *
 * 只把 id 以 o_ 开头的消息当作「官方版本」，其余（导入/本地续聊）里凡是与官方版本
 * 内容完全相同的副本都去掉——被删掉的每条内容在官方消息里都还有一份，所以不会少内容。
 * 本地独有的消息（比如导入后新发的几条）原样保留。
 */
export const dedupeOfficialSessionMessages = (
  messages: readonly Message[]
): { messages: Message[]; deduped: number } => {
  const official: Message[] = []
  const local: Message[] = []
  for (const message of messages) {
    if (message.id.startsWith('o_')) {
      official.push(message)
    } else {
      local.push(message)
    }
  }
  if (official.length === 0 || local.length === 0) {
    return { messages: [...messages], deduped: 0 }
  }
  return mergeOfficialWithLocal(official, local)
}
