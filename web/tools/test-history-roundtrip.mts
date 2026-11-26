/**
 * 历史「导出 → 导入 → 合并」端到端回归测试。
 *
 * 真跑 web/src 源码：IndexedDB 用 fake-indexeddb 在 Node 里模拟，ZIP 用 App 自己的
 * zipWriter/zipReader 实现，不经过真机、不 mock 业务逻辑。
 *
 * 运行：cd web && npx tsx tools/test-history-roundtrip.mts
 *
 * 覆盖：
 *   1. 3 个会话（图片 / 非图片附件 / 消息分支 / 根消息分支 / 置顶）导出 ZIP
 *   2. 清空本地（模拟新设备）后 merge 导入 → 会话/消息/图片/置顶/分支全部还原
 *   3. 同一份包再导入一次 → 幂等，不重复、不报错
 *   4. 导入包比本地多 2 轮（同 id）→ 合并进原会话，不新建会话、不丢消息
 *   5. 同一图片 id 但字节不同 → 导入失败（backupConflictingFile）、正式数据不变、暂存清空、可重试
 *   6. 官方同步的 off_<id> 与导入的裸 id 内容不一致 → 两份都保留（不互相覆盖）
 */
import 'fake-indexeddb/auto'
import type {
  AssistantMessage,
  FileAttachment,
  Message,
  Session,
  SessionSummary,
  UserMessage,
} from '../src/services/chat/types.ts'

/*
 * 业务模块（store.ts/settings.ts 等）在加载期会摸 window/document/localStorage/navigator。
 * 用"随便怎么访问都不炸"的 Proxy 桩；只影响 Node 测试环境，不改产品代码。
 * 注意 navigator 在 Node 24 上是只读 getter，必须 defineProperty。
 */
const stub: unknown = new Proxy(function () {}, {
  get: (_target, key) => (key === 'then' ? undefined : key === Symbol.toPrimitive ? () => 'stub' : stub),
  apply: () => stub,
})
const defineGlobal = (name: string, value: unknown): void => {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
}
defineGlobal('window', stub)
defineGlobal('document', stub)
defineGlobal('localStorage', stub)
defineGlobal('navigator', stub)
defineGlobal('__API_ORIGIN__', 'https://example.invalid')

const db = await import('../src/services/chat/db.ts')
const { useChatStore, initChat } = await import('../src/services/chat/store.ts')
const { clearHistory, exportHistory, importHistory } = await import(
  '../src/services/chat/backup.ts'
)
const { getVisibleMessages } = await import('../src/services/chat/branches.ts')
const { readArchive, readEntry } = await import('../src/services/chat/history/zipReader.ts')
const { exportArchive } = await import('../src/services/chat/history/exportArchive.ts')

// ---------------------------------------------------------------- 断言 / 输出
let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) {
    pass += 1
    console.log('PASS  ' + name)
  } else {
    fail += 1
    console.log('FAIL  ' + name + (detail ? '  → ' + detail : ''))
  }
}
const info = (text: string): void => console.log('      ' + text)
const section = (title: string): void => console.log('\n### ' + title)
/** 导入结果的 added/updated 计数：不同版本可能扩展返回值，取不到时返回 undefined。 */
const counterOf = (result: unknown, key: 'added' | 'updated'): number | undefined => {
  const value = (result as Record<string, unknown> | undefined)?.[key]
  return typeof value === 'number' ? value : undefined
}

// ---------------------------------------------------------------- 小工具
const attachment = (
  id: string,
  name: string,
  size: number,
  isImage: boolean,
  mimeType: string
): FileAttachment => ({ id, serverId: null, name, size, isImage, mimeType })

const user = (
  id: string,
  content: string,
  createdAt: number,
  parentId: string | null,
  selectedChildId: string | null,
  files: FileAttachment[] = []
): UserMessage => ({
  id,
  role: 'user',
  content,
  createdAt,
  parentId,
  selectedChildId: selectedChildId ?? undefined,
  files,
})

const assistant = (
  id: string,
  content: string,
  createdAt: number,
  parentId: string,
  selectedChildId: string | null = null
): AssistantMessage => ({
  id,
  role: 'assistant',
  createdAt,
  parentId,
  selectedChildId: selectedChildId ?? undefined,
  blocks: [{ type: 'text', text: content }],
  model: 'deepseek-flash',
  status: 'done',
  prefix: false,
  thinking: false,
  search: false,
})

