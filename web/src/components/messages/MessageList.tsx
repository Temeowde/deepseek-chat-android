import { Surface } from './mobileActions.js'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { IconChevronDownOutline14 } from '../base/icons.js'
import {
  buildMessageVersions,
  getVisibleMessages,
  type MessageVersions,
} from '../../services/chat/branches.js'
import { consumeHistoryLocation, selectMessageVersion, useChatStore } from '../../services/chat/store.js'
import type { Message, Session, UserMessage as UserMessageType } from '../../services/chat/types.js'
import { closeSearchPanel } from '../search/searchPanelState.js'
import { AssistantMessage } from './AssistantMessage.js'
import { ScrollToBottomContext } from './scrollContext.js'
import { UserMessage } from './UserMessage.js'
import styles from './MessageList.module.css'

/**
 * 会话共用可重试的附件上传失败入口，覆盖当前提问与历史消息中的附件。
 * 点击后按失败的回答重新补传附件并请求。
 */
const getUploadRetryId = (messages: Message[], streaming: boolean) => {
  const last = messages.at(-1)
  return !streaming &&
    last?.role === 'assistant' &&
    last.status === 'error' &&
    last.error?.kind === 'upload' &&
    last.error.retryable
    ? last.id
    : null
}

/** 距底部小于该值时视为在底部，流式内容增长时跟随 */
const STICKY_THRESHOLD = 40
const SCROLL_EASE_MS = 48
const MAX_SCROLL_PX_PER_MS = 6
const REPLY_SCROLL_THRESHOLD = 64
const REPLY_START_INSET = 16
const EMPTY_VERSIONS: MessageVersions = { ids: [], index: -1 }

type FollowMode = 'bottom' | 'reply-start' | 'manual'
type MessageAnchor = { id: string; top: number }
export type ReadingPosition = { top: number; mode: FollowMode; anchor?: MessageAnchor }
type MessageRange = { start: number; end: number | null }
const READING_POSITION_LIMIT = 32
const HISTORY_PAGE_ROWS = 16
const HISTORY_EDGE_INSET = 112

const latestRange = (length: number): MessageRange => ({
  start: Math.max(0, length - HISTORY_PAGE_ROWS),
  end: null,
})

const rangeAround = (length: number, index: number): MessageRange => {
  const latest = latestRange(length)
  if (index < 0) return latest
  const start = Math.max(0, index - 4)
  if (start >= latest.start) return latest
  return { start, end: start + HISTORY_PAGE_ROWS }
}

/** Find the rendered phrase without modifying Markdown, selection or message data. */
const findHistoryPhrase = (row: HTMLElement, query: string): Range | undefined => {
  const pattern = query.trim().split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
  if (!pattern) return undefined
  const search = new RegExp(pattern, 'iu')
  for (const body of row.querySelectorAll('.ds-assistant-message-main-content, [data-history-text]')) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    const spans: { node: Text; start: number; end: number }[] = []
    let text = ''
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (node.parentElement?.closest('button, [hidden], [aria-hidden="true"]')) continue
      const start = text.length
      text += node.data
      spans.push({ node, start, end: text.length })
    }
    const match = search.exec(text)
    if (!match) continue
    const last = match.index + match[0].length
    const start = spans.find(part => part.start <= match.index && part.end > match.index)
    const end = spans.find(part => part.start < last && part.end >= last)
    if (start && end) {
      const range = document.createRange()
      range.setStart(start.node, match.index - start.start)
      range.setEnd(end.node, last - end.start)
      if (range.getClientRects().length) return range
    }
  }
  return undefined
}

const captureAnchor = (scroll: HTMLDivElement, column: HTMLDivElement): MessageAnchor | undefined => {
  const viewport = scroll.getBoundingClientRect()
  for (const row of column.children) {
    const id = (row as HTMLElement).dataset.chatMessage
    if (!id) continue
    const rect = row.getBoundingClientRect()
    if (rect.bottom > viewport.top && rect.top < viewport.bottom) {
      return { id, top: rect.top - viewport.top }
    }
  }
  return undefined
}

const restoreAnchor = (scroll: HTMLDivElement, anchor?: MessageAnchor): boolean => {
  if (!anchor) return false
  const row = scroll.querySelector(`[data-chat-message="${CSS.escape(anchor.id)}"]`)
  if (!row) return false
  scroll.scrollTop += row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - anchor.top
  return true
}

