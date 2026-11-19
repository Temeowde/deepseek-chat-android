import { formatDate } from '../../utils/format.js'
import * as db from './db.js'
import { applyHistory, useChatStore, type HistoryImportMode } from './store.js'
import type { Session } from './types.js'

export { BackupError } from './history/errors.js'

// 导入、导出与全部删除串行处理，避免读取归档时数据被清空或两个替换事务交错。
let backupQueue: Promise<unknown> = Promise.resolve()

const enqueueBackup = <T>(run: () => Promise<T>): Promise<T> => {
  const task = backupQueue.then(run)
  backupQueue = task.catch(() => {})
  return task
}

const backupFileName = (date: Date) => `deepseek_data-${formatDate(date)}.zip`

/** 导出为历史会话导出格式的 ZIP，可再次导入。 */
export const exportHistory = (): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(async () => {
    // 列表和已加载内容保留导出开始时的快照；未打开的会话逐条读取，不填满详情缓存。
    const { sessions, sessionCache } = useChatStore.getState()
    async function* readSessions(): AsyncGenerator<Session> {
      for (const summary of sessions) {
        const session = Object.hasOwn(sessionCache, summary.id)
          ? sessionCache[summary.id]
          : await db.loadSession(summary.id)
        if (!session) {
          throw new Error(`History session disappeared during export: ${summary.id}`)
        }
        // 详情读取期间可能重命名，归档标题与开始时的列表保持一致。
        yield { ...session, ...summary }
      }
    }
    const { exportArchive } = await import('./history/exportArchive.js')
    const now = new Date()
    const blob = await exportArchive(readSessions())
    return { name: backupFileName(now), blob }
  })

export type HistoryImportProgress = { stage: 'checking' | 'saving' } | { stage: 'reading'; percent: number }

/** 检查格式后流式导入，读取与保存分别报告进度。 */
export const importHistory = (
  file: File,
  mode: HistoryImportMode,
  onProgress: (progress: HistoryImportProgress) => void,
) => enqueueBackup(async () => {
  const { checkArchiveFormat, importArchive } = await import('./history/importArchive.js')
  await checkArchiveFormat(file)
  return applyHistory(async () => {
    let lastPercent = -1
    await importArchive(file, mode === 'merge', (done, total) => {
      const percent = Math.min(100, Math.floor(done / total * 100))
      if (percent !== lastPercent) {
        onProgress({ stage: 'reading', percent })
        lastPercent = percent
      }
    })
    onProgress({ stage: 'saving' })
  }, mode)
})

/** 确认删除后调用：以空历史原子替换全部本地会话与附件，保留 API Key 和其他设置。 */
export const clearHistory = (): Promise<void> =>
  enqueueBackup(async () => {
    await applyHistory(async () => {}, 'replace')
  })