const textOf = (message: Message): string =>
  message.role === 'user'
    ? message.content
    : message.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')

const visibleTexts = (session: Session): string[] => getVisibleMessages(session).map(textOf)

const imageIdsOf = (session: Session): string[] =>
  session.messages.flatMap((message) =>
    message.role === 'user' ? message.files.filter((file) => file.isImage).map((file) => file.id) : []
  )

const fileOf = (blob: Blob, name: string): File => new File([blob], name, { type: 'application/zip' })

const bytesOf = async (blob: Blob): Promise<number[]> => [
  ...new Uint8Array(await blob.arrayBuffer()),
]
const sameBytes = (left: number[], right: number[]): boolean =>
  left.length === right.length && left.every((byte, index) => byte === right[index])

const allSessions = async (): Promise<Map<string, Session>> => {
  const result = new Map<string, Session>()
  for (const summary of await db.loadSessionSummaries()) {
    const session = await db.loadSession(summary.id)
    if (session) {
      result.set(summary.id, session)
    }
  }
  return result
}

const summaryMap = async (): Promise<Map<string, SessionSummary>> =>
  new Map((await db.loadSessionSummaries()).map((summary) => [summary.id, summary]))

/** 让 store 里的 sessions 与 IndexedDB 对齐（等价于 App 启动后 initChat 的结果）。 */
const syncStore = async (): Promise<void> => {
  const summaries = await db.loadSessionSummaries()
  useChatStore.setState({
    ready: true,
    sessions: [...summaries].sort((left, right) => right.updatedAt - left.updatedAt),
    sessionCache: {},
  })
}

type Snapshot = {
  sessionCount: number
  messageCount: number
  counts: Record<string, number>
  imageIds: string[]
}
const snapshot = async (): Promise<Snapshot> => {
  const sessions = await allSessions()
  const counts: Record<string, number> = {}
  const imageIds: string[] = []
  let messageCount = 0
  for (const [id, session] of sessions) {
    counts[id] = session.messages.length
    messageCount += session.messages.length
    imageIds.push(...imageIdsOf(session))
  }
  return {
    sessionCount: sessions.size,
    messageCount,
    counts,
    imageIds: [...new Set(imageIds)].sort(),
  }
}

/** 读 ZIP 全部条目（必须逐条消费；之后同一个 File 还能再次导入）。 */
const readZipEntries = async (file: File): Promise<{ path: string; size: number }[]> => {
  const entries: { path: string; size: number }[] = []
  for await (const entry of readArchive(file)) {
    await readEntry(entry)
    entries.push({ path: entry.path, size: entry.size })
  }
  return entries
}

/** 导入暂存区条数（失败后应回到 0/0，否则界面会显示半截数据）。 */
const stagingCounts = async (): Promise<string> => {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('chat-demo')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    const transaction = database.transaction(['sessionsStaging', 'filesStaging'], 'readonly')
    const sessionsRequest = transaction.objectStore('sessionsStaging').count()
    const filesRequest = transaction.objectStore('filesStaging').count()
    const [sessions, files] = await Promise.all([
      new Promise<number>((resolve, reject) => {
        sessionsRequest.onsuccess = () => resolve(sessionsRequest.result)
        sessionsRequest.onerror = () => reject(sessionsRequest.error)
      }),
      new Promise<number>((resolve, reject) => {
        filesRequest.onsuccess = () => resolve(filesRequest.result)
        filesRequest.onerror = () => reject(filesRequest.error)
      }),
    ])
    return sessions + '/' + files
  } finally {
    database.close()
  }
}

// ---------------------------------------------------------------- 1. 造 3 个会话
const IMG_A1 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xa1, 0x01, 0x02, 0x03])
const IMG_A2 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xa2])
const IMG_B1 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xb1, 0x04, 0x05, 0x06])
const FILES: { id: string; blob: Blob }[] = [
  { id: 'imgA1', blob: new Blob([IMG_A1], { type: 'image/png' }) },
  { id: 'imgA2', blob: new Blob([IMG_A2], { type: 'image/jpeg' }) },
  { id: 'imgB1', blob: new Blob([IMG_B1], { type: 'image/png' }) },
]

const A_TIME = Date.UTC(2025, 10, 1, 8, 0, 0)
const B_TIME = Date.UTC(2025, 10, 1, 9, 0, 0)
const C_TIME = Date.UTC(2025, 10, 1, 10, 0, 0)

