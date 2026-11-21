import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'
export type LocalePreference = Locale | 'system'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置；安卓密钥由原生 Keystore 保存，其余偏好存 localStorage */
type Settings = {
  apiKey: string | null
  locale: Locale
  localePreference: LocalePreference
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  safetyCheck: boolean
  siderCollapsed: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  safetyCheck: 'chat-demo:safety-check',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

const androidBridge = () => (typeof window === 'undefined' ? undefined : window.DeepSeekAndroid)

const initialApiKey = () => {
  const bridge = androidBridge()
  if (!bridge) {
    return read(KEYS.apiKey)
  }
  write(KEYS.apiKey, null)
  return bridge.getApiKey().trim() || null
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const resolveLocale = (value: LocalePreference): Locale =>
  value === 'system' ? (isChineseBrowser() ? 'zh-CN' : 'en-US') : value

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

const initialLocale = window.chatDisplayPrefs.read('locale', 'system')

export const useSettings = create<Settings>(() => ({
  apiKey: initialApiKey(),
  locale: resolveLocale(initialLocale),
  localePreference: initialLocale,
  location: initialLocation(),
  themePreference: window.chatDisplayPrefs.read('theme', 'system'),
  ttsVoice: window.chatDisplayPrefs.read('voice', 'stella'),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) !== 'false',
  safetyCheck: read(KEYS.safetyCheck) !== 'false',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setLocale = (localePreference: LocalePreference) => {
  if (window.chatDisplayPrefs.save('locale', localePreference)) {
    useSettings.setState({ localePreference, locale: resolveLocale(localePreference) })
  }
}

window.addEventListener('languagechange', () => {
  if (useSettings.getState().localePreference === 'system') useSettings.setState({ locale: resolveLocale('system') })
})

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  if (!window.chatDisplayPrefs.save('theme', themePreference)) return
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  if (!window.chatDisplayPrefs.save('voice', ttsVoice)) return
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  const bridge = androidBridge()
  if (bridge) {
    if (apiKey === null) {
      bridge.clearApiKey()
    } else {
      bridge.setApiKey(apiKey)
    }
    write(KEYS.apiKey, null)
  } else {
    write(KEYS.apiKey, apiKey)
  }
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSafetyCheck = (safetyCheck: boolean) => {
  write(KEYS.safetyCheck, String(safetyCheck))
  useSettings.setState({ safetyCheck })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}
