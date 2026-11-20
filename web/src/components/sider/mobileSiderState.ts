import { create } from 'zustand'

/** 移动端侧边栏抽屉：顶栏菜单按钮打开，点遮罩、切换会话或开启新对话后关闭 */
export const useMobileSider = create(() => ({ open: false, searching: false }))

/** 打开侧栏时收起软键盘，和官方 App 的行为一致。 */
const dismissKeyboard = () => {
  if (typeof document === 'undefined') return
  const active = document.activeElement
  if (active instanceof HTMLElement) active.blur()
}

export const openMobileSider = () => {
  dismissKeyboard()
  useMobileSider.setState({ open: true })
}

export const closeMobileSider = () => useMobileSider.setState({ open: false, searching: false })

export const setMobileHistorySearch = (searching: boolean) => {
  if (useMobileSider.getState().open) useMobileSider.setState({ searching })
}