const sessionA: Session = {
  id: 'rtA',
  title: '带图片和分支的会话',
  pinned: true,
  createdAt: A_TIME,
  updatedAt: A_TIME + 5000,
  rootMessageId: 'uA1',
  messages: [
    user('uA1', '第一问', A_TIME + 1000, null, 'aA1', [
      attachment('imgA1', 'a1.png', IMG_A1.length, true, 'image/png'),
    ]),
    assistant('aA1', '第一答', A_TIME + 2000, 'uA1', 'uA2'),
    user('uA2', '第二问', A_TIME + 3000, 'aA1', 'aA2b', [
      attachment('imgA2', 'a2.jpg', IMG_A2.length, true, 'image/jpeg'),
    ]),
    assistant('aA2a', '旧回答（未选中分支）', A_TIME + 4000, 'uA2'),
    assistant('aA2b', '新回答（选中分支）', A_TIME + 5000, 'uA2'),
  ],
}

const sessionB: Session = {
  id: 'rtB',
  title: '非置顶带附件',
  pinned: false,
  createdAt: B_TIME,
  updatedAt: B_TIME + 2000,
  rootMessageId: 'uB1',
  messages: [
    user('uB1', '看这张图', B_TIME + 1000, null, 'aB1', [
      attachment('imgB1', 'b1.png', IMG_B1.length, true, 'image/png'),
      attachment('docB1', 'notes.txt', 11, false, 'text/plain'),
    ]),
    assistant('aB1', '收到', B_TIME + 2000, 'uB1'),
  ],
}

const sessionC: Session = {
  id: 'rtC',
  title: '根消息双分支',
  pinned: false,
  createdAt: C_TIME,
  updatedAt: C_TIME + 3000,
  rootMessageId: 'uCb',
  messages: [
    user('uCa', '旧问法', C_TIME + 1000, null, null),
    user('uCb', '新问法', C_TIME + 2000, null, 'aCb'),
    assistant('aCb', '根分支回答', C_TIME + 3000, 'uCb'),
  ],
}

const SOURCE_MESSAGES: Record<string, number> = { rtA: 5, rtB: 2, rtC: 3 }
const SOURCE_TITLES: Record<string, string> = {
  rtA: sessionA.title,
  rtB: sessionB.title,
  rtC: sessionC.title,
}
const SOURCE_TIMES: Record<string, { createdAt: number; updatedAt: number }> = {
  rtA: { createdAt: sessionA.createdAt, updatedAt: sessionA.updatedAt },
  rtB: { createdAt: sessionB.createdAt, updatedAt: sessionB.updatedAt },
  rtC: { createdAt: sessionC.createdAt, updatedAt: sessionC.updatedAt },
}
const SOURCE_IMAGE_IDS = ['imgA1', 'imgA2', 'imgB1']
const SOURCE_IMAGE_BYTES: Record<string, number[]> = {
  imgA1: [...IMG_A1],
  imgA2: [...IMG_A2],
  imgB1: [...IMG_B1],
}
const EXPECTED_ZIP_PATHS = [
  'chat_session_index.json',
  'chat_sessions/rtA.json',
  'chat_sessions/rtA_files/imgA1_a1.png',
  'chat_sessions/rtA_files/imgA2_a2.jpg',
  'chat_sessions/rtB.json',
  'chat_sessions/rtB_files/imgB1_b1.png',
  'chat_sessions/rtC.json',
  'manifest.json',
]
const EXPECTED_IMAGE_ENTRY_SIZES: Record<string, number> = {
  'chat_sessions/rtA_files/imgA1_a1.png': IMG_A1.length,
  'chat_sessions/rtA_files/imgA2_a2.jpg': IMG_A2.length,
  'chat_sessions/rtB_files/imgB1_b1.png': IMG_B1.length,
}

await db.saveSession(sessionA, FILES)
await db.saveSession(sessionB)
await db.saveSession(sessionC)
await initChat()

