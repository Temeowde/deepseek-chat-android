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
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileConversation } from '../components/session/MobileConversation.js'
import { Welcome } from '../components/session/Welcome.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { Toast } from '../components/base/Toast.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { autoRead } from '../services/chat/store.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { closeMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import { bindMobileGestures, bindNativeBack } from './mobileGestures.js'
import { registerOfficialSync, syncOfficialSummaries } from '../services/official/sync.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
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
    void initChat()
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
        <main className={styles.main}>
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
      <Toast />
    </>
  )
}
