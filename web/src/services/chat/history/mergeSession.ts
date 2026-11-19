import { createId } from '../../../utils/id.js'
import { normalizeSession } from '../branches.js'
import type { Message, Session } from '../types.js'
import { archivedMessageKey } from './toArchive.js'

/** 相同问答复用，内容已分岔的版本作为同一父消息的其他分支加入。 */
export const mergeArchivedSession = (original: Session, incoming: Session): Session => {
  const local = normalizeSession(original)
  const nodes = new Map(local.messages.map(message => [message.id, message]))
  const siblings = new Map<string | null, Map<string, Message[]>>()
  for (const message of local.messages) {
    const parent = message.parentId ?? null
    let byContent = siblings.get(parent)
    if (!byContent) siblings.set(parent, byContent = new Map())
    const key = archivedMessageKey(message)
    const versions = byContent.get(key)
    if (versions) versions.push(message)
    else byContent.set(key, [message])
  }

  const mapped = new Map<string, string>()
  const matched = new Set<string>()
  let changed = false
  // 导入器已校验父子关系，并按父节点在前的顺序整理消息。
  for (const message of incoming.messages) {
    const parent = message.parentId ? mapped.get(message.parentId) : null
    if (parent === undefined) throw new Error('Missing parent in validated history')
    const versions = siblings.get(parent)?.get(archivedMessageKey(message))
    const match = versions?.find(version => version.id === message.id && !matched.has(version.id)) ??
      versions?.find(version => !matched.has(version.id))
    if (match) {
      mapped.set(message.id, match.id)
      matched.add(match.id)
      if (match.role === 'user' && message.role === 'user') {
        const files = match.files.map((file, index) => {
          const mimeType = message.files[index]?.mimeType
          return !file.mimeType && mimeType ? { ...file, mimeType } : file
        })
        if (files.some((file, index) => file !== match.files[index])) {
          nodes.set(match.id, { ...match, files })
          changed = true
        }
      }
      continue
    }
    let id = message.id
    while (nodes.has(id)) id = createId()
    mapped.set(message.id, id)
    nodes.set(id, { ...message, id, parentId: parent, selectedChildId: undefined })
    changed = true
  }
  if (!changed) return original

  // 本地当前路径及各分支的已有选择优先。导入的后续消息可以接在分支末尾。
  for (const message of incoming.messages) {
    if (!message.selectedChildId) continue
    const id = mapped.get(message.id)!
    const node = nodes.get(id)!
    if (!node.selectedChildId) {
      nodes.set(id, { ...node, selectedChildId: mapped.get(message.selectedChildId) })
    }
  }
  return {
    ...local,
    title: local.title || incoming.title,
    updatedAt: Math.max(local.updatedAt, incoming.updatedAt),
    rootMessageId: local.rootMessageId ?? (incoming.rootMessageId ? mapped.get(incoming.rootMessageId) : null),
    messages: [...nodes.values()],
  }
}
