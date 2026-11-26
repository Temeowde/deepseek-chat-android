/**
 * 合并/去重规则测试（真跑源码，不是模拟）
 * 运行：cd web && npx tsx ../tools/test-merge.mts
 */
import type { AssistantMessage, Session, UserMessage } from '../web/src/services/chat/types.ts'

/*
 * 业务模块会顺带 import 到 settings.ts（里面直接用 window.chatDisplayPrefs），
 * 在 Node 里跑测试先装一个"随便怎么访问都不炸"的 window 桩。
 */
const stub: any = new Proxy(function () {}, {
  get: (_target, key) => (key === 'then' ? undefined : stub),
  apply: () => stub,
})
;(globalThis as any).window = stub
;(globalThis as any).__API_ORIGIN__ = 'https://example.invalid'
;(globalThis as any).document = stub
;(globalThis as any).localStorage = stub

const { mergeArchivedSession, sessionsEquivalent } = await import('../web/src/services/chat/history/mergeSession.ts')

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log('PASS  ' + name) }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  → ' + detail : '')) }
}

const user = (id: string, text: string, createdAt: number, parentId: string | null): UserMessage => ({
  id, role: 'user', content: text, createdAt, parentId, selectedChildId: null, files: [],
})
const assistant = (id: string, text: string, createdAt: number, parentId: string): AssistantMessage => ({
  id, role: 'assistant', createdAt, parentId, selectedChildId: null,
  blocks: [{ type: 'text', text }], model: 'deepseek-chat', status: 'done', prefix: false,
  thinking: false, search: false, files: [],
})

const session = (id: string, messages: any[], rootMessageId = messages[0]?.id ?? null): Session => ({
  id, title: 'T', createdAt: 1, updatedAt: 2, rootMessageId, messages,
})

// 1. 完全一致
const base = [user('u1', 'hi', 100, null), assistant('a1', 'hello', 200, 'u1')]
const s1 = session('off_x', base.map(m => ({ ...m })))
const s2 = session('x', base.map(m => ({ ...m })))
check('完全一致 → 视为同一会话', sessionsEquivalent(s1, s2) === true)

// 2. 导入的多出两轮（用户反馈的丢消息场景）
const longer = [...base, user('u2', 'second', 300, 'a1'), assistant('a2', 'ok', 400, 'u2')]
const s3 = session('x', longer)
check('导入多两轮 → 不视为同一会话', sessionsEquivalent(s1, s3) === false)

// 3. 条数相同但内容不同
const different = [user('u1', 'hi', 100, null), assistant('a1', 'DIFFERENT', 200, 'u1')]
check('条数相同内容不同 → 不视为同一会话', sessionsEquivalent(s1, session('x', different)) === false)

// 4. 条数相同但时间不同（导出后时间被改）
const retimed = [user('u1', 'hi', 101, null), assistant('a1', 'hello', 201, 'u1')]
check('条数相同时间不同 → 不视为同一会话（保守处理）', sessionsEquivalent(s1, session('x', retimed)) === false)

// 5. 空 vs 空
check('两个空会话 → 一致', sessionsEquivalent(session('a', []), session('b', [])) === true)

// 6. 空 vs 有内容 → 不一致
check('空 vs 有内容 → 不一致', sessionsEquivalent(session('a', []), s1) === false)

// 7. mergeArchivedSession 仍能合并追加（既不丢消息，也不报错）
const merged = mergeArchivedSession(s1, s3)
const mergedIds = new Set(merged.messages.map(m => m.id))
check('合并后导入的额外消息仍在', mergedIds.has('u2') && mergedIds.has('a2'), JSON.stringify([...mergedIds]))

// 8. mergeArchivedSession 对完全一致的会话不应新增重复消息
const merged2 = mergeArchivedSession(s1, s2)
check('完全一致时合并后消息数不变', merged2.messages.length === s1.messages.length, String(merged2.messages.length))

console.log(`\n结果：${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
