/**
 * 部分导入（merge）降级 + 跨命名空间合并的 Node 测试。
 *
 * 覆盖：
 * 1. 整包 1 个会话 JSON 损坏 → merge 只跳过它，其它会话照常导入；replace 仍然整包失败。
 * 2. 图片与本地原件同 id 不同字节 / 归档内部同 id 两份不同字节 → merge 只记 warning，不整包失败。
 * 3. 归档 index 少一条 / 多一条 / 重复 → merge 继续导入并提示；replace 仍然失败。
 * 4. 片段被 schema 丢弃、index 的 message_count 不符 → 有统计（以前是静默的）。
 * 5. 跨命名空间（裸 id ↔ off_ 前缀）按内容对齐合并：不新建重复会话、不把同一轮对话变分支、不丢消息。
 *
 * 运行（仓库根目录）：
 *   node web/node_modules/tsx/dist/cli.mjs tools/test-import-merge.mts
 * 或在 web 目录：
 *   npx tsx ../tools/test-import-merge.mts
 */
import assert from 'node:assert/strict'

import type { Session } from '../web/src/services/chat/types.js'
import type { ImportStore } from '../web/src/services/chat/history/importArchive.js'

// 被测模块链会 import i18n → settings，Node 里没有浏览器环境，先垫最小实现再动态导入。
const storage = new Map<string, string>()
const shim: Record<string, unknown> = {
  chatDisplayPrefs: {
    read: (_name: string, initial: string) => initial,
    save: () => true,
  },
  addEventListener: () => {},
  removeEventListener: () => {},
}
Object.assign(globalThis, {
  window: shim,
  __API_ORIGIN__: 'http://localhost',
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  },
})

const archives = await import('../web/src/services/chat/history/importArchive.js')
const zip = await import('../web/src/services/chat/history/zipWriter.js')
const schema = await import('../web/src/services/chat/history/schema.js')
const toLocal = await import('../web/src/services/chat/history/toLocal.js')
const merge = await import('../web/src/services/chat/history/mergeSession.js')

let passed = 0
const test = async (name: string, run: () => Promise<void> | void): Promise<void> => {
  try {
    await run()
    passed += 1
    console.log(`ok ${passed} - ${name}`)
  } catch (error) {
    process.exitCode = 1
    console.error(`not ok - ${name}`)
    console.error(error)
  }
}

const encoder = new TextEncoder()
const json = (value: unknown) => new Blob([encoder.encode(JSON.stringify(value))])
const binary = (bytes: number[]) => new Blob([new Uint8Array(bytes)])
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 9, 9]

type EntrySpec = { name: string; blob: Blob }
const manifest = (): EntrySpec => ({ name: 'manifest.json', blob: json({ export_format_version: 3 }) })
const buildArchive = async (entries: EntrySpec[]): Promise<File> => {
  const blob = await zip.writeArchive(entries)
  return new File([blob], 'deepseek_data-test.zip', { type: 'application/zip' })
}

type FileSpec = {
  id: string
  name: string
  size?: number
  image?: boolean
  /** 图片在 ZIP 里的条目名；缺省为 null（归档里没有原件） */
  path?: string | null
}
type MessageSpec = {
  id: number
  parentId: number | null
  role: 'USER' | 'ASSISTANT'
  text: string
  files?: FileSpec[]
  /** 时间戳（ISO）；缺省按 id 生成 */
  at?: string
  /** 追加一个 schema 无法识别的片段，用于验证"片段丢失"统计 */
  brokenFragment?: boolean
}

const second = (index: number) => `2026-11-20T10:00:${String(index).padStart(2, '0')}.000Z`

