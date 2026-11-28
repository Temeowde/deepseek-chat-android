import { formatDate } from '../../utils/format.js'
import * as db from './db.js'
import { applyHistory, useChatStore, type HistoryImportMode } from './store.js'
import type { FileAttachment, Session } from './types.js'

export { BackupError } from './history/errors.js'

// 导入、导出与全部删除串行处理，避免读取归档时数据被清空或两个替换事务交错。
let backupQueue: Promise<unknown> = Promise.resolve()

const enqueueBackup = <T>(run: () => Promise<T>): Promise<T> => {
  const task = backupQueue.then(run)
  backupQueue = task.catch(() => {})
  return task
}

const backupFileName = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  // 带上时分秒：同一天多次导出不会撞名，也避免把上一次的 0 字节残留当成这次的结果
  return `deepseek_data-${formatDate(date)}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.zip`
}

/** 单张图片下载超时；官方 CDN 慢时不能挂住导出。 */
const IMAGE_TIMEOUT = 20000
/** 一次导出最多补拉多少张图片（0 = 不限制）；账号图多的用户就是靠这个把包补全的 */
const IMAGE_BACKFILL_LIMIT = 5000
/** 图片补拉并发数 */
const IMAGE_CONCURRENCY = 4
/**
 * 每条会话最多保留多少张图片。
 *
 * 老会话的图片在官方接口里常常没有下载地址（signed_path 为空），补也补不回来；
 * 用户要求「只保留每条对话最近的 20 张」，所以导出/备份时按时间倒序截断，
 * 既避免把几百 MB 的旧图塞进包，也保证最近的图一定在。
 */
const IMAGE_KEEP_PER_SESSION = 20

type ImageBackfillReport = {
  saved: number
  total: number
  /** 没有 remoteUrl / 下载失败 / 空响应，导致最终仍缺原件的张数 */
  missing: number
  noRemoteUrl: number
  failed: number
}

/**
 * 按「每条会话最近 N 张」裁剪图片引用。
 *
 * 只裁剪 isImage 的附件；其它文件（文档等）保留原有元数据行为。
 * 返回省略的张数，供导出报告展示（这是用户明确选择的裁剪，不算"丢失"）。
 */
const trimSessionImages = (
  sessions: Session[],
  keepPerSession = IMAGE_KEEP_PER_SESSION,
): { sessions: Session[]; omitted: number; kept: number } => {
  let omitted = 0
  let kept = 0
  const next = sessions.map((session) => {
    const images: { id: string; at: number }[] = []
    for (const message of session.messages) {
      if (message.role !== 'user') {
        continue
      }
      for (const file of message.files ?? []) {
        if (file.isImage) {
          images.push({ id: file.id, at: Number(message.createdAt) || 0 })
        }
      }
    }
    if (images.length <= keepPerSession) {
      kept += images.length
      return session
    }
    // 最新在前，保留前 N 张
    images.sort((a, b) => b.at - a.at)
    const keep = new Set(images.slice(0, keepPerSession).map((image) => image.id))
    kept += keep.size
    omitted += images.length - keep.size
    return {
      ...session,
      messages: session.messages.map((message) =>
        message.role === 'user'
          ? {
              ...message,
              files: (message.files ?? []).filter((file) => !file.isImage || keep.has(file.id)),
            }
          : message
      ),
    }
  })
  return { sessions: next, omitted, kept }
}

/**
 * 导出前补拉图片原件。
 *
 * 归档只写「本地有原件」的图片（见 exportArchive），而官方账号的图片是打开会话时
 * 才懒加载的（每个会话最多补 6 张）。所以直接导出会丢掉绝大部分图片 ——
 * 这也是为什么官方 App 导出的包有几百 MB，我们导出来的只有几十 MB。
 *
 * 现在把所有消息里的图片都算进来（以前只看 user 消息，AI 回复里的图会被漏掉），
 * 并发 4、单张 20s 超时，并把失败原因分类统计出来（不再静默）。
 */
