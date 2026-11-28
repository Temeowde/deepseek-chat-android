import { useEffect, useRef, useState } from 'react'
import { Modal } from '../base/Modal.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import { useTranslate } from '../../i18n/index.js'
import { setLocalBackup, useSettings } from '../../services/settings.js'
import { localBackupSupported, requestLocalBackupAccess, scheduleLocalBackup } from '../../services/chat/localBackup.js'

/** 每个版本只主动提示一次；用户拒绝后同一版本不再打扰，升级新版本再问一次 */
const PROMPT_VERSION_KEY = 'chat-demo:backup-permission-prompt-version'
/** 有权限时每个版本自动把「本地保留」打开一次（用户之后手动关掉则不再强制） */
const AUTO_ENABLE_VERSION_KEY = 'chat-demo:backup-auto-enable-version'

const appVersion = (): string => {
  try {
    return document.querySelector('meta[name="application-version"]')?.getAttribute('content') || '0'
  } catch {
    return '0'
  }
}

const hasAllFilesAccess = (): boolean => {
  try {
    return window.BackupAndroid?.hasAccess?.() === true
  } catch {
    return false
  }
}

/**
 * 本机备份权限引导。
 *
 * 背景：以前「本地保留」默认关闭，很多用户用很久都不知道有备份；
 * 现在第一次启动 / 升级到新版本时主动说明并申请「所有文件访问权限」。
 * - 已有权限：自动把本地保留打开（每个版本一次），不再打扰；
 * - 没有权限：每个版本弹一次说明，同意就去系统设置授权，不同意就算了；
 * - 权限只用于读写 /sdcard/DS-Chat 的备份文件。
 */
export const BackupPermissionPrompt = () => {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const checked = useRef(false)

  useEffect(() => {
    if (checked.current) {
      return
    }
    checked.current = true
    const timer = window.setTimeout(() => {
      if (!localBackupSupported()) {
        return
      }
      // 支持/排查用：本地设置这个开关时强制展示引导弹窗
      let forced = false
      try {
        forced = localStorage.getItem('chat-demo:backup-prompt-test') === '1'
      } catch {
        forced = false
      }
      if (forced) {
        setOpen(true)
        return
      }
      const version = appVersion()
      if (hasAllFilesAccess()) {
        let applied = ''
        try {
          applied = localStorage.getItem(AUTO_ENABLE_VERSION_KEY) ?? ''
        } catch {
          applied = ''
        }
        if (applied !== version) {
          try {
            localStorage.setItem(AUTO_ENABLE_VERSION_KEY, version)
          } catch {
            // 存储不可用不影响其它逻辑
          }
          if (!useSettings.getState().localBackup) {
            setLocalBackup(true)
            scheduleLocalBackup()
            showToast(t('backupAutoEnabled'))
          }
        }
        return
      }
      let prompted = ''
      try {
        prompted = localStorage.getItem(PROMPT_VERSION_KEY) ?? ''
      } catch {
        prompted = ''
      }
      if (prompted === version) {
        return
      }
      try {
        localStorage.setItem(PROMPT_VERSION_KEY, version)
      } catch {
        // ignore
      }
      setOpen(true)
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [t])

  useEffect(() => {
    if (!waiting) {
      return
    }
    let timer = 0
    const check = (final: boolean) => {
      if (hasAllFilesAccess()) {
        setWaiting(false)
        setOpen(false)
        setLocalBackup(true)
        scheduleLocalBackup()
        showToast(t('backupPermissionGranted'))
        return
      }
      if (final) {
        setWaiting(false)
        setOpen(false)
        showToast(t('backupPermissionDeclined'))
      }
    }
    const onResume = () => {
      if (document.visibilityState === 'hidden') {
        return
      }
      window.clearTimeout(timer)
      timer = window.setTimeout(() => check(true), 1200)
    }
    window.addEventListener('app-resume', onResume)
    window.addEventListener('focus', onResume)
    document.addEventListener('visibilitychange', onResume)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('app-resume', onResume)
      window.removeEventListener('focus', onResume)
      document.removeEventListener('visibilitychange', onResume)
    }
  }, [waiting, t])

  if (!open) {
    return null
  }

  return (
    <Modal
      title={t('backupPermissionTitle')}
      onClose={() => {
        setOpen(false)
        setWaiting(false)
      }}
      footer={
        <>
          <Button
            variant="outlined"
            size="m"
            onClick={() => {
              setOpen(false)
              setWaiting(false)
            }}
          >
            {t('backupPermissionLater')}
          </Button>
          <Button
            variant="primary"
            size="m"
            onClick={() => {
              setWaiting(true)
              requestLocalBackupAccess()
            }}
          >
            {t('backupPermissionOpen')}
          </Button>
        </>
      }
    >
      <p>{t('backupPermissionBody')}</p>
      <p>{t('backupPermissionBody2')}</p>
    </Modal>
  )
}
