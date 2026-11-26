import { createId } from '../../../utils/id.js'
import { normalizeSession } from '../branches.js'
import type { Message, Session } from '../types.js'
import { archivedMessageKey } from './toArchive.js'

/**
 * 官方同步会话的 id 前缀；导入归档里的会话用裸 id，两者指同一条官方会话。
 * 必须与 db.ts 的 OFFICIAL_PREFIX、official/sync.ts 的 OFFICIAL_PREFIX 保持一致。
 */
export const OFFICIAL_SESSION_PREFIX = 'off_'

/** 去掉命名空间前缀后的会话身份：off_<id> 与裸 <id> 是同一条会话。 */
export const sessionIdentity = (id: string): string =>
  id.startsWith(OFFICIAL_SESSION_PREFIX)
    ? id.slice(OFFICIAL_SESSION_PREFIX.length)
    : id

export type SessionNamespaceIds = {
  /** 归档里这条会话的 id */
  id: string
  /** 去掉命名空间前缀后的身份：同一条官方会话的稳定标识 */
  identity: string
  /** 官方同步写的会话 id：off_<identity> */
  officialId: string
  /** 裸 id：<identity>（旧版从官方 ZIP 导入的会话） */
  legacyId: string
}

/**
 * 同一条会话在本地可能出现过的全部 id。
 *
 * db.mergeStaging 现在只查 `incoming.id` 和 `off_${incoming.id}` 两种写法，
 * 至少漏掉两种情况，导致同一个会话在列表里存成两条（重复会话 bug）：
 * 1. 本机已有裸 id 副本（旧版从官方 ZIP 导入的），这次导入的是本项目导出的包 → id 已是 off_<id>，
 *    现有代码会去查 off_off_<id>，必然 miss；
 * 2. 本机已有 off_<id>（官方同步），归档里是裸 <id>：现有代码能查到 cross，但只在
 *    "内容逐条完全一致"时才合并，实际几乎不成立（见 sessionsEquivalent 注释）。
 */
export const sessionNamespaceIds = (id: string): SessionNamespaceIds => {
  const identity = sessionIdentity(id)
  return { id, identity, officialId: OFFICIAL_SESSION_PREFIX + identity, legacyId: identity }
}

/**
 * 两个会话是不是**同一条对话的同一份内容**（逐条完全一致）。
 *
 * 用途：导入归档里带裸 id 的会话，和官方同步写的 off_<id> 会话可能是同一条对话。
 * 只有在「所有消息完全一致」时才允许把它们当成同一会话去合并/去重；
 * 只要多出哪怕一轮、或某一轮内容不同，就必须当成两个会话分别保留，
 * 否则导入的那份多出来的对话会被官方那份覆盖掉（用户反馈过的丢消息 bug）。
 *
 * 这里比较的是**全部消息**（按时间排序），不是当前可见分支：
 * 提示链可能因分支选择不同而不同，但"这份存档到底有哪些消息"必须逐条对齐。
 *
 * 注意：这个严格判断只应该用于**删除**（sync.ts 折叠重复会话），不能作为"跨命名空间能否合并"
 * 的门槛——官方同步与归档导入重建出来的消息在 id 前缀、附件 id、时间精度、思考/搜索开关、
 * 工具步骤上都不同，逐条 key 几乎不可能相等（见 mergeSessionsByContent 的宽松对齐）。
 */
export const sessionsEquivalent = (a: Session, b: Session): boolean => {
  const orderedOf = (session: Session): Message[] =>
    [...normalizeSession(session).messages].sort(
      (left, right) => left.createdAt - right.createdAt || String(left.id).localeCompare(String(right.id))
    )
  const left = orderedOf(a)
  const right = orderedOf(b)
  /*
   * 性能：逐条构造 JSON key 有点贵，所以先用三个 O(n) 的廉价条件快速否定。
   * 真正会走到这里的场景很少 —— 只有「同名 id 冲突」（导入的裸 id 撞上官方 off_ id）才会比较一次，
   * 不是每次导入都全量两两比较。
   */
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index].createdAt !== right[index].createdAt) {
      return false
    }
    if (left[index].role !== right[index].role) {
      return false
    }
  }
  // 条数、每条时间是同一批之后，再做内容级比较（这一步才是"逐条"）
  return left.every((message, index) => archivedMessageKey(message) === archivedMessageKey(right[index]))
}

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

