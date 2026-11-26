import type { ServerToolUseBlock } from '../../api/types.js'
import { getVisibleMessages, normalizeSession } from '../branches.js'
import { describeReply } from '../describe.js'
import type { AssistantMessage, Message, ReplyBlock, Session, UserMessage } from '../types.js'
import { fail } from './errors.js'
import type {
  ChatMessage,
  ChatMessageStatus,
  FileEntry,
  Fragment,
  SessionFile,
  SessionIndexEntry,
} from './format.js'

/** 返回图片原件在 ZIP 里的条目名；无原件或非图片附件返回 null，仅导出元数据。 */
export type ExportImage = (file: { id: string; name: string; isImage: boolean }) => string | null

/** 转换时发现并已容错的数据问题；导出汇总后提示用户，不再让整次导出失败。 */
export type ArchiveConversionStats = {
  /** 无法表示成合法 UTC 时间、已回退的个数 */
  invalidTimestamps: number
  /** 其他不满足归档校验的数值（耗时、计数等），已回退的个数 */
  invalidValues: number
}

/** Date 能表示的最大毫秒数；超出后 `toISOString` 抛 RangeError。 */
const MAX_TIME = 8.64e15
const EPOCH_ISO = new Date(0).toISOString()

/**
 * 毫秒转 UTC 时间。
 *
 * 时间戳可能来自官方接口或旧数据的脏值（NaN/Infinity/超出 Date 范围），
 * 直接 `new Date(ms).toISOString()` 会抛 RangeError，让任何一条脏数据毁掉整次导出。
 * 这里回退到合法值并计数：NaN/Infinity → 1970-01-01，超范围 → Date 边界。
 */
const iso = (ms: number, stats?: ArchiveConversionStats): string => {
  if (Number.isFinite(ms)) {
    if (Math.abs(ms) <= MAX_TIME) {
      return new Date(ms).toISOString()
    }
    if (stats) {
      stats.invalidTimestamps += 1
    }
    return new Date(ms > 0 ? MAX_TIME : -MAX_TIME).toISOString()
  }
  if (stats) {
    stats.invalidTimestamps += 1
  }
  return EPOCH_ISO
}

/** 归档要求非负安全整数（schema 的 count）；无法满足时回退 0，避免整条消息导入校验失败。 */
const count = (value: number, stats?: ArchiveConversionStats): number => {
  if (Number.isSafeInteger(value) && value >= 0) {
    return value
  }
  if (stats) {
    stats.invalidValues += 1
  }
  return 0
}

/** 耗时（秒）允许 null，但不能是 NaN/Infinity。 */
const seconds = (value: number | null, stats?: ArchiveConversionStats): number | null => {
  if (value === null || Number.isFinite(value)) {
    return value
  }
  if (stats) {
    stats.invalidValues += 1
  }
  return null
}

/** 来源日期可能是任意格式的原始字符串，无法解析时不导出（正常缺省，不计入异常）。 */
const isoOrNull = (value: string | null) => {
  const ms = value === null ? NaN : Date.parse(value)
  return Number.isFinite(ms) ? iso(ms) : null
}

const userFragments = (
  message: UserMessage,
  exportImage: ExportImage,
  stats?: ArchiveConversionStats
): Fragment[] => {
  const files = message.files.map((file): FileEntry => {
    const isImage = file.isImage
    return {
      id: file.id,
      file_name: file.name,
      file_size: count(file.size, stats),
      token_usage: null,
      inserted_at: iso(message.createdAt, stats),
      export_path: exportImage({ id: file.id, name: file.name, isImage }),
      is_image: isImage,
      width: null,
      height: null,
    }
  })
  return [
    ...(files.length > 0 ? [{ type: 'FILE' as const, files }] : []),
    { type: 'REQUEST', content: message.content },
  ]
}