const sessionFile = (
  id: string,
  messages: MessageSpec[],
  options: { title?: string; currentId?: number } = {}
) => ({
  id,
  title: options.title ?? `会话 ${id}`,
  pinned: false,
  current_message_id: options.currentId ?? messages.at(-1)?.id ?? 0,
  inserted_at: '2026-11-20T09:59:00.000Z',
  updated_at: '2026-11-21T10:00:00.000Z',
  messages: messages.map((message) => ({
    id: message.id,
    parent_id: message.parentId,
    role: message.role,
    status: 'FINISHED',
    thinking_enabled: false,
    search_enabled: false,
    accumulated_token_usage: 0,
    inserted_at: message.at ?? second(message.id),
    fragments: [
      ...(message.files && message.files.length > 0
        ? [
            {
              type: 'FILE',
              files: message.files.map((file) => ({
                id: file.id,
                file_name: file.name,
                file_size: file.size ?? 1,
                token_usage: null,
                inserted_at: message.at ?? second(message.id),
                export_path: file.path === undefined ? null : file.path,
                is_image: file.image ?? false,
                width: null,
                height: null,
              })),
            },
          ]
        : []),
      ...(message.role === 'USER'
        ? [{ type: 'REQUEST', content: message.text }]
        : [{ type: 'RESPONSE', content: message.text }]),
      ...(message.brokenFragment ? [{ type: 'UNKNOWN_FRAGMENT', content: 'x' }] : []),
    ],
  })),
})

type SessionFileFixture = ReturnType<typeof sessionFile>
const indexEntry = (file: SessionFileFixture, override: Record<string, unknown> = {}) => ({
  id: file.id,
  title: file.title,
  pinned: false,
  message_count: file.messages.length,
  inserted_at: file.inserted_at,
  updated_at: file.updated_at,
  ...override,
})
const indexFile = (entries: unknown[]): EntrySpec => ({
  name: 'chat_session_index.json',
  blob: json(entries),
})
const sessionEntry = (file: SessionFileFixture): EntrySpec => ({
  name: `chat_sessions/${file.id}.json`,
  blob: json(file),
})

/** 内存版导入暂存：接口与 db.ts 的三个 staging 方法一致，语义也照抄（MIME 回填、置顶回填）。 */
const memoryStore = (initial: { sessions?: Session[]; files?: Record<string, Blob> } = {}) => {
  const sessions = new Map<string, Session>()
  for (const session of initial.sessions ?? []) {
    sessions.set(session.id, session)
  }
  const files = new Map<string, Blob>(Object.entries(initial.files ?? {}))
  const staged = new Map<string, Blob>()
  const store: ImportStore = {
    async addStagingSession(session) {
      assert.equal(sessions.has(session.id), false, `暂存里已经有 ${session.id}`)
      sessions.set(session.id, session)
    },
    async saveStagingFiles(list) {
      for (const item of list) {
        staged.set(item.id, item.blob)
      }
    },
    async loadStagingFile(id) {
      return staged.get(id)
    },
    async loadFile(id) {
      return files.get(id)
    },
    async updateStagingFileTypes(types, pins) {
      for (const session of sessions.values()) {
        if (session.pinned === undefined && pins.has(session.id)) {
          session.pinned = pins.get(session.id)
        }
        for (const message of session.messages) {
          if (message.role !== 'user') {
            continue
          }
          for (const attachment of message.files) {
            attachment.mimeType = types.get(attachment.id) ?? ''
          }
        }
      }
    },
  }
  return { sessions, files, staged, store }
}

const importWith = (file: File, mergeMode: boolean, store: ImportStore) =>
  archives.importArchive(file, mergeMode, () => {}, store)

const rejectsWith = (promise: Promise<unknown>, key: string) =>
  assert.rejects(promise, (error: unknown) =>
    error !== null && typeof error === 'object' && (error as { key?: string }).key === key
  )

const appMessage = (text: string, id: number, parentId: number | null): MessageSpec => ({
  id,
  parentId,
  role: id % 2 === 1 ? 'USER' : 'ASSISTANT',
  text,
})