// ---------------------------------------------------------------- 2. 导出
section('导出：3 个会话 + 3 张图片 → 可再次导入的 ZIP')
check('initChat 后会话列表 3 条', useChatStore.getState().sessions.length === 3)
const exportProgress: number[] = []
const exported = await exportHistory((percent) => exportProgress.push(percent))
info(
  '文件名 ' +
    exported.name +
    '，大小 ' +
    exported.blob.size +
    ' 字节，skipped=' +
    exported.skipped +
    ' fetched=' +
    exported.fetched +
    ' images=' +
    exported.images +
    '/' +
    exported.imageTotal
)
check('导出文件名符合 deepseek_data-*.zip', /^deepseek_data-.*\.zip$/.test(exported.name), exported.name)
check('导出包不是空包（> 1000 字节，不是 307 字节）', exported.blob.size > 1000, exported.blob.size + ' bytes')
check(
  '导出时没有"只有摘要没有正文"的会话 / 没有需要联网补的图',
  exported.skipped === 0 && exported.fetched === 0 && exported.images === 0 && exported.imageTotal === 0,
  JSON.stringify(exported)
)
check('导出进度最后到 100', exportProgress.at(-1) === 100, String(exportProgress.at(-1)))

const e0File = fileOf(exported.blob, exported.name)
const zipEntries = await readZipEntries(e0File)
const zipPaths = zipEntries.map((entry) => entry.path).sort()
info('ZIP 条目：' + JSON.stringify(zipPaths))
check(
  'ZIP 条目 = manifest + 3 会话 + index + 3 图片 = 8',
  zipPaths.length === 8 && JSON.stringify(zipPaths) === JSON.stringify(EXPECTED_ZIP_PATHS),
  JSON.stringify(zipPaths)
)
const badImageEntry = zipEntries.find(
  (entry) =>
    entry.path in EXPECTED_IMAGE_ENTRY_SIZES &&
    entry.size !== EXPECTED_IMAGE_ENTRY_SIZES[entry.path]
)
check('ZIP 里 3 张图片原件大小与源文件一致', badImageEntry === undefined, JSON.stringify(badImageEntry))

// ---------------------------------------------------------------- 3. 清空 → 空库导入
section('清空 + 导入：模拟新设备从备份恢复')
await clearHistory()
const emptySnapshot = await snapshot()
check('清空后会话数 0', emptySnapshot.sessionCount === 0, JSON.stringify(emptySnapshot))
check('清空后图片原件已删除', (await db.loadFile('imgA1')) === undefined)
let emptyExportError: unknown
try {
  await exportHistory()
} catch (error) {
  emptyExportError = error
}
check(
  '空历史导出直接报错，不再产出空 ZIP',
  emptyExportError instanceof Error && emptyExportError.message.includes('本地还没有可导出的对话'),
  String(emptyExportError)
)

const importStages: string[] = []
const imported = await importHistory(e0File, 'merge', (progress) => importStages.push(progress.stage))
info('首次导入 added=' + counterOf(imported, 'added') + ' updated=' + counterOf(imported, 'updated') + '，进度阶段=' + JSON.stringify(importStages))
check('导入空库 added=3', counterOf(imported, 'added') === 3 && counterOf(imported, 'updated') === 0, JSON.stringify(imported))
check('导入进度含 reading 与 saving', importStages.includes('reading') && importStages.includes('saving'), JSON.stringify(importStages))

const restoredSnapshot = await snapshot()
info('恢复后：' + JSON.stringify(restoredSnapshot))
check(
  '会话数 / 消息数 / 图片数与原库一致',
  restoredSnapshot.sessionCount === 3 &&
    JSON.stringify(restoredSnapshot.counts) === JSON.stringify(SOURCE_MESSAGES) &&
    JSON.stringify(restoredSnapshot.imageIds) === JSON.stringify(SOURCE_IMAGE_IDS),
  JSON.stringify(restoredSnapshot)
)
check('导入后 store 会话列表 3 条', useChatStore.getState().sessions.length === 3)

const restored = await allSessions()
const summaries = await summaryMap()
const restoredA = restored.get('rtA')
const restoredB = restored.get('rtB')
const restoredC = restored.get('rtC')
check('三个会话都在', restoredA !== undefined && restoredB !== undefined && restoredC !== undefined)
check(
  '标题 / 置顶 / 创建与更新时间一致',
  ['rtA', 'rtB', 'rtC'].every(
    (id) =>
      summaries.get(id)?.title === SOURCE_TITLES[id] &&
      summaries.get(id)?.createdAt === SOURCE_TIMES[id].createdAt &&
      summaries.get(id)?.updatedAt === SOURCE_TIMES[id].updatedAt
  ) &&
    summaries.get('rtA')?.pinned === true &&
    summaries.get('rtB')?.pinned === false &&
    summaries.get('rtC')?.pinned === false,
  JSON.stringify([...summaries.values()])
)

