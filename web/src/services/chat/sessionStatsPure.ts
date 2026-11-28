import type { SessionStatsRow } from './db.js'

/** 会话选择页的排序方式 */
export type SessionSort = 'recent' | 'rounds'

/** 选择页每行需要的完整信息：摘要 + 轮次统计（统计未就绪时 rounds=0） */
export type PickerRow = {
  id: string
  title: string
  pinned: boolean
  createdAt: number
  updatedAt: number
  rounds: number
  /** 轮次统计还没算完（不显示 0 轮，免得不准确） */
  roundsPending: boolean
  /** undefined = 统计还没算完，先不显示「未同步正文」 */
  hasContent?: boolean
}

/** 把会话摘要和统计合并成选择页的行数据；stats 为 null 表示还在算。 */
export const mergeSessionRows = (
  summaries: readonly { id: string; title?: string | null; pinned?: boolean; createdAt: number; updatedAt: number }[],
  stats: readonly SessionStatsRow[] | null
): PickerRow[] => {
  const byId = new Map<string, SessionStatsRow>()
  for (const stat of stats ?? []) {
    byId.set(stat.id, stat)
  }
  return summaries.map((summary) => {
    const stat = byId.get(summary.id)
    return {
      id: summary.id,
      title: summary.title ?? '',
      pinned: Boolean(summary.pinned),
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      rounds: stat?.rounds ?? 0,
      roundsPending: !stat,
      hasContent: stat ? stat.hasContent : undefined,
    }
  })
}

/** 按标题搜索（大小写不敏感；空查询返回全部） */
export const filterByTitle = <T extends { title: string }>(rows: readonly T[], query: string): T[] => {
  const needle = query.trim().toLowerCase()
  if (!needle) {
    return [...rows]
  }
  return rows.filter((row) => row.title.toLowerCase().includes(needle))
}

/** 排序：置顶优先；recent = 最近更新倒序，rounds = 轮次倒序（轮次相同按最近更新） */
export const sortSessionRows = <T extends { pinned: boolean; updatedAt: number; rounds: number }>(
  rows: readonly T[],
  mode: SessionSort
): T[] => {
  const compare = (a: T, b: T) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1
    }
    if (mode === 'rounds' && a.rounds !== b.rounds) {
      return b.rounds - a.rounds
    }
    return b.updatedAt - a.updatedAt
  }
  return [...rows].sort(compare)
}
