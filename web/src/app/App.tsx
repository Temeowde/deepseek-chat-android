import clsx from 'clsx'
import { useEffect } from 'react'
import { useTranslate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  initChat,
  refreshActiveSession,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import {
  backupLocal,
  lastBackupAt,
  localBackupReady,
  localBackupSupported,
} from '../services/chat/localBackup.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileConversation } from '../components/session/MobileConversation.js'
import { Welcome } from '../components/session/Welcome.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { BackupPermissionPrompt } from '../components/settings/BackupPermissionPrompt.js'
import { Toast } from '../components/base/Toast.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { autoRead } from '../services/chat/store.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { closeMobileSider, useMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import { bindMobileGestures, bindNativeBack } from './mobileGestures.js'
import { registerOfficialSync, registerVoiceDemoWatcher, syncOfficialSummaries } from '../services/official/sync.js'
import { maybeAutoCheckin } from '../services/workbuddy/billing.js'
import styles from './App.module.css'

/**
 * 本地保留：开启且有权限时，每 2 分钟静默备份一次。
 *
 * 备份已经改成增量（只写上次之后有变化的会话，实测 0.1~0.5 秒、几百 KB），
 * 所以可以把间隔压短，接近"聊完就备份"；以前是完整导出几分钟，只能 10 分钟一次。
 */
const LOCAL_BACKUP_INTERVAL = 2 * 60_000
const LOCAL_BACKUP_FIRST_DELAY = 30_000

const useLocalBackupSchedule = () => {
  /*
   * 依赖要跟着"开关"和"会话是否就绪"走：
   * 以前依赖是 [] —— 用户在设置里打开开关后，这个 effect 不会重跑，
   * 自动备份直到下次冷启动才生效（看起来就是"开关打开了但从来没备份过"）。
   */
  const enabled = useSettings((state) => state.localBackup)
  const ready = useChatStore((state) => state.ready)
  const sessionCount = useChatStore((state) => state.sessions.length)

  useEffect(() => {
    if (!localBackupSupported() || !enabled) {
      return
    }
    let timer = 0
    let disposed = false
    /** 会话就绪并且确实有内容时才备份，避免启动早期写出空包 */
    const run = () => {
      if (disposed) {
        return
      }
      const state = useChatStore.getState()
      if (!state.ready || state.sessions.length === 0 || !localBackupReady()) {
        return
      }
      /*
       * 自动备份至少间隔 60 秒（增量包很小，失败/重复的代价也低）。
       * 调度 effect 会随「开关/会话数」变化重新挂载，没有闸门会被反复触发。
       */
      if (Date.now() - lastBackupAt() < 60_000) {
        return
      }
      // 增量模式：只导出自上次备份后有变化的会话
      void backupLocal('auto').catch(() => {})
    }
    // 权限可能是用户从系统设置页返回后才有的：没有权限时轮询，有了就立刻进入正常节奏
    const start = () => {
      window.clearInterval(timer)
      timer = window.setInterval(run, LOCAL_BACKUP_INTERVAL)
    }
    const first = window.setTimeout(() => {
      run()
      start()
    }, LOCAL_BACKUP_FIRST_DELAY)
    const waitForAccess = window.setInterval(() => {
      if (!localBackupReady()) {
        return
      }
      window.clearInterval(waitForAccess)
      run()
    }, 3000)
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        run()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      window.clearTimeout(first)
      window.clearInterval(timer)
      window.clearInterval(waitForAccess)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, ready, sessionCount])
}

export const App = () => {
  useLocalBackupSchedule()
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const mobileSiderOpen = useMobileSider((state) => state.open)

  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)

  usePreventPageScroll(isMobile)

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])
  useEffect(bindNativeBack, [])
  useEffect(() => bindMobileGestures(isMobile), [isMobile])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 切换会话时停止朗读
  useEffect(() => autoRead.observe(useChatStore.subscribe, document, window), [])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile])

  useEffect(() => {
    registerOfficialSync()
    // 切换朗读音色时自动播放官方试听句（和官方 App 一样）
    registerVoiceDemoWatcher()
    void initChat().then(() => {
      // 启动后补齐「只有摘要没有正文」的官方会话，导出/离线也能拿到完整内容
      void import('../services/official/sync.js')
        .then(({ backfillMissingBodies }) => backfillMissingBodies())
        .catch(() => {})
    })
  }, [])

  // 每天自动签到：App 启动时在后台静默尝试一次，失败不影响聊天。
  useEffect(() => {
    void maybeAutoCheckin()
  }, [])

  // 回到前台时同步官方会话：列表和当前正在看的官方会话都要刷新。
  useEffect(() => {
    let last = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      if (document.visibilityState === 'hidden') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const now = Date.now()
        if (now - last < 8000) return
        last = now
        void syncOfficialSummaries().then((ok) => {
          if (ok) window.dispatchEvent(new Event('official-account-changed'))
        })
        refreshActiveSession()
      }, 400)
    }
    // 原生 onResume 会派发 app-resume，比 WebView 的 focus 更可靠。
    const resume = () => {
      last = 0
      refresh()
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('app-resume', resume)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('app-resume', resume)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  const available = ready && (activeId === null || !!session)
  const loadFailed = !ready ? initError : sessionLoadError
  const loading = !available && (
    <div className={styles.loadingView}>
      <div className={styles.loadingState} role="status" aria-live="polite">
        {loadFailed ? (
          <>
            <span>{t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')}</span>
            <Button
              variant="outlined"
              size="m"
              onClick={() => {
                if (!ready) void initChat()
                else if (activeId !== null) selectSession(activeId)
              }}
            >
              {t('retry')}
            </Button>
          </>
        ) : (
          <span className={isMobile ? styles.delayedLoading : undefined}>{t('sessionLoading')}</span>
        )}
      </div>
    </div>
  )

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        {isMobile ? <MobileSider /> : siderCollapsed ? null : <Sider />}
        <main className={clsx(styles.main, isMobile && mobileSiderOpen && styles.mainCardOpen)}>
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content}>
            {siderCollapsed ? <CollapsedSider /> : null}
            {isMobile ? (
              <MobileConversation
                activeId={activeId}
                session={session}
                available={available}
                loading={loading}
                streaming={streaming}
              />
            ) : !available ? loading : session ? (
              <SessionView
                session={session}
                streaming={streaming}
                siderCollapsed={siderCollapsed}
              />
            ) : (
              <Welcome />
            )}
          </div>
        </main>
        <SearchPanel />
      </div>
      <SettingsDialog />
      <BackupPermissionPrompt />
      <Toast />
    </>
  )
}