const backfillImages = async (
  sessions: Session[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImageBackfillReport> => {
  const pending: FileAttachment[] = []
  const seen = new Set<string>()
  let noRemoteUrl = 0
  for (const session of sessions) {
    for (const message of session.messages) {
      // 图片附件挂在用户消息上（AssistantMessage 只有内容块，没有 files 字段）
      if (message.role !== 'user') {
        continue
      }
      for (const file of message.files ?? []) {
        if (!file.isImage || seen.has(file.id)) {
          continue
        }
        seen.add(file.id)
        if (await db.loadFile(file.id)) {
          continue
        }
        if (!file.remoteUrl) {
          noRemoteUrl += 1
          continue
        }
        pending.push(file)
      }
    }
  }
  const targets = IMAGE_BACKFILL_LIMIT > 0 ? pending.slice(0, IMAGE_BACKFILL_LIMIT) : pending
  let saved = 0
  let failed = 0
  let done = 0
  let cursor = 0
  const runWorker = async () => {
    while (true) {
      const index = cursor
      cursor += 1
      const file = targets[index]
      if (!file) {
        return
      }
      const remoteUrl = file.remoteUrl
      if (!remoteUrl) {
        failed += 1
        continue
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT)
      try {
        const response = await fetch(remoteUrl, { signal: controller.signal })
        if (!response.ok) {
          failed += 1
          return
        }
        const blob = await response.blob()
        if (blob.size === 0) {
          failed += 1
          return
        }
        await db.saveFiles([{ id: file.id, blob }])
        saved += 1
      } catch {
        // 单张失败不影响导出，但计入 missing
        failed += 1
      } finally {
        clearTimeout(timer)
        done += 1
        if (done % IMAGE_CONCURRENCY === 0 || done === targets.length) {
          onProgress?.(done, targets.length)
        }
      }
    }
  }
  await Promise.all(Array.from({ length: IMAGE_CONCURRENCY }, () => runWorker()))
  onProgress?.(targets.length, targets.length)
  return { saved, total: pending.length, missing: failed + Math.max(0, pending.length - targets.length), noRemoteUrl, failed }
}

/** 导出为历史会话导出格式的 ZIP，可再次导入。 */
/**
 * 导出历史对话：默认导出全部；传 sessionIds 时只导出选中的会话（部分导出）。
 *
 * 官方账号同步下来的会话本地只有摘要，没有消息实体；直接导出会被跳过，
 * 用户拿到的包就很小。所以这里先逐个把这些会话从官方接口下载下来（顺带落库），
 * 再统一打包，保证「全部导出」是字面意义上的全部。
 */
export type ExportHistoryOptions = {
  onProgress?: (percent: number) => void
  /** 只导出这些会话；省略 = 全部（保持旧行为） */
  sessionIds?: readonly string[]
  /** 写进 manifest 的诊断信息（版本/机型/设置，不含对话正文） */
  diagnostics?: Record<string, unknown>
}

export const exportHistory = (
  options: ExportHistoryOptions = {},
): Promise<{
  name: string
  blob: Blob
  /** 有内容、真正写进归档的会话数 */
  exported: number
  /** 会话总数（列表里的条数） */
  total: number
  /** 本地没正文、官方也没拉下来的会话数（会以「空壳」形式写进归档，不会丢对话） */
  skipped: number
  /** 空壳会话数（只有标题的会话） */
  shells: number
  /** 官方接口成功补下来的会话数 */
  fetched: number
  /** 官方返回 200 但 biz_data 为空（通常是登录态失效）的次数 */
  emptyResponses: number
  /** 是否因为连续失败提前停止补拉 */
  fetchAborted: boolean
  fetchError: string
  images: number
  imageTotal: number
  /** 仍然缺原件的图片张数（下载失败/没有远端地址） */
  skippedImages: number
  /** 没有 remoteUrl、根本没法补的图片张数 */
  noRemoteUrlImages: number
  /** 按「每条会话最近 20 张」规则主动省略的旧图片数 */
  omittedImages: number
  skippedSessions: number
}> =>
  enqueueBackup(async () => {
    const onProgress = options.onProgress
    const { sessions, sessionCache } = useChatStore.getState()
    const wanted = options.sessionIds ? new Set(options.sessionIds) : null
    const list = wanted ? sessions.filter((summary) => wanted.has(summary.id)) : sessions
    if (list.length === 0) {
      // 启动早期会话列表还没加载，或本地确实没数据：不能写一个"空备份"骗用户
      throw new Error(wanted ? '没有选择可导出的对话' : '本地还没有可导出的对话')
    }
    const total = list.length
    const ready: Session[] = []
    let skipped = 0
    let fetched = 0
    let done = 0
    /** 官方接口共同的失败原因（例如「未登录官方账号」），导出结束后如实展示 */
    let fetchError = ''
    /** 单个会话补正文的最长等待：官方接口偶发挂住时不能拖死整个导出 */
    const FETCH_TIMEOUT = 12000
    /** 连续失败这么多次就停止补拉，剩下的按「没有内容」统计 */
    const FAILURE_BREAK = 8
    let consecutiveFailures = 0
    let stopFetching = false
    let emptyResponses = 0
    let skippedImages = 0
    let skippedSessions = 0
    /** 只有标题、没有正文的「空壳会话」：也写进归档，导入后对话不消失，打开时再从官方补正文 */
    let shells = 0
    const withTimeout = <T,>(run: () => Promise<T>, ms = FETCH_TIMEOUT): Promise<T> =>
      Promise.race([
        run(),
        new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error('官方接口超时')), ms)),
      ])
    const retryable = async <T,>(run: () => Promise<T>): Promise<T> => {
      try {
        return await run()
      } catch (first) {
        // 官方接口偶发超时/限流：退避后重试一次
        await new Promise((resolve) => setTimeout(resolve, 600))
        try {
          return await run()
        } catch {
          throw first
        }
      }
    }

    // 阶段一：补齐本地没有内容的会话（并发 4；0% ~ 50%）
    const results = new Array<Session | undefined>(total)
    let cursor = 0
    const runWorker = async () => {
      while (true) {
        const index = cursor
        cursor += 1
        const summary = list[index]
        if (!summary) {
          return
        }
        let session: Session | undefined = Object.hasOwn(sessionCache, summary.id)
          ? sessionCache[summary.id]
          : await db.loadSession(summary.id)
        if (!session) {
          if (stopFetching) {
            /*
             * 补拉已熔断：不要直接丢会话。
             * 只写「标题 + 时间」的空壳，导入后对话还在（打开时会触发官方同步补正文），
             * 否则用户看到的就是"对话凭空少了几条"。
             */
            results[index] = {
              id: summary.id,
              title: summary.title,
              pinned: summary.pinned,
              createdAt: summary.createdAt,
              updatedAt: summary.updatedAt,
              messages: [],
            } as Session
            shells += 1
            done += 1
            if (total > 0) {
              onProgress?.(Math.floor((done / total) * 50))
            }
            continue
          }
          try {
            const { loadOfficialSession } = await import('../official/sync.js')
            session = await retryable(() => withTimeout(() => loadOfficialSession(summary.id)))
            if (session && session.messages.length > 0) {
              fetched += 1
              consecutiveFailures = 0
            } else {
              /*
               * 官方 200 但 biz_data 为空：几乎都是登录态失效（服务端返回登录页/空体）。
               * 以前这里也算成功并把熔断计数清零 → 723 条一条条慢慢跳、最后还显示"导出成功"。
               */
              emptyResponses += 1
              if (!fetchError) {
                fetchError = '官方接口返回空内容（通常是官方登录已失效）'
              }
              consecutiveFailures += 1
              if (consecutiveFailures >= FAILURE_BREAK) {
                stopFetching = true
              }
              session = undefined
            }
            await new Promise((resolve) => setTimeout(resolve, 120))
          } catch (error) {
            fetchError = error instanceof Error ? error.message : String(error)
            session = undefined
            // 登录失效/被拦截：继续逐条请求没有意义，立刻停
            if (/登录|认证|授权|401|403|被拦截|限流/i.test(fetchError)) {
              stopFetching = true
            }
            consecutiveFailures += 1
            if (consecutiveFailures >= FAILURE_BREAK) {
              // 官方接口整体不可用（超时/限流/掉线）：不要再一个个等超时
              stopFetching = true
            }
          }
        }
        if (session && session.messages.length > 0) {
          results[index] = { ...session, ...summary }
        } else {
          // 拿不到正文：写空壳，保证会话本身不丢
          results[index] = {
            id: summary.id,
            title: summary.title,
            pinned: summary.pinned,
            createdAt: summary.createdAt,
            updatedAt: summary.updatedAt,
            messages: [],
          } as Session
          shells += 1
          skipped += 1
        }
        done += 1
        if (total > 0) {
          onProgress?.(Math.floor((done / total) * 50))
        }
      }
    }
    // 并发 4：735 个会话串行逐个拉会卡在 0% 好几分钟
    await Promise.all(Array.from({ length: 4 }, () => runWorker()))
    for (const session of results) {
      if (session) {
        ready.push(session)
      }
    }

    const contentSessions = ready.filter((session) => (session.messages?.length ?? 0) > 0).length
    if (ready.length === 0 || contentSessions === 0) {
      throw new Error(
        `一个会话都没能导出：${total} 个会话里 ${skipped} 个本地只有标题没有正文` +
          (fetchError ? `（官方接口：${fetchError}）` : '') +
          '。请先确认官方账号登录有效，再重试。'
      )
    }
    /*
     * 只有极少数会话能导出、绝大多数只有标题时，导出的包基本没用。
     * 这种情况直接报错并说明原因（通常是没登录官方账号），不再给用户一个"看起来成功"的空包。
     */
    if (skipped > 0 && ready.length <= 5) {
      throw new Error(
        `有 ${skipped} 个对话本地只有标题没有内容（官方同步下来但没打开过）。` +
          (fetchError ? `官方接口返回：${fetchError}。` : '') +
          '请确认已登录官方账号（设置 → 账户），或在列表里逐个打开这些对话让正文缓存下来后再导出。'
      )
    }

    // 阶段一·五：每条会话只保留最近 20 张图片（用户选择；老图官方多半也不给地址）
    const trimmed = trimSessionImages(ready)
    const trimmedSessions = trimmed.sessions
    const omittedImages = trimmed.omitted

    // 阶段二：补拉图片原件（50% ~ 85%）
    const images = await backfillImages(trimmedSessions, (imageDone, imageTotal) => {
      if (imageTotal <= 0) {
        return
      }
      onProgress?.(50 + Math.floor((imageDone / imageTotal) * 35))
    })

    // 阶段三：打包（85% ~ 100%）
    const { exportArchive } = await import('./history/exportArchive.js')
    const blob = await exportArchive(
      trimmedSessions,
      (read, known) => {
        if (!known) {
          return
        }
        onProgress?.(85 + Math.min(14, Math.floor((read / known) * 14)))
      },
      (report) => {
        // exportArchive 内部跳过/容错统计：图片缺失、非法时间、损坏会话
        skippedImages = report?.skippedImages ?? 0
        skippedSessions += report?.skippedSessions ?? 0
      },
      options.diagnostics
    )
    onProgress?.(100)
    if (!blob || blob.size <= 0) {
      throw new Error('导出内容为空，请先打开几个对话后再试')
    }
    const now = new Date()
    return {
      name: backupFileName(now),
      blob,
      exported: ready.length,
      shells,
      total,
      skipped,
      fetched,
      emptyResponses,
      fetchAborted: stopFetching,
      fetchError,
      images: images.saved,
      imageTotal: images.total,
      skippedImages: skippedImages + images.missing,
      noRemoteUrlImages: images.noRemoteUrl,
      omittedImages,
      skippedSessions,
    }
  })