/*
 * ============================ 跨命名空间合并 ============================
 *
 * 问题：官方同步的会话（off_<id>，消息 id 是 o_*，附件 id 是 of_*，时间由秒级 inserted_at 重建，
 * 并且只保留 THINK/RESPONSE/TEMPLATE_RESPONSE 三类片段）和官方 ZIP 导入的会话
 * （裸 id，消息 id 是数字字符串，附件是裸 UUID，时间是 ISO 毫秒）是**同一段对话的两种投影**。
 *
 * 用 archivedMessageKey 逐条比较（sessionsEquivalent / mergeArchivedSession）在这些差异下几乎必然不相等，
 * 于是现有逻辑要么"当成两个会话都保留"（列表重复），要么在 direct 命中的同命名空间里把导入内容
 * 追加成一批新分支（同一轮对话出现 1/2 版本切换器）。这里改为按"看得见的内容"对齐：
 * 角色 + 正文 + 思考、时间差容忍秒级精度，附件/工具步骤只做"谁更完整取谁"的补全，不动本地已有内容。
 */

/** 官方同步用秒级 inserted_at 重建时间，导入用 ISO 毫秒：同一条消息最多差不到 1s。 */
const MESSAGE_TIME_TOLERANCE = 3000

/** 消息可比较的正文：提问取正文；回复取全部正文块（模板也算正文）。 */
const messageText = (message: Message): string =>
  message.role === 'user'
    ? message.content
    : message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')

/** 思考正文；工具步骤不参与比较（官方同步不保留工具片段）。 */
const messageThinking = (message: Message): string =>
  message.role === 'user'
    ? ''
    : message.blocks.map((block) => (block.type === 'thinking' ? block.thinking : '')).join('')

const contentKey = (message: Message): string =>
  `${message.role}\u0000${messageText(message)}\u0000${messageThinking(message)}`

/**
 * 按内容把 incoming 的消息一一对齐到 local 上（同一条消息只对一次，时间差 ≤ 3s）。
 * 返回 incoming.id → local.id；对不上的（本地没有的新消息）不在返回里。
 */
const alignByContent = (
  local: readonly Message[],
  incoming: readonly Message[]
): Map<string, string> => {
  const candidates = new Map<string, Message[]>()
  for (const message of local) {
    const key = contentKey(message)
    const list = candidates.get(key)
    if (list) {
      list.push(message)
    } else {
      candidates.set(key, [message])
    }
  }
  const mapped = new Map<string, string>()
  const used = new Set<string>()
  for (const message of incoming) {
    const list = candidates.get(contentKey(message))
    if (!list) {
      continue
    }
    let best: Message | undefined
    let bestDistance = Number.POSITIVE_INFINITY
    for (const candidate of list) {
      if (used.has(candidate.id)) {
        continue
      }
      const distance = Math.abs(candidate.createdAt - message.createdAt)
      if (distance <= MESSAGE_TIME_TOLERANCE && distance < bestDistance) {
        best = candidate
        bestDistance = distance
      }
    }
    if (!best) {
      continue
    }
    used.add(best.id)
    mapped.set(message.id, best.id)
  }
  return mapped
}

/**
 * 对方更完整时补全本地消息：附件只按"文件名 + 大小"补 MIME，不换成本地没有的附件 id；
 * 回复只在对内容块更多（官方同步丢掉的搜索/阅读步骤）时替换内容块，文字本身已经对齐过。
 */
const enrichMessage = (target: Message, incoming: Message): Message => {
  if (target.role !== incoming.role) {
    return target
  }
  if (target.role === 'user' && incoming.role === 'user') {
    const files = target.files.length > 0
      ? target.files.map((file) => {
          if (file.mimeType) {
            return file
          }
          const source = incoming.files.find(
            (item) => item.name === file.name && item.size === file.size && item.mimeType
          )
          return source ? { ...file, mimeType: source.mimeType } : file
        })
      : incoming.files
    const changed =
      files.length !== target.files.length || files.some((file, index) => file !== target.files[index])
    return changed ? { ...target, files } : target
  }
  if (target.role === 'assistant' && incoming.role === 'assistant') {
    if (incoming.blocks.length > target.blocks.length) {
      return { ...target, blocks: incoming.blocks }
    }
  }
  return target
}

