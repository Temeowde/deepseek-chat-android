import { useId } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import type { Source } from '../../services/chat/view.js'
import { HoverCard } from './HoverCard.js'
import { toggleSearchPanel } from './searchPanelState.js'
import { SourceCard } from './SourceCard.js'
import { webSourceUrl } from './sourceLink.js'

export const CitationLink = ({ sources }: { sources: Source[] }) => {
  const mobile = useIsMobile()
  const entry = useId()
  const t = useTranslate()
  return sources.map(source => {
    const name = t('citationNumber', { count: source.index })
    if (mobile) {
      const show = () => toggleSearchPanel(entry, sources, 'citations')
      // A citation can occur inside Markdown link text, so don't nest an anchor or a button.
      return <span key={source.url} className="ds-markdown-cite" role="button" tabIndex={0}
        aria-label={name} aria-haspopup="dialog"
        onClick={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({preventScroll:true}); show() }}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); show() } }}>
        {source.index}
      </span>
    }
    const href = webSourceUrl(source.url)
    const open = () => { if (href) window.open(href, '_blank', 'noopener,noreferrer') }
    return <HoverCard key={source.url} renderTrigger={({domRef, domProps}) =>
      <span ref={domRef} {...domProps} className="ds-markdown-cite" role="link" aria-label={name} tabIndex={0}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); open() } }}
        onClick={event => { event.preventDefault(); event.stopPropagation(); open() }}>{source.index}</span>}>
      <SourceCard source={source} />
    </HoverCard>
  })
}