if (restoredA && restoredB && restoredC) {
  const visibleA = visibleTexts(restoredA)
  check(
    '会话 A 可见分支：第一问→第一答→第二问→新回答',
    JSON.stringify(visibleA) === JSON.stringify(['第一问', '第一答', '第二问', '新回答（选中分支）']),
    JSON.stringify(visibleA)
  )
  const question2 = restoredA.messages.find(
    (message) => message.role === 'user' && message.content === '第二问'
  )
  const versions =
    question2 === undefined
      ? []
      : restoredA.messages.filter(
          (message) => message.role === 'assistant' && message.parentId === question2.id
        )
  const selectedReply = restoredA.messages.find(
    (message) => message.role === 'assistant' && message.id === question2?.selectedChildId
  )
  check(
    '会话 A 分支：同一提问下 2 个回答版本都保留，且选中的是新回答',
    versions.length === 2 && selectedReply !== undefined && textOf(selectedReply) === '新回答（选中分支）',
    'versions=' + versions.length + ' selected=' + (selectedReply ? textOf(selectedReply) : 'none')
  )

  const rootMessage = restoredC.messages.find((message) => message.id === restoredC.rootMessageId)
  check(
    '会话 C 根分支：rootMessageId 指向新问法，旧问法分支也保留',
    rootMessage !== undefined &&
      textOf(rootMessage) === '新问法' &&
      restoredC.messages.some((message) => message.role === 'user' && message.content === '旧问法') &&
      restoredC.messages.length === 3,
    'root=' + (rootMessage ? textOf(rootMessage) : 'undefined')
  )
  check(
    '会话 C 可见链：新问法 → 根分支回答',
    JSON.stringify(visibleTexts(restoredC)) === JSON.stringify(['新问法', '根分支回答']),
    JSON.stringify(visibleTexts(restoredC))
  )

  const imageFiles = new Map<string, FileAttachment>()
  for (const message of restoredA.messages) {
    if (message.role === 'user') {
      for (const file of message.files) {
        if (file.isImage) {
          imageFiles.set(file.id, file)
        }
      }
    }
  }
  for (const message of restoredB.messages) {
    if (message.role === 'user') {
      for (const file of message.files) {
        if (file.isImage) {
          imageFiles.set(file.id, file)
        }
      }
    }
  }
  const imageBytesOk: string[] = []
  for (const id of SOURCE_IMAGE_IDS) {
    const blob = await db.loadFile(id)
    const bytes = blob ? await bytesOf(blob) : []
    if (!sameBytes(bytes, SOURCE_IMAGE_BYTES[id])) {
      imageBytesOk.push(id)
    }
  }
  check('3 张图片原件字节与导出前一致', imageBytesOk.length === 0, JSON.stringify(imageBytesOk))
  check(
    '图片 MIME 由原件重新识别（png/jpeg）',
    imageFiles.get('imgA1')?.mimeType === 'image/png' &&
      imageFiles.get('imgA2')?.mimeType === 'image/jpeg' &&
      imageFiles.get('imgB1')?.mimeType === 'image/png',
    JSON.stringify([...imageFiles.entries()].map(([id, file]) => [id, file.mimeType]))
  )

  const doc = restoredB.messages
    .flatMap((message) => (message.role === 'user' ? message.files : []))
    .find((file) => file.id === 'docB1')
  check(
    '非图片附件只保留元数据（名称/大小/isImage），没有原件',
    doc !== undefined && doc.name === 'notes.txt' && doc.size === 11 && doc.isImage === false && (await db.loadFile('docB1')) === undefined,
    JSON.stringify(doc)
  )
}

// ---------------------------------------------------------------- 4. 幂等：再导入一次
section('幂等：同一份包再导入一次')
const second = await importHistory(e0File, 'merge', () => {})
const secondSnapshot = await snapshot()
info('二次导入 added=' + counterOf(second, 'added') + ' updated=' + counterOf(second, 'updated') + '，快照=' + JSON.stringify(secondSnapshot))
check('二次导入不新增会话（added=0）', counterOf(second, 'added') === 0, JSON.stringify(second))
check(
  '二次导入后会话/消息/图片数完全不变（无重复）',
  JSON.stringify(secondSnapshot) === JSON.stringify(restoredSnapshot),
  JSON.stringify(secondSnapshot)
)
const filesAfterSecond = await Promise.all(SOURCE_IMAGE_IDS.map((id) => db.loadFile(id)))
check('二次导入后 3 张图片原件仍在', filesAfterSecond.every((blob) => blob !== undefined))

