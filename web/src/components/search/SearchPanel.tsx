import { useTranslate } from '../../i18n/index.js'
import { IconCloseOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { closeSearchPanel, dismissSearchPanel, useSearchPanel } from './searchPanelState.js'
import { SourceCard } from './SourceCard.js'
import styles from './SearchPanel.module.css'
import './sourceSheet.css'

const MobileSheet = ({ sources, citations, closing }: { sources: Source[]; citations: boolean; closing: boolean }) => {
  const t = useTranslate()
  const title = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const sheet = useRef<HTMLElement>(null)
  const start = useRef<{y: number; id: number} | null>(null)
  useLayoutEffect(() => {
    const el = dialog.current!
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    el.showModal()
    return () => { el.close(); if (trigger?.isConnected) trigger.focus({preventScroll:true}) }
  }, [])
  useEffect(() => {
    if (!closing) return
    const timer = setTimeout(closeSearchPanel, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150)
    return () => clearTimeout(timer)
  }, [closing])
  const endDrag = () => { start.current = null; sheet.current?.style.removeProperty('--drag-y') }
  return <dialog ref={dialog} className="ds-source-dialog" aria-labelledby={title} data-closing={closing}
    onCancel={e => { e.preventDefault(); dismissSearchPanel() }}
    onClick={e => { if (e.target === e.currentTarget) dismissSearchPanel() }}>
    <section ref={sheet} className="ds-source-sheet" data-citations={citations}>
      <header onPointerDown={e => {
        if (!e.isPrimary || e.button !== 0 || (e.target as Element).closest('button')) return
        start.current = { y:e.clientY, id:e.pointerId }; e.currentTarget.setPointerCapture(e.pointerId)
      }} onPointerMove={e => { if (start.current?.id === e.pointerId) sheet.current?.style.setProperty('--drag-y', Math.max(0,e.clientY-start.current.y)+'px') }}
        onPointerUp={e => { if (start.current?.id === e.pointerId && e.clientY-start.current.y > 48) dismissSearchPanel(); endDrag() }}
        onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
        <h2 id={title}>{t('searchResult')}</h2>
        <button type="button" className="ds-source-close" aria-label={t('close')} onClick={dismissSearchPanel}><IconCloseOutline16 /></button>
      </header>
      <div className="ds-source-list">
        {sources.map(source => <SourceCard key={source.url} source={source} numbered />)}
      </div>
    </section>
  </dialog>
}

/** 右侧「搜索结果」面板 */
export const SearchPanel = () => {
  const t = useTranslate()
  const entry = useSearchPanel((state) => state.entry)
  const sources = useSearchPanel((state) => state.sources)
  const kind = useSearchPanel(state => state.kind)
  const closing = useSearchPanel(state => state.closing)
  const mobile = useIsMobile()
  if (!entry) {
    return null
  }
  if (mobile) return <MobileSheet key={entry} sources={sources} citations={kind === 'citations'} closing={closing} />
  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        <div role="heading" className={styles.title}>
          {t('searchResult')}
        </div>
        <IconButton
          icon={<IconCloseOutline16 />}
          aria-label={t('close')}
          onClick={closeSearchPanel}
        />
      </div>
      <div className={styles.content}>
        {sources.map((source) => (
          <SourceCard key={source.url} source={source} className={styles.item} />
        ))}
      </div>
    </aside>
  )
}
import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import type { Source } from '../../services/chat/view.js'