await test('merge：单条会话损坏只跳过它，其它会话照常导入；replace 仍然整包失败', async () => {
  const good = sessionFile('s-good', [
    { id: 1, parentId: null, role: 'USER', text: '你好' },
    { id: 2, parentId: 1, role: 'ASSISTANT', text: '你好呀' },
  ])
  const other = sessionFile('s-other', [
    { id: 1, parentId: null, role: 'USER', text: '第二个会话' },
    { id: 2, parentId: 1, role: 'ASSISTANT', text: '收到' },
  ])
  const broken: EntrySpec = {
    name: 'chat_sessions/s-broken.json',
    blob: new Blob([encoder.encode('{"id":"s-broken", 这不是 JSON')]),
  }
  const entries = [
    manifest(),
    sessionEntry(good),
    broken,
    sessionEntry(other),
    indexFile([indexEntry(good), indexEntry(other)]),
  ]
  const memory = memoryStore()
  const report = await importWith(await buildArchive(entries), true, memory.store)
  assert.equal(report.sessions, 2)
  assert.equal(report.skippedSessions, 1)
  assert.deepEqual([...memory.sessions.keys()].sort(), ['s-good', 's-other'])
  assert.ok(
    report.warnings.some((warning) => warning.kind === 'sessionSkipped' && warning.id === 's-broken'),
    '应记录 sessionSkipped warning'
  )
  // 覆盖模式是一次性替换全部历史：坏包必须整包失败，不能静默少导入
  await rejectsWith(
    importWith(await buildArchive(entries), false, memoryStore().store),
    'backupInvalidJson'
  )
})

await test('merge：图片同 id 不同字节只记 warning，不整包失败，也不覆盖本地原件', async () => {
  const session = sessionFile('s-img', [
    {
      id: 1,
      parentId: null,
      role: 'USER',
      text: '看这张图',
      files: [
        { id: 'img-local', name: 'a.png', size: PNG.length, image: true, path: 'chat_sessions/s-img_files/img-local_a.png' },
      ],
    },
    { id: 2, parentId: 1, role: 'ASSISTANT', text: '看到了' },
  ])
  const archive = await buildArchive([
    manifest(),
    sessionEntry(session),
    indexFile([indexEntry(session)]),
    { name: 'chat_sessions/s-img_files/img-local_a.png', blob: binary(PNG) },
  ])
  const localOriginal = new Blob([new Uint8Array(JPEG)], { type: 'image/jpeg' })
  const memory = memoryStore({ files: { 'img-local': localOriginal } })
  const report = await importWith(archive, true, memory.store)
  assert.equal(report.sessions, 1)
  assert.equal(memory.files.get('img-local'), localOriginal, '本地原件不能被覆盖')
  assert.equal(memory.staged.has('img-local'), false, '冲突的归档图片不写暂存')
  assert.ok(report.warnings.some((warning) => warning.kind === 'imageConflictLocal'))
  const imported = memory.sessions.get('s-img')!
  const first = imported.messages[0]
  assert.equal(first.role === 'user' && first.files[0].mimeType, 'image/jpeg', 'MIME 用本地原件识别')
})

await test('merge：归档内部同一附件 id 对应两份不同字节 → 保留先到的一份并 warning', async () => {
  const first = sessionFile('s-one', [
    {
      id: 1,
      parentId: null,
      role: 'USER',
      text: '图一',
      files: [{ id: 'img-dup', name: 'a.png', size: PNG.length, image: true, path: 'chat_sessions/s-one_files/img-dup_a.png' }],
    },
    { id: 2, parentId: 1, role: 'ASSISTANT', text: '好' },
  ])
  const second2 = sessionFile('s-two', [
    {
      id: 1,
      parentId: null,
      role: 'USER',
      text: '图二',
      files: [{ id: 'img-dup', name: 'b.png', size: JPEG.length, image: true, path: 'chat_sessions/s-two_files/img-dup_b.png' }],
    },
    { id: 2, parentId: 1, role: 'ASSISTANT', text: '好' },
  ])
  const archive = await buildArchive([
    manifest(),
    sessionEntry(first),
    sessionEntry(second2),
    indexFile([indexEntry(first), indexEntry(second2)]),
    { name: 'chat_sessions/s-one_files/img-dup_a.png', blob: binary(PNG) },
    { name: 'chat_sessions/s-two_files/img-dup_b.png', blob: binary(JPEG) },
  ])
  const memory = memoryStore()
  const report = await importWith(archive, true, memory.store)
  assert.equal(report.sessions, 2)
  assert.equal(report.images, 1, '只保存先读到的一份')
  assert.ok(report.warnings.some((warning) => warning.kind === 'imageConflictInArchive'))
})

