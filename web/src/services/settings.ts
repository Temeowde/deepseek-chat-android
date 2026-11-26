import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'
import { DEFAULT_WORKBUDDY_MODEL } from './workbuddy/models.js'

export type Locale = 'zh-CN' | 'en-US'
export type LocalePreference = Locale | 'system'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 聊天服务提供方：DeepSeek API Key、WorkBuddy 账号或自定义 OpenAI 兼容 API */
export type ChatProvider = 'deepseek' | 'workbuddy' | 'custom'

/** 本机设置；安卓密钥由原生 Keystore 保存，其余偏好存 localStorage */
type Settings = {
  apiKey: string | null
  provider: ChatProvider
  workbuddyModel: string
  locale: Locale
  localePreference: LocalePreference
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  safetyCheck: boolean
  siderCollapsed: boolean
  /** 本地保留（自动备份到公共目录）；默认关闭，用户主动开启才申请权限 */
  localBackup: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  provider: 'chat-demo:provider',
  workbuddyModel: 'chat-demo:workbuddy-model',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  safetyCheck: 'chat-demo:safety-check',
  siderCollapsed: 'chat-demo:sider-collapsed',
  localBackup: 'chat-demo:local-backup',
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

/** 原生 chat_display 偏好；网页/浏览器环境下可能不存在。 */
const displayPrefs = () => (typeof window === 'undefined' ? undefined : window.chatDisplayPrefs)

const readDisplay = (key: 'provider' | 'workbuddyModel', fallback: string): string => {
  try {
    const prefs = displayPrefs()
    if (!prefs) {
      return fallback
    }
    const value = (prefs.read as unknown as (name: string, initial: string) => string)(key, fallback)
    return typeof value === 'string' && value !== '' ? value : fallback
  } catch {
    return fallback
  }
}

const saveDisplay = (key: 'provider' | 'workbuddyModel', value: string): boolean => {
  try {
    const prefs = displayPrefs()
    if (!prefs) {
      return false
    }
    return (prefs.save as unknown as (name: string, next: string) => boolean)(key, value) === true
  } catch {
    return false
  }
}

const initialProvider = (): ChatProvider => {
  const value = readDisplay(
    'provider',
    read(KEYS.provider) === 'workbuddy' || read(KEYS.provider) === 'custom'
      ? (read(KEYS.provider) as string)
      : 'deepseek'
  )
  return value === 'workbuddy' || value === 'custom' ? value : 'deepseek'
}

const initialWorkBuddyModel = (): string =>
  readDisplay('workbuddyModel', read(KEYS.workbuddyModel) || DEFAULT_WORKBUDDY_MODEL)

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
const initialProviderValue = initialProvider()
const initialApiKeyValue = initialApiKey()

export const useSettings = create<Settings>(() => ({
  apiKey: initialApiKeyValue,
  provider: initialProviderValue,
  workbuddyModel: initialWorkBuddyModel(),
  locale: resolveLocale(initialLocale),
  localePreference: initialLocale,
  location: initialLocation(),
  themePreference: window.chatDisplayPrefs.read('theme', 'system'),
  ttsVoice: window.chatDisplayPrefs.read('voice', 'stella'),
  thinking: read(KEYS.thinking) === 'true',
  // 联网搜索由 DeepSeek 执行；WorkBuddy/自定义下默认关闭，需要时手动开。
  search: initialProviderValue === 'deepseek' ? read(KEYS.search) !== 'false' : false,
  safetyCheck: read(KEYS.safetyCheck) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
  // 之前这个字段被从类型和初始值里漏掉了：开关状态读不出来，
  // 表现为"打开了自动备份，但重启后又是关的、也从来没备份过"
  localBackup: read(KEYS.localBackup) === 'true',
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

export const setProvider = (provider: ChatProvider) => {
  if (!saveDisplay('provider', provider)) {
    write(KEYS.provider, provider)
  }
  useSettings.setState({ provider })
  // 搜索/附件走 DeepSeek；切到其他供应商时先把搜索关掉，避免每条消息都误走 DeepSeek。
  if (provider !== 'deepseek' && useSettings.getState().search) {
    write(KEYS.search, 'false')
    useSettings.setState({ search: false })
  }
}

export const setWorkBuddyModel = (workbuddyModel: string) => {
  if (!saveDisplay('workbuddyModel', workbuddyModel)) {
    write(KEYS.workbuddyModel, workbuddyModel)
  }
  useSettings.setState({ workbuddyModel })
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

/** 本地保留开关。开启由调用方负责先申请权限；这里只负责持久化状态。 */
export const setLocalBackup = (localBackup: boolean) => {
  write(KEYS.localBackup, String(localBackup))
  useSettings.setState({ localBackup })
}