export type ContentMerge = {
  /** 合并结果；没有任何变化时就是传入的 original 本身 */
  session: Session
  /** 内容对上的消息数：复用本地 id，不会在列表/分支里重复出现 */
  matched: number
  /** 本地没有、作为新消息追加的数量（同一父消息下已有的分支不受影响） */
  added: number
}

/**
 * 用内容对齐把 incoming 并进 original：同一段对话不重复、本地多出来的消息原样保留。
 *
 * 这是跨命名空间（off_<id> ↔ 裸 <id>）唯一安全的合并方式：
 * - 对齐上的消息：保留本地消息（id、时间、附件、已选分支都不动），只补 MIME/更完整的工具步骤；
 * - 对不上的消息：按父节点映射后追加，父节点本地没有就跳过（宁可少一条也不造出无效的树）。
 */
export const mergeSessionsByContent = (original: Session, incoming: Session): ContentMerge => {
  const local = normalizeSession(original)
  const mapped = alignByContent(local.messages, incoming.messages)
  const nodes = new Map(local.messages.map((message) => [message.id, message]))
  let matched = 0
  let added = 0
  let changed = false
  for (const message of incoming.messages) {
    const match = mapped.get(message.id)
    if (match !== undefined) {
      const target = nodes.get(match)
      if (target) {
        const enriched = enrichMessage(target, message)
        if (enriched !== target) {
          nodes.set(match, enriched)
          changed = true
        }
        matched += 1
      }
      continue
    }
    const parent = message.parentId ? mapped.get(message.parentId) : null
    if (parent === undefined) {
      // 父消息对不上（不属于这段对话的孤立消息）：不硬挂，跳过一条也比造出断链的树好
      continue
    }
    let id = message.id
    while (nodes.has(id)) {
      id = createId()
    }
    nodes.set(id, { ...message, id, parentId: parent, selectedChildId: undefined })
    mapped.set(message.id, id)
    added += 1
    changed = true
  }
  // 本地各分支已有的选择优先；导入的后续消息可以补上"选哪条子消息"
  for (const message of incoming.messages) {
    if (!message.selectedChildId) {
      continue
    }
    const id = mapped.get(message.id)
    const wanted = mapped.get(message.selectedChildId)
    if (id === undefined || wanted === undefined) {
      continue
    }
    const node = nodes.get(id)
    if (node && node.selectedChildId === undefined) {
      nodes.set(id, { ...node, selectedChildId: wanted })
      changed = true
    }
  }
  const title = local.title || incoming.title
  const updatedAt = Math.max(local.updatedAt, incoming.updatedAt)
  if (title !== local.title || updatedAt !== local.updatedAt) {
    changed = true
  }
  if (!changed) {
    return { session: original, matched, added: 0 }
  }
  const rootMapped = incoming.rootMessageId ? mapped.get(incoming.rootMessageId) : undefined
  return {
    session: {
      ...local,
      title,
      updatedAt,
      rootMessageId: local.rootMessageId ?? rootMapped ?? null,
      messages: [...nodes.values()],
    },
    matched,
    added,
  }
}

/**
 * candidate 的消息是否已经**全部**存在于 container 里（内容对齐，不看 id）。
 * 用于判断"导入的存档只是官方会话的子集，不需要再建一条重复会话"。
 */
export const sessionContentsIncluded = (container: Session, candidate: Session): boolean => {
  const local = normalizeSession(container)
  const other = normalizeSession(candidate)
  return alignByContent(local.messages, other.messages).size === other.messages.length
}

export type ImportedSessionDecision = {
  /** 要写入的会话；unchanged 为 true 时调用方可以跳过写入 */
  session: Session
  /** 归档内容已完整存在（且没有需要折叠的重复会话），不需要写库 */
  unchanged: boolean
  /** 合并后可以安全删除的重复会话 id：内容已全部并进 session，删掉不会丢消息 */
  redundant: string[]
}