await test('merge：index 少一条 → 继续导入并提示；replace 仍然失败', async () => {
  const first = sessionFile('s-a', appMessagePair('甲'))
  const second2 = sessionFile('s-b', appMessagePair('乙'))
  const entries = [manifest(), sessionEntry(first), sessionEntry(second2), indexFile([indexEntry(first)])]
  const memory = memoryStore()
  const report = await importWith(await buildArchive(entries), true, memory.store)
  assert.equal(report.sessions, 2)
  const mismatch = report.warnings.find((warning) => warning.kind === 'indexMismatch')
  assert.ok(mismatch && mismatch.kind === 'indexMismatch')
  assert.deepEqual(mismatch.missing, ['s-b'])
  assert.deepEqual(mismatch.extra, [])
  await rejectsWith(importWith(await buildArchive(entries), false, memoryStore().store), 'backupIncomplete')
})

await test('merge：index 多一条 / 重复 → 继续导入并提示；replace 仍然失败', async () => {
  const first = sessionFile('s-a', appMessagePair('甲'))
  const second2 = sessionFile('s-b', appMessagePair('乙'))
  const withGhost = [manifest(), sessionEntry(first), sessionEntry(second2), indexFile([indexEntry(first), indexEntry(second2), indexEntry(first, { id: 'ghost' })])]
  const ghostReport = await importWith(await buildArchive(withGhost), true, memoryStore().store)
  const ghostMismatch = ghostReport.warnings.find((warning) => warning.kind === 'indexMismatch')
  assert.ok(ghostMismatch && ghostMismatch.kind === 'indexMismatch')
  assert.deepEqual(ghostMismatch.extra, ['ghost'])
  await rejectsWith(importWith(await buildArchive(withGhost), false, memoryStore().store), 'backupIncomplete')

  const duplicated = [manifest(), sessionEntry(first), sessionEntry(second2), indexFile([indexEntry(first), indexEntry(first), indexEntry(second2)])]
  const duplicateReport = await importWith(await buildArchive(duplicated), true, memoryStore().store)
  const duplicateMismatch = duplicateReport.warnings.find((warning) => warning.kind === 'indexMismatch')
  assert.ok(duplicateMismatch && duplicateMismatch.kind === 'indexMismatch')
  assert.deepEqual(duplicateMismatch.extra, ['s-a'])
  assert.deepEqual(duplicateMismatch.missing, [])
})

await test('merge：没有 index 也能导入（只提示），片段丢失与 message_count 不符都有统计', async () => {
  const session = sessionFile('s-drop', [
    { id: 1, parentId: null, role: 'USER', text: '问题' },
    { id: 2, parentId: 1, role: 'ASSISTANT', text: '回答', brokenFragment: true },
  ])
  const noIndex = await buildArchive([manifest(), sessionEntry(session)])
  const noIndexReport = await importWith(noIndex, true, memoryStore().store)
  assert.equal(noIndexReport.sessions, 1)
  assert.ok(noIndexReport.warnings.some((warning) => warning.kind === 'indexUnreadable'))
  await rejectsWith(importWith(noIndex, false, memoryStore().store), 'backupIncomplete')

  const mismatchIndex = await buildArchive([
    manifest(),
    sessionEntry(session),
    indexFile([indexEntry(session, { message_count: 3 })]),
  ])
  const report = await importWith(mismatchIndex, true, memoryStore().store)
  assert.equal(report.droppedFragments, 1)
  assert.ok(
    report.warnings.some(
      (warning) => warning.kind === 'sessionFragmentsDropped' && warning.id === 's-drop' && warning.dropped === 1
    )
  )
  assert.ok(
    report.warnings.some(
      (warning) =>
        warning.kind === 'sessionMessageCountMismatch' &&
        warning.id === 's-drop' &&
        warning.declared === 3 &&
        warning.actual === 2
    )
  )
})