// ---------------------------------------------------------------- 5. 同 id 比本地多 2 轮
section('合并：导入包比本地多 2 轮（同 id）')
const localA = (await allSessions()).get('rtA')
if (!localA) {
  check('合并场景前置：本地有 rtA', false)
} else {
  const shortA = structuredClone(localA)
  const shortTail = getVisibleMessages(shortA).at(-1)
  if (!shortTail) {
    check('合并场景前置：rtA 有可见消息', false)
  } else {
    const extraUser: UserMessage = user(
      'extra-u',
      '追加问题（只存在于导入包）',
      shortTail.createdAt + 1000,
      shortTail.id,
      'extra-a'
    )
    const extraAssistant = assistant(
      'extra-a',
      '追加回答（只存在于导入包）',
      shortTail.createdAt + 2000,
      'extra-u'
    )
    const longA: Session = {
      ...shortA,
      updatedAt: shortA.updatedAt + 10_000,
      messages: [
        ...shortA.messages.map((message) =>
          message.id === shortTail.id ? { ...message, selectedChildId: 'extra-u' } : message
        ),
        extraUser,
        extraAssistant,
      ],
    }
    await db.saveSession(longA)
    await syncStore()
    const longExport = await exportHistory()
    await db.saveSession(structuredClone(shortA))
    await syncStore()
    const beforeMerge = await snapshot()

    const longFile = fileOf(longExport.blob, 'long.zip')
    const mergeResult = await importHistory(longFile, 'merge', () => {})
    const afterMerge = await snapshot()
    info(
      '同 id 多 2 轮：added=' +
        counterOf(mergeResult, 'added') +
        ' updated=' +
        counterOf(mergeResult, 'updated') +
        '，会话数 ' +
        beforeMerge.sessionCount +
        '→' +
        afterMerge.sessionCount +
        '，rtA 消息 ' +
        beforeMerge.counts.rtA +
        '→' +
        afterMerge.counts.rtA
    )
    info('当前语义：同 id 直接命中本地会话 → 走 mergeArchivedSession 追加，不新建会话、不丢消息')
    check('同 id 多 2 轮：不新建重复会话', afterMerge.sessionCount === beforeMerge.sessionCount)
    check(
      '同 id 多 2 轮：两次都追加进原会话（消息数 +2）',
      counterOf(mergeResult, 'added') === 0 && afterMerge.counts.rtA === (beforeMerge.counts.rtA ?? 0) + 2,
      JSON.stringify(afterMerge.counts)
    )
    const mergedA = (await allSessions()).get('rtA')
    const mergedVisible = mergedA ? visibleTexts(mergedA) : []
    check(
      '同 id 多 2 轮：追加内容在可见链末尾',
      mergedA !== undefined &&
        mergedVisible.at(-2) === '追加问题（只存在于导入包）' &&
        mergedVisible.at(-1) === '追加回答（只存在于导入包）',
      JSON.stringify(mergedVisible)
    )
    const mergedIds = mergedA?.messages.map((message) => message.id) ?? []
    check('同 id 多 2 轮：消息 id 无重复', new Set(mergedIds).size === mergedIds.length, String(mergedIds.length))
    check(
      '同 id 多 2 轮：图片原件仍为 3 张',
      JSON.stringify(afterMerge.imageIds) === JSON.stringify(SOURCE_IMAGE_IDS),
      JSON.stringify(afterMerge.imageIds)
    )
  }
}

// ---------------------------------------------------------------- 6. 图片同 id 不同字节
/*
 * 当前语义（导入降级重构后）：
 * - merge 模式：同一附件 id 本地已有不同原件时，保留本地那份、记 imageConflictLocal 告警，导入继续；
 * - 不会覆盖用户已有原件，也不会因此整包失败（旧行为是 backupConflictingFile 整包失败）。
 */
