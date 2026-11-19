import { IconMenuOutline20, IconNewChatOutline20, IconPlayMediaOutline16 } from '../base/icons.js'
import { useTranslate } from '../../i18n/index.js'
import { useSyncExternalStore } from 'react'
import { newChat, autoRead } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import styles from './MobileHeader.module.css'

/** 移动端顶栏：首页标识客户端，进入会话后显示会话标题。 */
export const MobileHeader = ({ title }: { title?: string }) => {
  const t = useTranslate()
  const speaking = useSyncExternalStore(autoRead.subscribe, autoRead.isEnabled)
  return (
    <header className={styles.header} data-conversation={title !== undefined}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<IconMenuOutline20 />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      <div key={title ?? ''} className={styles.title}>{title ?? t('apiChatTitle')}</div>
      <IconButton size="xl" tone="primary" role="switch" aria-checked={speaking}
        tooltip={t('autoReadAloud')} aria-label={t('autoReadAloud')} onClick={autoRead.toggle}
        icon={<span className={speaking ? 'ds-speaker' : 'ds-speaker ds-muted'} aria-hidden><IconPlayMediaOutline16 /></span>} />
      <IconButton size="xl" tone="primary" icon={<IconNewChatOutline20 />}
        aria-label={t('newChat')} onClick={newChat} />
    </header>
  )
}