/**
 * 增量导出：只导出自 `sinceMs` 之后有变化的会话。
 *
 * 自动备份以前每次都跑一遍完整导出（700+ 会话、100MB+、几分钟），
 * 而两次备份之间通常只多一两条对话。这里只取 `updatedAt > sinceMs` 的会话，
 * 走同一条「补正文 → 裁剪图片 → 补图 → 打包」流程，产出一个几百 KB 的小包。
 * 恢复时按「完整包 + 后续增量包」顺序合并即可。
 */
export const exportIncremental = async (
  sinceMs: number,
  onProgress?: (percent: number) => void,
): Promise<{
  name: string
  blob: Blob
  sessions: number
  shells: number
  skippedImages: number
  omittedImages: number
} | null> => {
  const { sessions } = useChatStore.getState()
  // 留 2 分钟余量：避免时钟/写入时序导致刚改过的会话漏进下一次增量
  const threshold = Math.max(0, sinceMs - 120_000)
  const changed = sessions.filter((summary) => Number(summary.updatedAt) > threshold)
  if (changed.length === 0) {
    return null
  }
  const { exportArchive } = await import('./history/exportArchive.js')
  const ready: Session[] = []
  let shells = 0
  for (const summary of changed) {
    try {
      const stored = await db.loadSession(summary.id)
      if (stored && stored.messages.length > 0) {
        ready.push({ ...stored, ...summary })
      } else {
        const { loadOfficialSession } = await import('../official/sync.js')
        const fetched = await loadOfficialSession(summary.id)
        if (fetched && fetched.messages.length > 0) {
          ready.push({ ...fetched, ...summary })
        } else {
          ready.push({
            id: summary.id,
            title: summary.title,
            pinned: summary.pinned,
            createdAt: summary.createdAt,
            updatedAt: summary.updatedAt,
            messages: [],
          } as Session)
          shells += 1
        }
      }
    } catch {
      ready.push({
        id: summary.id,
        title: summary.title,
        pinned: summary.pinned,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        messages: [],
      } as Session)
      shells += 1
    }
  }
  const trimmed = trimSessionImages(ready)
  const images = await backfillImages(trimmed.sessions)
  onProgress?.(60)
  let report: { skippedImages?: number } = {}
  const blob = await exportArchive(
    trimmed.sessions,
    undefined,
    (value) => {
      report = value
    },
  )
  onProgress?.(100)
  if (!blob || blob.size <= 0) {
    return null
  }
  return {
    name: `deepseek_inc-${formatDate(new Date())}-${String(new Date().getHours()).padStart(2, '0')}${String(new Date().getMinutes()).padStart(2, '0')}${String(new Date().getSeconds()).padStart(2, '0')}.zip`,
    blob,
    sessions: trimmed.sessions.length,
    shells,
    skippedImages: (report.skippedImages ?? 0) + images.missing,
    omittedImages: trimmed.omitted,
  }
}

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
