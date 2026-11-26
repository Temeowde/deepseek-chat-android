import type { CSSProperties } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { useSyncExternalStore } from 'react'
import { newChat, autoRead } from '../../services/chat/store.js'
import { IconButton } from '../base/IconButton.js'
import { openMobileSider } from '../sider/mobileSiderState.js'
import styles from './MobileHeader.module.css'

/** 官方矢量图标（从 APK 提取，ui-icons/*.svg），用 mask 渲染，颜色跟随 currentColor */
const MaskIcon = ({ name, size }: { name: string; size: number }) => (
  <span
    className="ds-ui-icon"
    aria-hidden
    style={{ '--ds-icon': `url("ui-icons/${name}.svg")`, width: `${size}px`, height: `${size}px` } as CSSProperties}
  />
)

/** 移动端顶栏，打开会话后显示会话标题。 */
export const MobileHeader = ({ title }: { title?: string }) => {
  const t = useTranslate()
  const speaking = useSyncExternalStore(autoRead.subscribe, autoRead.isEnabled)
  return (
    <header className={styles.header} data-conversation={title !== undefined}>
      <IconButton
        size="xl"
        tone="primary"
        icon={<MaskIcon name="ds-menu" size={22} />}
        aria-label={t('expandSiderbarButton')}
        onClick={openMobileSider}
      />
      <div key={title} className={styles.title}>{title}</div>
      <IconButton size="xl" tone="primary" role="switch" aria-checked={speaking}
        tooltip={t('autoReadAloud')} aria-label={t('autoReadAloud')} onClick={autoRead.toggle}
        icon={<MaskIcon name={speaking ? 'ds-sound-on' : 'ds-sound-off'} size={22} />} />
      <IconButton size="xl" tone="primary" icon={<MaskIcon name="ds-new-chat" size={22} />}
        aria-label={t('newChat')} onClick={newChat} />
    </header>
  )
}
