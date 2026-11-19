import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import type { Session } from '../../services/chat/types.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MessageList } from '../messages/MessageList.js'
import styles from './SessionView.module.css'

/** 桌面会话页，输入框吸底。 */
export const SessionView = ({
  session,
  streaming,
  siderCollapsed,
}: {
  session: Session
  streaming: boolean
  siderCollapsed: boolean
}) => {
  const t = useTranslate()
  const title = session.title || t('untitledChat')
  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <div className={clsx(styles.title, siderCollapsed && styles.withCollapsedSider)}>
          {title}
        </div>
      </div>
      <MessageList
        key={session.id}
        session={session}
        streaming={streaming}
        footer={
          <div className={styles.inputContainer}>
            <ChatInput sessionId={session.id} />
            <div className={styles.caveat}>{t('contentCaveat')}</div>
          </div>
        }
      />
    </div>
  )
}
