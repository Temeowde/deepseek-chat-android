import type * as React from 'react'
import type { createPortal } from 'react-dom'
import type { useVoiceInput } from './components/chatInput/useVoiceInput.js'
import type { SettingsSection } from './components/settings/settingsDialogState.js'
import type { useTranslate } from './i18n/index.js'
import type { groupSessions } from './services/chat/sessionGroups.js'
import type { AssistantMessage, HistorySearchTarget, Message, Session, SessionSummary } from './services/chat/types.js'
import type { LocalePreference, ThemePreference, useSettings } from './services/settings.js'
import type { TtsVoice } from './services/api/speech.js'
import type { showToast } from './components/base/toastState.js'

type Preferences = { locale: LocalePreference; theme: ThemePreference; voice: TtsVoice; provider: 'deepseek' | 'workbuddy'; workbuddyModel: string; safety: boolean }
/** 字体选择机制的选项；kind 用于 UI 分组，stack 是可直接用于 preview 的 CSS font-family。 */
export type FontOption = {
  id: string
  zh: string
  en: string
  detailZh?: string
  detailEn?: string
  /** 仅 follow：设备没有主题字体时与 system 等价，UI 可隐藏/合并。 */
  sameAsSystem?: boolean
  kind: 'follow' | 'system' | 'device'
  stack: string
}
type FontSwitch = {
  readonly PREF_KEY: string
  readonly STORAGE_KEY: string
  readonly DEFAULT_ID: string
  readonly ready: Promise<FontOption[]>
  list(): FontOption[]
  current(): string
  currentOption(): FontOption | undefined
  apply(id: string): boolean
  stack(id: string): string
  subscribe(listener: (id: string) => void): () => void
  theme(): { family: string; path: string } | null
}
type Fields = Partial<Pick<Session, 'pinned' | 'title'>>
type Active = { activeId: string | null; importingHistory: boolean }
type Ticket = { session: string; message: string } | null
type UI = React.ReactNode
type Runtime = typeof React
type Portal = typeof createPortal
type Listener = (fn: () => void) => () => void

declare global {
  interface Window {
    closeMobileSettings?: () => boolean
    closeMessageAction?: () => boolean
    cancelComposerVoice?: () => boolean
    cancelComposerEdit?: () => boolean
    closeComposerAttachments?: () => boolean
    cancelChatDrawerDrag?: () => boolean
    closeHistoryAction?: () => boolean
    bindChatDrawerDrag(config: { isOpen(): boolean; change(open: boolean): void; blocked(): boolean }): () => void
    dsFonts: FontSwitch
    chatDisplayPrefs: {
      read<K extends keyof Preferences>(key: K, fallback: Preferences[K]): Preferences[K]
      save<K extends keyof Preferences>(key: K, value: Preferences[K]): boolean
      subscribe: Listener
      collapse(): boolean
    }
    useComposerAttachments(react: Runtime, disabled: boolean, ensure: () => boolean, add: (files: File[]) => void, accept: string, sessionId: string | null): { toggle: UI; inputs: UI; panel: UI; clearPicked: () => void }
    useMobileComposerVoice(react: Runtime, config: {
      mobile: boolean; sessionId: string | null; busy: boolean; voice: ReturnType<typeof useVoiceInput>; text: string; fileCount: number
      textarea: React.RefObject<HTMLTextAreaElement>; limitRef: React.MutableRefObject<(() => void) | null>
      resultRef: React.MutableRefObject<((value: string) => void) | null>; ensureKey(): boolean; setText(value: string): void; send(): void
    }): { toggle: UI; pad: UI; showToggle: boolean; onFocus(): void; onBlur(): void }
    createChatAutoRead(config: { storage(): Storage; foreground(): boolean; active(): string | null; play(id: string, text: string): void; stop(): void }): {
      subscribe: Listener; isEnabled(): boolean; toggle(): void; begin(session: string, id: string): Ticket; finish(ticket: Ticket, reply: AssistantMessage): void
      observe(subscribe: (listener: (next: Active, prev: Active) => void) => () => void, doc: Document, win: Window): () => void
    }
    createMobileMessageActions(react: Runtime, portal: Portal, copy: (text: string) => Promise<boolean>, rate: (session: string, id: string, value: AssistantMessage['localFeedback']) => void): {
      Tool: React.ComponentType<{ kind: 'like' | 'dislike' | 'share'; message: AssistantMessage }>
      Surface: React.ComponentType<React.PropsWithChildren<{ sessionId: string; messages: Message[] }>>
    }
    __official?: {
      supported: boolean
      hasToken(): boolean
      login(): void
      logout(): void
      sync(): Promise<boolean>
      passwordLogin(account: string, password: string): Promise<boolean>
      profile(): { name: string; avatar: string }
      /** 官方 TTS 音色清单（含 palette 与试听地址）。 */
      ttsVoices(): Promise<{ id: string; name: string; desc: string; palette?: string[]; demoUrls?: Record<string, string> }[]>
      /** 播放某个音色的官方试听句（官方 CDN mp3）。 */
      playVoiceDemo(voiceId: string): Promise<boolean>
    }
    chatHistoryMetadata(api: {
      epoch(): number; get(): { sessions: SessionSummary[]; importingHistory: boolean }; deleting(id: string): boolean
      keepTitle(id: string): void; publish(id: string, patch: Fields): void; write(id: string, patch: Fields): Promise<boolean>
    }): (id: string, patch: Fields) => Promise<boolean>
    chatHistorySearchTarget?(row: Element): HistorySearchTarget | undefined
    createMobileHistory(react: Runtime, portal: Portal, api: {
      useT: typeof useTranslate; useRows(): SessionSummary[]; useActive(): string | null; useOpen(): boolean; group: typeof groupSessions
      openSession(id: string, target?: HistorySearchTarget): void; metadata(id: string, fields: Fields): Promise<boolean>; remove(id: string): Promise<boolean>; settings(): void; notify: typeof showToast
    }): React.ComponentType<{ searching: boolean; setSearching(searching: boolean): void }>
    createChatMobileSettings(react: Runtime, portal: Portal, api: { useStore: typeof useSettings; set: { [K in keyof Preferences]: (value: Preferences[K]) => void } }): React.ComponentType<{
      initial: SettingsSection; busy: boolean; close(): void; closeOverlay(): boolean; panel: UI; locationPanel: UI
  /** 打开设置时直接进入的数据管理三级页（没填 Key 被带上来的场景） */
  initialDataView?: 'dataApi' | 'dataBackup'
  /** 数据管理的三级页内容（注册为设置壳的正式视图） */
  dataApiPanel?: UI; dataBackupPanel?: UI
    }>
  }
}