function appMessagePair(text: string): MessageSpec[] {
  return [
    { id: 1, parentId: null, role: 'USER', text },
    { id: 2, parentId: 1, role: 'ASSISTANT', text: `回答 ${text}` },
  ]
}

// ---------- 跨命名空间：官方同步会话（off_/o_/of_） ↔ 官方 ZIP 导入会话（裸 id） ----------

const BASE = Date.parse('2026-11-20T10:00:00.000Z')
const at = (index: number, jitter = 0) => new Date(BASE + index * 60_000 + jitter).toISOString()

/** 模拟 official/sync.ts 生成的本地会话：消息 id o_*、附件 id of_*、时间由秒级时间戳重建。 */
const officialSession = (): Session => ({
  id: 'off_x1',
  title: '官方会话',
  createdAt: BASE,
  // 官方摘要的 updatedAt 比归档新（正常情况：同步比导出晚）
  updatedAt: Date.parse('2026-11-22T00:00:00.000Z'),
  rootMessageId: 'o_1',
  messages: [
    {
      id: 'o_1',
      role: 'user',
      content: '第一个问题',
      createdAt: BASE,
      parentId: null,
      selectedChildId: 'o_2',
      files: [
        { id: 'of_img', serverId: null, name: 'a.png', size: 3, isImage: true, mimeType: 'image/png', remoteUrl: 'https://cdn/a.png' },
      ],
    },
    {
      id: 'o_2',
      role: 'assistant',
      createdAt: BASE + 60_000,
      parentId: 'o_1',
      selectedChildId: 'o_3',
      model: null,
      prefix: true,
      status: 'done',
      blocks: [{ type: 'text', text: '第一个回答' }],
    },
    {
      id: 'o_3',
      role: 'user',
      content: '第二个问题',
      createdAt: BASE + 120_000,
      parentId: 'o_2',
      selectedChildId: 'o_4',
      files: [],
    },
    {
      id: 'o_4',
      role: 'assistant',
      createdAt: BASE + 180_000,
      parentId: 'o_3',
      model: null,
      prefix: true,
      status: 'done',
      blocks: [{ type: 'text', text: '第二个回答' }],
    },
  ],
})

const archivedMessages = (count: number): MessageSpec[] => {
  const texts = ['第一个问题', '第一个回答', '第二个问题', '第二个回答', '第三个问题', '第三个回答']
  return texts.slice(0, count).map((text, index) => ({
    id: index + 1,
    parentId: index === 0 ? null : index,
    role: index % 2 === 0 ? 'USER' : 'ASSISTANT',
    text,
    // 官方导出是 ISO 毫秒、官方同步是秒级重建：这里特意带 700ms 抖动
    at: at(index, 700),
    ...(index === 0
      ? { files: [{ id: 'img-bare', name: 'a.png', size: 3, image: true }] }
      : {}),
  }))
}

const readArchived = (id: string, count: number): Session => {
  const file = sessionFile(id, archivedMessages(count))
  return toLocal.toLocalSession(schema.readSessionFile(file)).session
}

