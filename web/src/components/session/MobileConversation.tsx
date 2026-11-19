import { useCallback, useRef, useState, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import type { Session, UserMessage } from '../../services/chat/types.js'
import { useChatStore } from '../../services/chat/store.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList, type ReadingPosition } from '../messages/MessageList.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './MobileConversation.module.css'

export const MobileConversation = ({
  activeId,
  session,
  streaming,
  available,
  loading,
}: {
  activeId: string | null
  session: Session | undefined
  streaming: boolean
  available: boolean
  loading: ReactNode
}) => {
  const t = useTranslate()
  const positions = useRef(new Map<string, ReadingPosition>())
  const [edit, setEdit] = useState<{ sessionId: string; message: UserMessage; text: string } | null>(null)
  const sessionId = session?.id
  const locating = useChatStore(state => state.historyLocation !== null)
  if (edit && (edit.sessionId !== activeId || locating)) setEdit(null)
  const currentEdit = edit && edit.sessionId === sessionId && available ? edit : null
  const beginEdit = useCallback((message: UserMessage) => {
    if (!sessionId || !available || streaming) return
    closeSearchPanel()
    stopReadAloud()
    setEdit({ sessionId, message, text: message.content })
  }, [available, sessionId, streaming])
  const changeEdit = useCallback((text: string) => {
    setEdit((edit) => edit ? { ...edit, text } : null)
  }, [])
  const closeEdit = useCallback(() => setEdit(null), [])
  const atHome = available && !session
  return (
    <div className={styles.screen}>
      <MobileHeader title={session ? session.title || t('untitledChat') : undefined} />
      <div className={styles.stage}>
        <div className={styles.welcome} data-visible={atHome} aria-hidden={!atHome}>
          <h1>{t('welcomeMessageChat250808')}</h1>
        </div>
        {loading}
        {session && (
          <MessageList
            key={session.id}
            session={session}
            streaming={streaming}
            positions={positions.current}
            editId={currentEdit?.message.id}
            onEditMessage={beginEdit}
          />
        )}
      </div>
      <div className={styles.dock}>
        <ChatInput
          sessionId={activeId}
          unavailable={!available}
          edit={currentEdit ? {
            messageId: currentEdit.message.id,
            text: currentEdit.text,
            hasFiles: currentEdit.message.files.length > 0,
            onChange: changeEdit,
            onClose: closeEdit,
          } : null}
        />
        <div className={styles.caveat}>{t('contentCaveat')}</div>
      </div>
    </div>
  )
}
