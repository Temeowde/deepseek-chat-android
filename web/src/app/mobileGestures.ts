import { dismissSearchPanel, useSearchPanel } from '../components/search/searchPanelState.js'
import { closeSettings, useSettingsDialog } from '../components/settings/settingsDialogState.js'
import {
  closeMobileSider,
  openMobileSider,
  useMobileSider,
} from '../components/sider/mobileSiderState.js'

export const handleNativeBack = (): boolean => {
  if (dismissSearchPanel()) return true
  const table = document.querySelector<HTMLDialogElement>('dialog[data-table-full][open]')
  if (table) { table.close(); return true }
  if (window.closeMobileSettings?.() || window.closeMessageAction?.() ||
      window.cancelComposerVoice?.() || window.closeComposerAttachments?.() ||
      window.cancelChatDrawerDrag?.() || window.closeHistoryAction?.()) return true
  if (useSettingsDialog.getState().open) {
    closeSettings()
    return true
  }
  if (useMobileSider.getState().open) {
    closeMobileSider()
    return true
  }
  return window.cancelComposerEdit?.() ?? false
}

export const bindNativeBack = () => {
  window.DeepSeekHandleBack = handleNativeBack
  return () => {
    delete window.DeepSeekHandleBack
  }
}

/** Track the finger while dragging and let the drawer settle after release. */
export const bindMobileGestures = (enabled: boolean) => {
  if (!enabled) return
  return window.bindChatDrawerDrag({
    isOpen: () => useMobileSider.getState().open,
    change: open => open ? openMobileSider() : closeMobileSider(),
    blocked: () => useMobileSider.getState().searching || useSettingsDialog.getState().open || !!useSearchPanel.getState().entry ||
      !!document.querySelector('.ds-history-scrim,.ds-history[data-selecting=true]'),
  })
}
