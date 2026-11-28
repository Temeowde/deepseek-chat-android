import { useSettings } from '../settings.js'

/**
 * 导出包里的诊断信息：只放版本/环境/设置，不含任何对话正文。
 * 用户反馈 bug 时只需要导出出问题的那几段对话 + 这份诊断，隐私暴露最小。
 */
export type ExportDiagnostics = Record<string, unknown>

const appVersion = (): string => {
  if (typeof document === 'undefined') {
    return ''
  }
  return document.querySelector('meta[name="application-version"]')?.getAttribute('content') ?? ''
}

export const buildExportDiagnostics = (counts: {
  selected: number
  total: number
}): ExportDiagnostics => {
  const settings = useSettings.getState()
  return {
    app_version: appVersion(),
    exported_at: new Date().toISOString(),
    platform: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    language: typeof navigator === 'undefined' ? '' : navigator.language,
    viewport:
      typeof window === 'undefined' ? '' : `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio || 1}`,
    provider: settings.provider,
    workbuddy_model: settings.workbuddyModel,
    thinking: settings.thinking,
    search: settings.search,
    safety_check: settings.safetyCheck,
    locale: settings.locale,
    theme: settings.themePreference,
    tts_voice: settings.ttsVoice,
    api_key_present: Boolean(settings.apiKey),
    selected_sessions: counts.selected,
    total_sessions: counts.total,
  }
}