const toolFragment = (tool: ServerToolUseBlock, result: ReplyBlock | undefined): Fragment[] => {
  const { input } = tool
  if (input.action === 'search') {
    const items = result?.type === 'web_search_tool_result' ? result.content : []
    return [
      {
        type: 'TOOL_SEARCH',
        queries: input.queries,
        status:
          result?.type !== 'web_search_tool_result'
            ? 'WIP'
            : items.some((item) => item.type === 'web_search_tool_result_error')
              ? 'FAILED'
              : 'FINISHED',
        results: items.flatMap((item) =>
          item.type === 'web_search_result'
            ? [
                {
                  url: item.url,
                  title: item.title,
                  snippet: item.snippet,
                  published_at: isoOrNull(item.page_age),
                  site_name: item.site_name,
                  site_icon: item.site_icon ?? null,
                },
              ]
            : []
        ),
      },
    ]
  }
  // 成功结果的 URL / 标题用于展示，加密页面签名原样保存供后续请求恢复上下文。
  if (input.action === 'read_link') {
    return result?.type === 'web_fetch_tool_result' &&
      result.kind === 'read_link' &&
      result.content.type === 'web_fetch_result' &&
      result.signature?.trim()
      ? [
          {
            type: 'READ_LINK',
            results: [
              {
                ...(result.content.url || input.url
                  ? { url: result.content.url || input.url }
                  : {}),
                title: result.content.content.title,
                signature: result.signature,
              },
            ],
          },
        ]
      : []
  }
  const content = result?.type === 'web_fetch_tool_result' ? result.content : undefined
  const page = content?.type === 'web_fetch_result' ? content : undefined
  const status = !content ? 'WIP' : page ? 'FINISHED' : 'FAILED'
  if (input.action === 'find_in_page') {
    return [{ type: 'TOOL_FIND', status, pattern: input.pattern }]
  }
  return [
    {
      type: 'TOOL_OPEN',
      status,
      url: input.url || page?.url || null,
      title: page?.content.title ?? null,
      snippet: page ? '' : null,
      site_name: null,
      published_at: page ? isoOrNull(page.published_at) : null,
    },
  ]
}

/**
 * 内容块按顺序转换为片段：相邻同类正文合并，服务端模板保留 TEMPLATE_RESPONSE；
 * 引用改由正文外的来源表示，不写入标记；
 * 本轮调用过联网能力时，剥除模型原样输出的 [citation:N]。
 */
const assistantFragments = (
  message: AssistantMessage,
  stats?: ArchiveConversionStats
): Fragment[] => {
  const { blocks } = message
  const results = new Map<string, ReplyBlock>()
  for (const block of blocks) {
    if (block.type === 'web_search_tool_result' || block.type === 'web_fetch_tool_result') {
      results.set(block.tool_use_id, block)
    }
  }
  const usedWeb = blocks.some((block) => block.type === 'server_tool_use')
  const fragments: Fragment[] = []
  let response: { type: 'RESPONSE' | 'TEMPLATE_RESPONSE'; content: string } | undefined
  for (const block of blocks) {
    if (block.type === 'text') {
      const type = block.isTemplate ? 'TEMPLATE_RESPONSE' : 'RESPONSE'
      if (!response || response.type !== type) {
        response = { type, content: '' }
        fragments.push(response)
      }
      response.content += usedWeb ? block.text.replace(/\[citation:\d+\]/g, '') : block.text
      continue
    }
    const converted: Fragment[] =
      block.type === 'thinking'
        ? block.thinking
          ? [
              {
                type: 'THINK',
                content: block.thinking,
                elapsed_secs: seconds(
                  block.elapsedSeconds ??
                    (block.startedAt === undefined || block.endedAt === undefined
                      ? null
                      : (block.endedAt - block.startedAt) / 1000),
                  stats
                ),
              },
            ]
          : []
        : block.type === 'server_tool_use'
          ? toolFragment(block, results.get(block.id))
          : []
    if (converted.length > 0) {
      fragments.push(...converted)
      response = undefined
    }
  }
  // 错误、拒绝提示作为模板保存，导入后仍不进上下文。
  // 正常空回复不补造提示。
  // 已有的模板直接沿用，避免反复导入导出时重复追加提示。
  const hasTemplate = blocks.some((block) => block.type === 'text' && block.isTemplate)
  if (
    (message.status === 'error' && message.error) ||
    (!hasTemplate && message.stopReason === 'refusal')
  ) {
    const notice = describeReply(message)
    if (notice) {
      fragments.push({ type: 'TEMPLATE_RESPONSE', content: notice.text })
    }
  }
  return fragments
}

