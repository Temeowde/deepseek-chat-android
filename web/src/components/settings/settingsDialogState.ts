import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'

/** 设置弹窗的分组：通用设置 / 数据管理 */
export type SettingsSection = 'general' | 'data' | 'key'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  requestId: 0,
  section: 'general' as SettingsSection,
}))

/** 打开设置时是否要直接落到「API 供应商」二级页（没填 Key 就点发送、重试等） */
let pendingApiFocus = false

/** 面板挂载时消费一次：只生效一次，之后正常从一级页开始 */
export const consumeApiFocus = () => {
  const value = pendingApiFocus
  pendingApiFocus = false
  return value
}

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState((state) => ({ open: true, section, requestId: state.requestId + 1 }))

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/**
 * 没有 API Key 时打开设置并选中 API Key 所在的「数据管理」，返回是否已有 Key。
 *
 * WorkBuddy / 自定义供应商走各自的通道，不需要 DeepSeek API Key：
 * 这两种 provider 直接放行，否则点发送会被旧逻辑强制带到 API Key 页面。
 */
export const ensureApiKey = () => {
  const { apiKey, provider } = useSettings.getState()
  if (provider !== 'deepseek') {
    return true
  }
  if (apiKey) {
    return true
  }
  pendingApiFocus = true
  openSettings(window.matchMedia('(max-width: 767px)').matches ? 'key' : 'data')
  return false
}
