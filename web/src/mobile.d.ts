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

type Preferences = { locale: LocalePreference; theme: ThemePreference; voice: TtsVoice }
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
    chatDisplayPrefs: {
      read<K extends keyof Preferences>(key: K, fallback: Preferences[K]): Preferences[K]
      save<K extends keyof Preferences>(key: K, value: Preferences[K]): boolean
      subscribe: Listener
      collapse(): boolean
    }
    useComposerAttachments(react: Runtime, disabled: boolean, ensure: () => boolean, add: (files: File[]) => void, accept: string, sessionId: string | null): { toggle: UI; inputs: UI; panel: UI }
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
      initial: SettingsSection; busy: boolean; close(): void; closeOverlay(): boolean; keyPanel: UI; keySubmit: UI; dataPanel: UI; advancedPanel: UI
    }>
  }
}
