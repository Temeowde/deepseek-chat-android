import { initChat, useChatStore } from './chat/store.js'

/**
 * 启动后台维护。
 *
 * 以前官方同步、补正文、预热缓存、重复清理和首次备份都挤在启动后的前几秒：
 * 旧手机上本地库大一点就会卡住甚至被系统判定无响应。这里统一下沉：
 * 首屏完全稳定 5 秒后，串行、限量地做；每个任务之间让出主线程，失败静默。
 */

const DELAY_MS = 5000
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

let scheduled = false

const run = async () => {
  try {
    if (!useChatStore.getState().ready) {
      await initChat()
    }
  } catch {
    return
  }
  if (document.visibilityState === 'hidden') {
    // 用户在后台时不做重活，回到前台再说（下次冷启动会重新调度）
    return
  }
  // 1. 存量重复消息清理：每个 app 数据只做一次，内部按批让出主线程
  try {
    const { dedupeStoredOfficialSessions } = await import('./official/sync.js')
    await dedupeStoredOfficialSessions()
  } catch {
    // 后台维护失败不影响使用
  }
  await pause(600)
  // 2. 只补少量没有正文的官方会话（以前一次 120 个，首屏后网络+落库会拖很久）
  try {
    const { backfillMissingBodies } = await import('./official/sync.js')
    await backfillMissingBodies(12)
  } catch {
    // 下次启动继续补
  }
}

/** 首屏渲染完成后再调度；同一进程只调度一次。 */
export const scheduleStartupMaintenance = () => {
  if (scheduled) {
    return
  }
  scheduled = true
  window.setTimeout(() => {
    void run()
  }, DELAY_MS)
}
