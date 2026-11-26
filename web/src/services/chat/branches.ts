import type { Message, Session } from './types.js'

/*
 * 根消息的 parentId 在本地是 null，而官方同步曾经省略该字段写成 undefined。
 * 分支判断必须把两者都当成「根」，否则官方会话里的根分支（会话第一条提问的多个版本）
 * 切换时找不到父节点，点击分支按钮不会改变任何内容。
 */
const parentKeyOf = (message: Message): string | null => message.parentId ?? null

/** 将线性消息列表规范化为单分支，保留消息 ID、内容及时间。 */
export const normalizeSession = (session: Session): Session =>
  session.rootMessageId !== undefined
    ? session
    : {
        ...session,
        rootMessageId: session.messages[0]?.id ?? null,
        messages: session.messages.map((message, index, messages) => ({
          ...message,
          parentId: messages[index - 1]?.id ?? null,
          selectedChildId: messages[index + 1]?.id,
        })),
      }

/** 展示内容与请求上下文共用当前选中的分支路径。 */
export const getVisibleMessages = (session: Session): Message[] => {
  if (session.rootMessageId === undefined) {
    return session.messages
  }
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const path: Message[] = []
  let id = session.rootMessageId
  while (id) {
    const message = byId.get(id)
    if (!message) {
      break
    }
    path.push(message)
    byId.delete(id)
    id = message.selectedChildId ?? null
  }
  return path
}

/**
 * 修正「可见链停在用户消息上」的旧数据。
 *
 * 官方 chat_session.current_message_id 有时停在那条提问上（它是会话游标，不是最后一条消息），
 * 早先的同步代码照抄这个游标，把下面已有的 AI 回复当成未选中的分支隐藏了 ——
 * 表现就是最后一轮只同步过来一句提问、翻到底也没有回答。
 *
 * 这里对已缓存的会话做一次就地修复：可见链末尾若是用户消息且它下面有回复，
 * 就选中最新的那条回复，继续往下走，直到停在一条 assistant 或真正的叶子。
 * 幂等：已经正常的会话原样返回（同一个对象引用，不会触发重渲染）。
 */
export const repairVisibleTail = (session: Session): Session => {
  if (session.rootMessageId === undefined || session.rootMessageId === null) {
    return session
  }
  const children = new Map<string | null, Message[]>()
  for (const message of session.messages) {
    const key = message.parentId ?? null
    const list = children.get(key)
    if (list) {
      list.push(message)
    } else {
      children.set(key, [message])
    }
  }
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const path: Message[] = []
  const seen = new Set<string>()
  let cursor: string | null = session.rootMessageId
  while (cursor) {
    const message = byId.get(cursor)
    if (!message || seen.has(message.id)) {
      break
    }
    seen.add(message.id)
    path.push(message)
    cursor = message.selectedChildId ?? null
  }
  const last = path.at(-1)
  if (!last || last.role !== 'user') {
    return session
  }
  // 末尾是用户消息：如果有回复，就顺下去（重新生成过就取最新那条）
  const replies = session.messages.filter((m) => (m.parentId ?? null) === last.id)
  if (replies.length === 0) {
    return session
  }
  const next = [...replies].sort((a, b) => a.createdAt - b.createdAt).at(-1)!
  const patched = new Map<string, string | undefined>([[last.id, next.id]])
  let tail: Message | undefined = next
  while (tail) {
    const kids = (children.get(tail.id) ?? []).sort((a, b) => a.createdAt - b.createdAt)
    const only = kids.at(-1)
    if (!only) {
      patched.set(tail.id, undefined)
      break
    }
    patched.set(tail.id, only.id)
    tail = only
  }
  return {
    ...session,
    messages: session.messages.map((message) =>
      patched.has(message.id) ? { ...message, selectedChildId: patched.get(message.id) } : message
    ),
  }
}

export type MessageVersions = { ids: string[]; index: number }