section('冲突：图片 id 相同但字节不同（merge 降级为告警，保留本地原件）')
const conflictExport = await exportHistory()
const conflictFile = fileOf(conflictExport.blob, 'conflict.zip')
const originalB1 = await db.loadFile('imgB1')
const mutatedBytes = new Uint8Array([...IMG_B1, 0xee])
await db.saveFiles([{ id: 'imgB1', blob: new Blob([mutatedBytes], { type: 'image/png' }) }])
const beforeConflict = await snapshot()
const conflictResult = await importHistory(conflictFile, 'merge', () => {})
const afterConflict = await snapshot()
info('merge 导入同 id 不同字节：不抛错，结果=' + JSON.stringify({ added: counterOf(conflictResult, 'added'), updated: counterOf(conflictResult, 'updated') }))
check('同 id 不同字节（merge）：导入成功、不整包失败', conflictResult !== undefined)
check('同 id 不同字节（merge）：正式数据不变（会话/消息/图片数一致）', JSON.stringify(afterConflict) === JSON.stringify(beforeConflict), JSON.stringify({ before: beforeConflict, after: afterConflict }))
const mutatedB1 = await db.loadFile('imgB1')
check(
  '同 id 不同字节（merge）：本地原件优先，没有被归档覆盖',
  mutatedB1 !== undefined && sameBytes(await bytesOf(mutatedB1), [...mutatedBytes]),
  mutatedB1 ? String(mutatedB1.size) : 'undefined'
)
check('merge 导入结束后暂存清空（0/0）', (await stagingCounts()) === '0/0', await stagingCounts())

// 直接调用 importArchive 检查降级告警（importHistory 目前不向上返回 ImportReport）
const { importArchive } = await import('../src/services/chat/history/importArchive.ts')
await db.clearStaging()
let conflictReport: Awaited<ReturnType<typeof importArchive>> | undefined
try {
  conflictReport = await importArchive(conflictFile, true, () => {})
} catch (error) {
  conflictReport = undefined
  info('直接调用 importArchive 抛错：' + String(error))
}
check(
  '降级报告：sessions=3 且含 imageConflictLocal 告警',
  conflictReport !== undefined &&
    conflictReport.sessions === 3 &&
    conflictReport.warnings.some((warning) => warning.kind === 'imageConflictLocal'),
  JSON.stringify(conflictReport?.warnings)
)
check(
  '降级报告：冲突图片没有被写入暂存（本地原件才算数）',
  conflictReport !== undefined && conflictReport.images === 0,
  JSON.stringify(conflictReport ? { images: conflictReport.images } : {})
)
await db.clearStaging()

// 恢复原件后同一访问包应可重复导入，且不新增/不丢
await db.saveFiles([{ id: 'imgB1', blob: originalB1 as Blob }])
const recovered = await importHistory(conflictFile, 'merge', () => {})
const afterRecovered = await snapshot()
check(
  '恢复原件后同一导入包可再次导入（失败/告警不留死锁）',
  recovered !== undefined && JSON.stringify(afterRecovered) === JSON.stringify(beforeConflict),
  JSON.stringify(afterRecovered)
)
const recoveredB1 = await db.loadFile('imgB1')
check(
  '恢复后图片字节与导出时一致',
  recoveredB1 !== undefined && sameBytes(await bytesOf(recoveredB1), [...IMG_B1])
)

// ---------------------------------------------------------------- 7. off_ 跨命名空间
section('合并：官方同步 off_<id> vs 导入裸 id（内容不一致）')
const Z_TIME = Date.UTC(2025, 10, 1, 11, 0, 0)
const officialZ: Session = {
  id: 'off_rtZ',
  title: '官方同步的 Z',
  createdAt: Z_TIME,
  updatedAt: Z_TIME + 2000,
  rootMessageId: 'zu1',
  messages: [
    user('zu1', 'Z 第一问', Z_TIME + 1000, null, 'za1'),
    assistant('za1', 'Z 第一答', Z_TIME + 2000, 'zu1'),
  ],
}
await db.saveSession(officialZ)
await syncStore()
const importedZ: Session = {
  id: 'rtZ',
  title: '导入的 Z',
  createdAt: Z_TIME,
  updatedAt: Z_TIME + 4000,
  rootMessageId: 'qu1',
  messages: [
    user('qu1', 'Z 第一问', Z_TIME + 1000, null, 'qa1'),
    assistant('qa1', 'Z 第一答', Z_TIME + 2000, 'qu1'),
    user('qu2', 'Z 第二问（官方没有）', Z_TIME + 3000, 'qa1', 'qa2'),
    assistant('qa2', 'Z 第二答（官方没有）', Z_TIME + 4000, 'qu2'),
  ],
}
const syntheticBlob = await exportArchive([importedZ])
const beforeZ = await snapshot()
const zResult = await importHistory(fileOf(syntheticBlob, 'rtZ.zip'), 'merge', () => {})
const zSessions = await allSessions()
/*
 * 这条对话在本地可能出现两个 id（off_rtZ / rtZ）。当前实现有两种合法合并形态：
 * - 旧 db.mergeStaging：内容不一致 → 另存为裸 id 会话（off_rtZ=2 条 + rtZ=4 条）；
 * - 新 decideImportedSession（mergeSession.ts）：并入官方会话（off_rtZ=4 条，不再建裸 id 副本）。
 * 本用例只锁"不丢内容、不重复、不覆盖官方已有内容"这三个不变量，形态如实输出。
 */
