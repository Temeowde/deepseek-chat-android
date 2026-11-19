import { useTranslate } from '../../i18n/index.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import styles from './Welcome.module.css'

/** 桌面端新对话，输入框与问候语居中。 */
export const Welcome = () => {
  const t = useTranslate()
  return (
    <div className={styles.container}>
      <div className={styles.welcome}>
        <h1 className={styles.greeting}>{t('welcomeMessageChat250808')}</h1>
        <ChatInput sessionId={null} />
      </div>
    </div>
  )
}