/** 一次遍历收集兄弟版本；版本列表未变化时复用旧对象与索引，避免流式正文更新重绘历史消息。 */
export const buildMessageVersions = (
  session: Session,
  previous: ReadonlyMap<string, MessageVersions>
): ReadonlyMap<string, MessageVersions> => {
  const groups = new Map<string | null, string[]>()
  for (const message of session.messages) {
    // 线性会话按自身归组；有根标记的会话按父节点归组，null/undefined 统一为同一个根分组。
    const key = session.rootMessageId === undefined ? message.id : parentKeyOf(message)
    const ids = groups.get(key)
    if (ids) {
      ids.push(message.id)
    } else {
      groups.set(key, [message.id])
    }
  }

  const versions = new Map<string, MessageVersions>()
  let unchanged = previous.size === session.messages.length
  for (const ids of groups.values()) {
    const cachedIds = previous.get(ids[0])?.ids
    const stableIds =
      cachedIds?.length === ids.length && ids.every((id, index) => id === cachedIds[index])
        ? cachedIds
        : ids
    ids.forEach((id, index) => {
      const cached = previous.get(id)
      const version =
        cached?.ids === stableIds && cached.index === index ? cached : { ids: stableIds, index }
      versions.set(id, version)
      if (version !== cached) {
        unchanged = false
      }
    })
  }
  return unchanged ? previous : versions
}

/** 新消息挂在指定父节点下，并选择新分支；原节点与其后续对话保持不变。 */
export const appendBranch = (
  original: Session,
  parentId: string | null,
  messages: Message[]
): Session => {
  const session = normalizeSession(original)
  const first = messages[0]
  if (!first) {
    return session
  }
  return {
    ...session,
    rootMessageId: parentId === null ? first.id : session.rootMessageId,
    messages: [
      ...session.messages.map((message) =>
        message.id === parentId ? { ...message, selectedChildId: first.id } : message
      ),
      ...messages.map((message, index) => ({
        ...message,
        parentId: messages[index - 1]?.id ?? parentId,
        selectedChildId: messages[index + 1]?.id,
      })),
    ],
  }
}

/** 选中命中消息的祖先路径，保留该消息下已有的版本选择。 */
export const selectPathToMessage = (original: Session, messageId: string): Session | null => {
  if (getVisibleMessages(original).some((message) => message.id === messageId)) return original
  const session = normalizeSession(original)
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  let current = byId.get(messageId)
  if (!current) return null
  const selections = new Map<string, string>()
  // 用 parentKeyOf 判断根：官方消息的根是 undefined，只写 !== null 会让循环提前失败。
  while (parentKeyOf(current) !== null) {
    const parentId = parentKeyOf(current)!
    if (selections.has(parentId)) return null
    const parent = byId.get(parentId)
    if (!parent) return null
    selections.set(parent.id, current.id)
    current = parent
  }
  return {
    ...session,
    rootMessageId: current.id,
    messages: session.messages.map((message) => {
      const childId = selections.get(message.id)
      return childId && message.selectedChildId !== childId ? { ...message, selectedChildId: childId } : message
    }),
  }
}

/** 仅允许切换当前路径上某一节点的兄弟版本，恢复该版本已选中的后续分支。 */
export const selectVersion = (original: Session, messageId: string): Session => {
  const session = normalizeSession(original)
  const message = session.messages.find((item) => item.id === messageId)
  const parentId = message ? parentKeyOf(message) : null
  if (!message || !getVisibleMessages(session).some((item) => parentKeyOf(item) === parentId)) {
    return original
  }
  /*
   * 根分支靠 rootMessageId 表达，子分支靠父节点的 selectedChildId 表达。
   * 官方同步的根消息 parent 是 undefined：以前这里写 parentId === null，
   * 于是根版本被当成子版本处理 —— 既没有改 rootMessageId、也匹配不到父节点，
   * 会话原样返回（store 里还写了一次库），用户看到的就是「点了切换没反应」。
   */
  return {
    ...session,
    rootMessageId: parentId === null ? message.id : session.rootMessageId,
    messages: session.messages.map((item) =>
      item.id === parentId ? { ...item, selectedChildId: message.id } : item
    ),
  }
}