const zIds = [...zSessions.keys()].filter((id) => id === 'rtZ' || id === 'off_rtZ')
const zShape = zIds
  .map((id) => ({ id, messages: zSessions.get(id)?.messages.length ?? 0 }))
  .sort((left, right) => left.id.localeCompare(right.id))
const zTexts = zIds.flatMap((id) => (zSessions.get(id)?.messages ?? []).map(textOf))
const expectedZTexts = [
  'Z 第一问',
  'Z 第一答',
  'Z 第二问（官方没有）',
  'Z 第二答（官方没有）',
]
const mergedIntoOfficial =
  zShape.length === 1 && zShape[0].id === 'off_rtZ' && zShape[0].messages === 4
const keptAsSeparate =
  zShape.length === 2 &&
  zShape.some((item) => item.id === 'off_rtZ' && item.messages === 2) &&
  zShape.some((item) => item.id === 'rtZ' && item.messages === 4)
info(
  '跨命名空间：added=' +
    counterOf(zResult, 'added') +
    ' updated=' +
    counterOf(zResult, 'updated') +
    '，会话数 ' +
    beforeZ.sessionCount +
    '→' +
    zSessions.size +
    '，形态=' +
    JSON.stringify(zShape)
)
info(
  mergedIntoOfficial
    ? '形态=并入官方会话（跨命名空间内容已去重，decideImportedSession 语义）'
    : '形态=另存独立会话（当前 db.mergeStaging 旧语义：off_ 与裸 id 两份对话并存；decideImportedSession 接入 db 后会变成并入官方会话）'
)
check(
  '跨命名空间：导入的多 2 轮内容不会丢失',
  expectedZTexts.every((text) => zTexts.includes(text)),
  JSON.stringify(zTexts)
)
const perSessionDuplicates = zIds.flatMap((id) => {
  const texts = (zSessions.get(id)?.messages ?? []).map(textOf)
  return texts.filter((text, index) => texts.indexOf(text) !== index)
})
check(
  '跨命名空间：单条会话内部没有重复消息',
  perSessionDuplicates.length === 0,
  JSON.stringify(perSessionDuplicates)
)
check(
  '跨命名空间：合并形态符合当前实现（并入官方会话，或另存独立会话；不出现半截覆盖）',
  mergedIntoOfficial || keptAsSeparate,
  JSON.stringify(zShape)
)
const crossSessionDuplicates = expectedZTexts.filter(
  (text) => zTexts.filter((item) => item === text).length > 1
)
info('跨会话重复内容：' + JSON.stringify(crossSessionDuplicates))
check(
  '跨命名空间：若两份会话并存，重复只应是同一段对话的两份投影（旧语义，前 2 轮各一份）',
  !keptAsSeparate ||
    (crossSessionDuplicates.length === 2 &&
      ['Z 第一问', 'Z 第一答'].every((text) => crossSessionDuplicates.includes(text))),
  JSON.stringify(crossSessionDuplicates)
)
check(
  '跨命名空间：官方已有 2 条内容没被替换/丢失',
  ['Z 第一问', 'Z 第一答'].every((text) => zTexts.includes(text)) &&
    zSessions.get('off_rtZ') !== undefined,
  JSON.stringify(zTexts)
)
check(
  '跨命名空间：store 会话列表同步更新',
  useChatStore.getState().sessions.length === zSessions.size,
  useChatStore.getState().sessions.length + ' vs ' + zSessions.size
)

// ---------------------------------------------------------------- 收尾
console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL')
if (fail > 0) {
  process.exitCode = 1
}