const replyStatus = ({ status, stopReason }: AssistantMessage): ChatMessageStatus => {
  if (stopReason === 'refusal') {
    return 'CONTENT_FILTER'
  }
  switch (status) {
    case 'done':
      return stopReason === 'max_tokens' ? 'INCOMPLETE' : 'FINISHED'
    case 'stopped':
      return 'INCOMPLETE'
    case 'error':
      return 'FAILED'
    default:
      return 'WIP'
  }
}

/** 用归档能保留的内容识别同一父消息下的版本。导出会重新编号，因此不比较消息 ID。 */
export const archivedMessageKey = (message: Message): string => JSON.stringify(
  message.role === 'user'
    ? ['user', message.createdAt, userFragments(message, () => null)]
    : ['assistant', message.createdAt, replyStatus(message), message.thinking ?? false,
        message.search ?? false, assistantFragments(message)]
)

/** 最近一次请求的输入（含缓存）与输出之和，即这一条结束时的上下文 token。 */
const contextTokens = ({ usage }: AssistantMessage) =>
  usage
    ? usage.input_tokens +
      usage.cache_creation_input_tokens +
      usage.cache_read_input_tokens +
      usage.output_tokens
    : 0

/** 消息按父节点优先重新编号为 1…n，保证 parent_id 小于 id。 */
const numberMessages = (messages: Message[]) => {
  const byId = new Map(messages.map((message) => [message.id, message]))
  const ids = new Map<string, number>()
  const ordered: Message[] = []
  const visit = (message: Message, depth: number) => {
    if (ids.has(message.id)) {
      return
    }
    if (message.parentId) {
      const parent = byId.get(message.parentId)
      // 父节点缺失或成环时数据已损坏。
      visit(parent && depth < messages.length ? parent : fail('backupInvalidBranches'), depth + 1)
    }
    ids.set(message.id, ordered.push(message))
  }
  messages.forEach((message) => visit(message, 0))
  return { ordered, ids }
}

export const toSessionFile = (
  original: Session,
  exportImage: ExportImage,
  stats?: ArchiveConversionStats
): SessionFile => {
  const session = normalizeSession(original)
  const { ordered, ids } = numberMessages(session.messages)
  const id = (message: Message) => ids.get(message.id) ?? fail('backupInvalidBranches')
  // 提问的开关取首个回答的请求设置。
  const firstReply = new Map<string, AssistantMessage>()
  for (const message of ordered) {
    if (message.role === 'assistant' && message.parentId && !firstReply.has(message.parentId)) {
      firstReply.set(message.parentId, message)
    }
  }
  const messages = ordered.map((message): ChatMessage => {
    const tree = {
      id: id(message),
      parent_id: message.parentId ? (ids.get(message.parentId) ?? null) : null,
    }
    const reply = message.role === 'assistant' ? message : firstReply.get(message.id)
    return {
      ...tree,
      role: message.role === 'user' ? 'USER' : 'ASSISTANT',
      status: message.role === 'user' ? 'FINISHED' : replyStatus(message),
      thinking_enabled: reply?.thinking ?? false,
      search_enabled: reply?.search ?? false,
      accumulated_token_usage:
        message.role === 'user' ? 0 : count(contextTokens(message), stats),
      inserted_at: iso(message.createdAt, stats),
      fragments:
        message.role === 'user'
          ? userFragments(message, exportImage, stats)
          : assistantFragments(message, stats),
    }
  })
  const current = getVisibleMessages(session).at(-1)
  return {
    id: session.id,
    title: session.title || null,
    pinned: session.pinned === true,
    // 格式要求非空；空会话没有消息可指向，写 0。
    current_message_id: current ? id(current) : 0,
    inserted_at: iso(session.createdAt, stats),
    updated_at: iso(session.updatedAt, stats),
    messages,
  }
}

export const toIndexEntry = (file: SessionFile): SessionIndexEntry => ({
  id: file.id,
  title: file.title,
  pinned: file.pinned === true,
  message_count: file.messages.length,
  inserted_at: file.inserted_at,
  updated_at: file.updated_at,
})