/** 本地与 incoming 同身份的会话（三个命名空间候选，db 侧按 sessionNamespaceIds 查出来传入）。 */
export type LocalSessionCandidates = {
  /** 与 incoming.id 完全同 id 的会话（同命名空间续聊会走这里） */
  direct?: Session
  /** off_<identity>：官方同步写的会话 */
  official?: Session
  /** <identity> 裸 id：旧版从官方 ZIP 导入、还没被折叠的会话 */
  legacy?: Session
}

/**
 * 副本里每条消息都能在 target 中找到内容对应、且用户消息的附件（按文件名 + 大小）也都覆盖时，
 * 才允许把副本会话整体删掉：这样删除只丢可再下载的原件缓存，不丢对话内容。
 */
const copyCoveredBy = (target: Session, copy: Session): boolean => {
  const local = normalizeSession(target)
  const other = normalizeSession(copy)
  const mapped = alignByContent(local.messages, other.messages)
  if (mapped.size !== other.messages.length) {
    return false
  }
  const byId = new Map(local.messages.map((message) => [message.id, message]))
  for (const message of other.messages) {
    const targetId = mapped.get(message.id)
    const counterpart = targetId === undefined ? undefined : byId.get(targetId)
    if (message.role !== 'user' || counterpart?.role !== 'user') {
      continue
    }
    for (const file of message.files) {
      if (!counterpart.files.some((item) => item.name === file.name && item.size === file.size)) {
        return false
      }
    }
  }
  return true
}

/**
 * 导入一条会话时的合并决策（db.mergeStaging 的建议实现，纯函数、可单测）。
 *
 * 查找别再只查 incoming.id 和 off_+incoming.id，用 sessionNamespaceIds(incoming.id) 取三个候选
 * （id / off_<identity> / 裸 <identity>），再按下面的规则合并：
 * - 本地已有官方会话（off_<id>）：它就是目标。先把本地遗留的裸 id 副本按内容并进来
 *   （没有独有内容且附件都覆盖时记入 redundant），再把归档内容并进去，
 *   **不再新建裸 id 副本**；归档只是子集时 unchanged=true，一行都不用写；
 * - 归档自己带 off_ 前缀（本项目导出的包），但本机只有裸 id 会话：并进已有的裸 id 会话，
 *   不另建一条 off_ 会话（这是"重装后导入自己的备份又出现两条同名会话"的来源）；
 * - 本地只有同 id 的裸会话：走原来的 mergeArchivedSession（同 id 的续聊、分支合并）；
 * - 本地没有：直接新增。
 *
 * 反向纯函数设计的意义：db.mergeStaging 的 IDB 事务里不能 await 动态 import/其它异步操作，
 * 事务只保留"读 → 调本函数 → 写"。测试见 tools/test-import-merge.mts。
 */
export const decideImportedSession = (
  incoming: Session,
  local: LocalSessionCandidates
): ImportedSessionDecision => {
  const redundant: string[] = []
  const fold = (base: Session, copy: Session): Session => {
    const merged = mergeSessionsByContent(base, copy)
    if (merged.added === 0 && copyCoveredBy(merged.session, copy)) {
      redundant.push(copy.id)
    }
    return merged.session
  }
  const official = local.official
  if (official) {
    // 官方会话优先：先折叠本地重复副本，再并入归档
    let session = official
    const folded = new Set<string>([official.id])
    for (const copy of [local.direct, local.legacy]) {
      if (!copy || folded.has(copy.id)) {
        continue
      }
      folded.add(copy.id)
      session = fold(session, copy)
    }
    const merged = mergeSessionsByContent(session, incoming)
    return { session: merged.session, unchanged: merged.session === official, redundant }
  }
  // 本机只有裸 id 副本（旧版从官方 ZIP 导入留下的）：并进已有副本，
  // 别让列表里再多一条同名会话（本项目导出的包带 off_ 前缀时尤其容易撞上）。
  const legacy = local.legacy
  if (legacy) {
    const merged = mergeSessionsByContent(legacy, incoming)
    return { session: merged.session, unchanged: merged.session === legacy, redundant }
  }
  if (local.direct) {
    const merged = mergeArchivedSession(local.direct, incoming)
    return { session: merged, unchanged: merged === local.direct, redundant }
  }
  return { session: incoming, unchanged: false, redundant: [] }
}