export const MessageList = memo(function MessageList({
  session,
  streaming,
  footer,
  positions,
  editId,
  onEditMessage,
}: {
  session: Session
  streaming: boolean
  footer?: React.ReactNode
  positions?: Map<string, ReadingPosition>
  editId?: string
  onEditMessage?: (message: UserMessageType) => void
}) {
  const isMobile = useIsMobile()
  const t = useTranslate()
  const [away, setAway] = useState(false)
  const beforeEdit = useRef<(ReadingPosition & { lastId?: string }) | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const saved = useRef(positions?.get(session.id))
  const followMode = useRef<FollowMode>(saved.current?.mode ?? 'bottom')
  const renderedTail = useRef<string>()
  const scrollTopRef = useRef(saved.current?.top ?? 0)
  const jumpFrame = useRef(0)
  const restoreScrollRef = useRef<{ messageId: string; top: number } | null>(null)
  const rangeChange = useRef<{ anchor?: MessageAnchor } | 'latest' | null>(null)
  const messages = useMemo(() => getVisibleMessages(session), [session])
  const location = useChatStore(state => state.historyLocation?.sessionId === session.id ? state.historyLocation : null)
  const targetIndex = location ? messages.findIndex(message => message.id === location.messageId) : -1
  const [preparedLocation, setPreparedLocation] = useState(location)
  const [range, setRange] = useState(() => rangeAround(
    messages.length,
    targetIndex >= 0 ? targetIndex : messages.findIndex(message => message.id === saved.current?.anchor?.id),
  ))
  if (location !== preparedLocation) {
    setPreparedLocation(location)
    if (isMobile && targetIndex >= 0) setRange(rangeAround(messages.length, targetIndex))
  }
  const start = isMobile ? Math.min(range.start, latestRange(messages.length).start) : 0
  const end = Math.min(isMobile ? range.end ?? messages.length : messages.length, messages.length)
  const hasEarlier = start > 0
  const hasLater = end < messages.length
  const capturePosition = useCallback((): ReadingPosition => {
    const scroll = scrollRef.current
    const column = contentRef.current
    const mode = followMode.current
    return {
      mode,
      top: scroll?.scrollTop ?? scrollTopRef.current,
      anchor: mode === 'manual' && scroll && column ? captureAnchor(scroll, column) : undefined,
    }
  }, [])
  const [previousVersions, setPreviousVersions] = useState(() =>
    buildMessageVersions(session, new Map())
  )
  const versions = useMemo(
    () => buildMessageVersions(session, previousVersions),
    [session, previousVersions]
  )
  if (versions !== previousVersions) {
    setPreviousVersions(versions)
  }
  const latest = messages.at(-1)
  const lastMessageId = latest?.id
  const pendingReply = latest?.role === 'assistant' && (latest.status === 'pending' || latest.status === 'streaming')
  const scrollDestination = useCallback((scroll: HTMLDivElement) => {
    const bottom = Math.max(0, scroll.scrollHeight - scroll.clientHeight)
    const reply = contentRef.current?.lastElementChild
    if (followMode.current !== 'reply-start' || !reply) return bottom
    const replyTop = scroll.scrollTop + reply.getBoundingClientRect().top - scroll.getBoundingClientRect().top
    return Math.min(bottom, Math.max(0, replyTop - REPLY_START_INSET))
  }, [])
  const syncScroll = useCallback(() => {
    const scroll = scrollRef.current
    if (scroll && followMode.current !== 'manual' && !jumpFrame.current) {
      scroll.scrollTop = scrollDestination(scroll)
      scrollTopRef.current = scroll.scrollTop
    }
  }, [scrollDestination])
  const cancelJump = useCallback(() => {
    if (jumpFrame.current) {
      cancelAnimationFrame(jumpFrame.current)
      jumpFrame.current = 0
    }
  }, [])
  const hold = useCallback(() => {
    if (!isMobile) return
    cancelJump()
    followMode.current = 'manual'
  }, [cancelJump, isMobile])
  // 手机端由 ResizeObserver 跟进布局变化，避免消息子组件先于新一轮定位就滚动。
  const reading = useMemo(() => ({ follow: isMobile ? () => {} : syncScroll, hold }), [hold, isMobile, syncScroll])
  const animateScroll = useCallback((limitDuration = false) => {
    const scroll = scrollRef.current
    if (!scroll || jumpFrame.current) return
    const initialDistance = Math.abs(scrollDestination(scroll) - scroll.scrollTop)
    if (initialDistance < 8 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      syncScroll()
      return
    }
    const startedAt = performance.now()
    const speedLimit = limitDuration ? Math.max(MAX_SCROLL_PX_PER_MS, initialDistance / 150) : MAX_SCROLL_PX_PER_MS
    let previousTime = startedAt
    const tick = (now: number) => {
      const distance = scrollDestination(scroll) - scroll.scrollTop
      if (Math.abs(distance) <= 2 || (limitDuration && now - startedAt >= 480)) {
        jumpFrame.current = 0
        syncScroll()
        return
      }
      // 键盘和正文都可能移动目标，每帧从当前可见位置靠近新目标。
      const elapsed = Math.max(1, Math.min(32, now - previousTime))
      const easedStep = Math.abs(distance) * (1 - Math.exp(-elapsed / SCROLL_EASE_MS))
      const step = Math.min(elapsed * speedLimit, Math.max(1, easedStep))
      scroll.scrollTop += Math.sign(distance) * step
      scrollTopRef.current = scroll.scrollTop
      previousTime = now
      jumpFrame.current = requestAnimationFrame(tick)
    }
    jumpFrame.current = requestAnimationFrame(tick)
  }, [scrollDestination, syncScroll])
  const jumpToLatest = () => {
    followMode.current = 'bottom'
    if (hasLater) {
      rangeChange.current = 'latest'
      setRange(latestRange(messages.length))
    } else {
      animateScroll(true)
    }
  }

  const showMore = (direction: 'earlier' | 'later') => {
    const scroll = scrollRef.current
    const column = contentRef.current
    if (!scroll || !column || rangeChange.current || editId) return
    if (direction === 'earlier' ? !hasEarlier : !hasLater) return
    hold()
    rangeChange.current = { anchor: captureAnchor(scroll, column) }
    if (direction === 'earlier') {
      setRange({ start: Math.max(0, start - HISTORY_PAGE_ROWS), end: hasLater ? end : null })
    } else {
      const nextEnd = end + HISTORY_PAGE_ROWS
      setRange({ start, end: nextEnd < messages.length ? nextEnd : null })
    }
  }

  // Restore the visible row before paint when a page is inserted above it.
  useLayoutEffect(() => {
    const change = rangeChange.current
    const scroll = scrollRef.current
    rangeChange.current = null
    if (!change || !scroll) return
    if (change === 'latest') syncScroll()
    else restoreAnchor(scroll, change.anchor)
    scrollTopRef.current = scroll.scrollTop
  }, [range, syncScroll])

  const keepEditTargetVisible = useCallback(() => {
    const scroll = scrollRef.current
    const target = scroll?.querySelector('[data-edit-target]')
    if (!scroll || !target) return
    const viewport = scroll.getBoundingClientRect()
    const row = target.getBoundingClientRect()
    const top = row.top - viewport.top - 12
    const bottom = row.bottom - viewport.bottom + 12
    if (top < 0 || bottom > 0) {
      scroll.scrollTop += top < 0 ? top : Math.min(top, bottom)
      scrollTopRef.current = scroll.scrollTop
    }
  }, [])

  // 内容、键盘和输入框高度变化时，继续遵循当前跟随状态。
  useLayoutEffect(() => {
    const content = contentRef.current
    const scroll = scrollRef.current
    if (!content || !scroll) {
      return
    }
    const observer = new ResizeObserver(() => {
      if (beforeEdit.current) {
        keepEditTargetVisible()
      } else if (followMode.current === 'reply-start' && scrollDestination(scroll) - scroll.scrollTop > REPLY_SCROLL_THRESHOLD) {
        // 大段正文或展开后的富文本可能一次推远回答开头。
        animateScroll()
      } else {
        syncScroll()
      }
      if (isMobile) setAway(scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight > STICKY_THRESHOLD)
    })
    observer.observe(content)
    observer.observe(scroll)
    return () => observer.disconnect()
  }, [animateScroll, isMobile, keepEditTargetVisible, scrollDestination, syncScroll])

  useLayoutEffect(() => {
    const previousTail = renderedTail.current
    if (previousTail === lastMessageId) return
    const anchor = restoreScrollRef.current
    // A newly sent turn should become visible even after reopening an older page.
    if (!anchor && hasLater && pendingReply && previousTail !== undefined) {
      setRange(latestRange(messages.length))
      return
    }
    renderedTail.current = lastMessageId
    const scroll = scrollRef.current
    if (anchor && scroll) {
      const switcher = scroll.querySelector<HTMLElement>(
        `[data-message-version="${CSS.escape(anchor.messageId)}"]`
      )
      // 切换版本时把选择器留在原位置，便于连续查看版本。
      if (switcher) scroll.scrollTop += switcher.getBoundingClientRect().top - anchor.top
      scrollTopRef.current = scroll.scrollTop
      restoreScrollRef.current = null
      return
    }
    const initial = saved.current
    if (initial) {
      saved.current = undefined
      if (initial.mode === 'manual' && scroll) {
        if (!restoreAnchor(scroll, initial.anchor)) scroll.scrollTop = initial.top
        scrollTopRef.current = scroll.scrollTop
      } else {
        syncScroll()
      }
      return
    }
    cancelJump()
    const newMobileReply = isMobile && latest?.role === 'assistant' && (pendingReply || previousTail !== undefined)
    followMode.current = newMobileReply ? 'reply-start' : 'bottom'
    if (newMobileReply && previousTail !== undefined) {
      animateScroll(true)
    } else {
      syncScroll()
    }
  }, [animateScroll, cancelJump, hasLater, isMobile, lastMessageId, latest?.role, messages.length, pendingReply, syncScroll])

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (!isMobile || !scroll) return
    if (!editId) {
      const savedPosition = beforeEdit.current
      beforeEdit.current = null
      // 提交会换到新分支，放弃才回到原分支的阅读位置。
      if (savedPosition && savedPosition.lastId === lastMessageId) {
        followMode.current = savedPosition.mode
        if (!restoreAnchor(scroll, savedPosition.anchor)) scroll.scrollTop = savedPosition.top
        scrollTopRef.current = scroll.scrollTop
        syncScroll()
      }
      return
    }
    beforeEdit.current ??= { ...capturePosition(), lastId: lastMessageId }
    hold()
    keepEditTargetVisible()
    const suffix = scroll.querySelectorAll<HTMLElement>('[data-edit-target] ~ [data-chat-message]')
    suffix.forEach((row) => { row.inert = true })
    return () => suffix.forEach((row) => { row.inert = false })
  }, [capturePosition, editId, hold, isMobile, keepEditTargetVisible, lastMessageId, syncScroll])

  useEffect(closeSearchPanel, [session.id, lastMessageId])

  const selectVersion = useCallback(
    (messageId: string, anchorTop: number) => {
      if (streaming || beforeEdit.current) return
      restoreScrollRef.current = { messageId, top: anchorTop }
      cancelJump()
      followMode.current = 'manual'
      closeSearchPanel()
      selectMessageVersion(session.id, messageId)
    },
    [cancelJump, session.id, streaming]
  )

  // 跨移动端断点时切换滚动层，并保持输入框及当前阅读位置。
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) {
      return
    }
    if (followMode.current === 'manual') {
      el.scrollTop = scrollTopRef.current
      scrollTopRef.current = el.scrollTop
    } else if (!isMobile) {
      syncScroll()
    }
    return cancelJump
  }, [isMobile, syncScroll, cancelJump])

  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (!scroll || !location || targetIndex < 0) return
    const row = scroll.querySelector<HTMLElement>(`[data-chat-message="${CSS.escape(location.messageId)}"]`)
    if (!row) return
    cancelJump()
    followMode.current = 'manual'
    const phrase = findHistoryPhrase(row, location.query)
    const rect = phrase?.getClientRects()[0] ?? row.getBoundingClientRect()
    scroll.scrollTop += rect.top - scroll.getBoundingClientRect().top - REPLY_START_INSET
    scrollTopRef.current = scroll.scrollTop
    row.tabIndex = -1
    row.focus({ preventScroll: true })
    const element = phrase?.startContainer.parentElement?.closest('p, li, pre, td, [data-history-text]') ?? row
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      element.animate([{ backgroundColor: 'var(--dsw-alias-button-ghost-active-fill)' }, { backgroundColor: 'transparent' }], { duration: 1200, easing: 'ease-out' })
    }
    consumeHistoryLocation(location)
  }, [cancelJump, location, targetIndex, start, end])

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    // React may also receive an event from a nested horizontally scrollable code block.
    if (event.target !== el) return
    const bottom = Math.max(0, el.scrollHeight - el.clientHeight)
    const gap = bottom - el.scrollTop
    const nearBottom = gap < STICKY_THRESHOLD
    const movement = el.scrollTop - scrollTopRef.current
    // 键盘收起时可视区变高，浏览器会把原有位置限制到新的列表底部。
    const clampedToBottom = scrollTopRef.current > bottom && Math.abs(gap) <= 1
    const reading = !clampedToBottom && !jumpFrame.current && !beforeEdit.current
    if (reading && movement !== 0) {
      if (!hasLater && nearBottom && (movement > 0 || !isMobile)) {
        followMode.current = 'bottom'
      } else if (movement < 0 || followMode.current === 'reply-start') {
        followMode.current = 'manual'
      }
    }
    scrollTopRef.current = el.scrollTop
    if (!isMobile) return
    setAway(!nearBottom)
    if (!reading) return
    if (movement < 0 && el.scrollTop <= HISTORY_EDGE_INSET) showMore('earlier')
    if (movement > 0 && gap <= HISTORY_EDGE_INSET) showMore('later')
  }
  const interruptJump = () => { if (jumpFrame.current) hold() }

  useLayoutEffect(() => () => {
    if (!positions) return
    positions.delete(session.id)
    positions.set(session.id, beforeEdit.current ?? capturePosition())
    if (positions.size > READING_POSITION_LIMIT) {
      const oldest = positions.keys().next().value
      if (oldest !== undefined) positions.delete(oldest)
    }
  }, [capturePosition, positions, session.id])

  const lastIndex = messages.length - 1
  const uploadRetryId = getUploadRetryId(messages, streaming)
  const scrollEvents = { onScroll, onPointerDown: interruptJump, onWheel: interruptJump }
  const historyButton = (direction: 'earlier' | 'later') => (
    <button
      type="button"
      className={styles.historyPage}
      disabled={!!editId}
      onClick={() => showMore(direction)}
    >
      {t(direction === 'earlier' ? 'previousMessages' : 'nextMessages')}
    </button>
  )
  const view = (
    <ScrollToBottomContext.Provider value={reading}>
      <div ref={isMobile ? undefined : scrollRef} className={styles.container} {...!isMobile && scrollEvents}>
        <div ref={isMobile ? scrollRef : undefined} className={styles.scroll} data-chat-scroll {...isMobile && scrollEvents}>
          <div ref={contentRef} className={styles.column}>
            {hasEarlier && historyButton('earlier')}
            {messages.slice(start, end).map((message, visibleIndex) => {
              const index = start + visibleIndex
              return message.role === 'user' ? (
                <UserMessage
                  key={message.id}
                  sessionId={session.id}
                  message={message}
                  retryUploadId={uploadRetryId}
                  isFirst={index === 0}
                  isLast={index === lastIndex || index === lastIndex - 1}
                  busy={streaming || !!editId}
                  editTarget={editId === message.id}
                  onEdit={onEditMessage}
                  versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                  onSelectVersion={selectVersion}
                />
              ) : (
                <AssistantMessage
                  key={message.id}
                  sessionId={session.id}
                  message={message}
                  isLast={index === lastIndex}
                  streaming={streaming && index === lastIndex}
                  busy={streaming || !!editId}
                  versions={versions.get(message.id) ?? EMPTY_VERSIONS}
                  onSelectVersion={selectVersion}
                />
              )
            })}
            {hasLater && historyButton('later')}
          </div>
        </div>
        {isMobile && (away || hasLater) && !editId && <div className={styles.jumpAnchor}>
          <button type="button" className={styles.jump} aria-label={t('jumpToLatest')} title={t('jumpToLatest')} onClick={jumpToLatest}>
            <IconChevronDownOutline14 />
            {t('jumpToLatest')}
          </button>
        </div>}
        {footer}
      </div>
    </ScrollToBottomContext.Provider>
  )
  return isMobile ? <Surface key={session.id} sessionId={session.id} messages={messages}>{view}</Surface> : view
})