await test('跨命名空间：归档并进官方会话，不新建重复会话、不把同一轮对话变分支', async () => {
  const official = officialSession()
  const incoming = readArchived('x1', 6)
  // 严格逐条比较在跨命名空间下永远不成立（id 前缀/附件 id/时间精度/开关都不同）——
  // 这就是 db.mergeStaging 只在等价时合并、结果列表里总出两条的原因。
  assert.equal(merge.sessionsEquivalent(official, incoming), false)

  const contentMerge = merge.mergeSessionsByContent(official, incoming)
  assert.equal(contentMerge.matched, 4, '4 条内容对齐')
  assert.equal(contentMerge.added, 2, '归档多出来的第三条问答追加')

  const decision = merge.decideImportedSession(incoming, { official })
  assert.equal(decision.session.id, 'off_x1', '写回官方会话 id')
  assert.equal(decision.unchanged, false)
  assert.deepEqual(decision.redundant, [])
  assert.equal(decision.session.messages.length, 6)
  // 同一轮对话只能有一份
  assert.equal(
    decision.session.messages.filter((message) => message.role === 'user' && message.content === '第一个问题').length,
    1
  )
  // 本地已有的分支选择、附件都不动
  assert.equal(decision.session.rootMessageId, 'o_1')
  assert.equal(decision.session.messages.find((message) => message.id === 'o_1')?.selectedChildId, 'o_2')
  const firstQuestion = decision.session.messages.find((message) => message.id === 'o_1')
  assert.equal(firstQuestion?.role === 'user' && firstQuestion.files.length, 1)
  // 新消息接在官方最后一条回答之后，父节点映射正确
  const thirdQuestion = decision.session.messages.find(
    (message) => message.role === 'user' && message.content === '第三个问题'
  )
  assert.equal(thirdQuestion?.parentId, 'o_4')
})

await test('跨命名空间：归档只是官方会话的子集 → unchanged，一行都不用写', async () => {
  const official = officialSession()
  const subset = readArchived('x1', 4)
  assert.equal(merge.sessionContentsIncluded(official, subset), true)
  const decision = merge.decideImportedSession(subset, { official })
  assert.equal(decision.unchanged, true)
  assert.equal(decision.session, official, '没有变化时返回原对象，调用方可以跳过写库')
})

await test('跨命名空间：本机已有裸 id 重复副本 → 并进官方会话并给出可删除的冗余 id', async () => {
  const official = officialSession()
  const subset = readArchived('x1', 4)
  const legacyCopy = readArchived('x1', 4)
  assert.equal(merge.sessionsEquivalent(official, legacyCopy), false)
  const decision = merge.decideImportedSession(subset, { official, legacy: legacyCopy })
  assert.deepEqual(decision.redundant, ['x1'], '裸副本没有独有内容，可以删')
  assert.equal(decision.session.id, 'off_x1')
  assert.equal(decision.session.messages.length, 4)
})

await test('跨命名空间：归档是本项目导出的 off_ 包、本机只有裸 id 旧副本 → 并进旧副本，不再新增', async () => {
  const ids = merge.sessionNamespaceIds('off_x1')
  assert.equal(ids.identity, 'x1')
  assert.equal(ids.officialId, 'off_x1')
  assert.equal(ids.legacyId, 'x1')
  const bareIds = merge.sessionNamespaceIds('x1')
  assert.equal(bareIds.officialId, 'off_x1')
  assert.equal(bareIds.legacyId, 'x1')

  const ownExport = readArchived('off_x1', 4)
  const legacyCopy = readArchived('x1', 4)
  // db 侧按 sessionNamespaceIds 查：本机没有 off_x1，只有裸 x1，作为 legacy 传入
  const decision = merge.decideImportedSession(ownExport, { legacy: legacyCopy })
  assert.equal(decision.session.id, 'x1', '并进已有的裸副本而不是再建一条 off_ 会话')
  assert.equal(decision.unchanged, true)
})

if (process.exitCode === undefined) {
  console.log(`\n全部通过：${passed} 项`)
} else {
  console.error(`\n有失败项（通过 ${passed} 项），见上面 not ok`)
}
