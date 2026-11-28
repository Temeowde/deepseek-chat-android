import { createPortal } from 'react-dom'
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import clsx from 'clsx'
import { useTranslate } from '../../i18n/index.js'
import { loadSessionStats, type SessionStatsRow } from '../../services/chat/db.js'
import { useChatStore } from '../../services/chat/store.js'
import {
  filterByTitle,
  mergeSessionRows,
  sortSessionRows,
  type PickerRow,
  type SessionSort,
} from '../../services/chat/sessionStatsPure.js'
import { Button } from '../base/Button.js'
import { IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14, IconSearchOutline16 } from '../base/icons.js'
import styles from './ExportSessionPicker.module.css'

/**
 * 导出前的会话选择页。
 *
 * 默认全选（等于原来的「导出全部」），用户可以清空后只勾选部分对话。
 * 排序只做两档：最近更新（默认）/ 按轮次；点排序按钮弹底部选择条，跟设置页同一套转场。
 *
 * 性能（700+ 会话）：
 * - 列表只渲染可视窗口 + 上下各 8 行（滚动时按行高 62px 换窗口，不整页重建）；
 * - 每行 memo，勾选只重渲染被点的那一行；
 * - 搜索用 useDeferredValue，输入不阻塞列表；
 * - 只有首屏 12 行播入场动画，避免 700 个动画同时跑。
 *
 * ⚠️ 全屏覆盖层（fixed inset:0）必须给容器加 safe-area padding：
 *    padding-top: var(--ds-safe-top, 0px);
 *    padding-bottom: var(--ds-safe-bottom, 0px);
 *    本 WebView 里 env(safe-area-inset-*) 是 0，状态栏/手势条高度只认这两个 CSS 变量。
 */

/** 行高（CSS px）：单行标题 + 上下 padding；虚拟列表用它算窗口 */
const ROW_HEIGHT = 50
/** 可视窗口上下各多渲染几行，滚动时不至于露白 */
const OVERSCAN = 8

const SessionRow = memo(function SessionRow({
  row,
  checked,
  t,
  animate,
  delay,
  onToggle,
}: {
  row: PickerRow
  checked: boolean
  t: ReturnType<typeof useTranslate>
  animate: boolean
  delay: number
  onToggle: (id: string) => void
}) {
  const date = (() => {
    if (!Number.isFinite(row.updatedAt) || row.updatedAt <= 0) {
      return ''
    }
    const d = new Date(row.updatedAt)
    return `${d.getMonth() + 1}/${d.getDate()}`
  })()
  return (
    <button
      type="button"
      className={clsx(styles.row, checked && styles.rowChecked, animate && styles.rowEnter)}
      aria-pressed={checked}
      style={animate ? { animationDelay: `${delay}ms` } : undefined}
      onClick={() => onToggle(row.id)}
    >
      <span className={styles.rowBody}>
        <span className={styles.rowTitleLine}>
          {row.pinned ? <span className={styles.pinTag}>{t('exportPinned')}</span> : null}
          <span className={styles.rowTitle}>{row.title || t('exportSelectUntitled')}</span>
        </span>
      </span>
      <span className={styles.rowDate}>{date}</span>
      <span className={clsx(styles.check, checked && styles.checkOn)} aria-hidden>
        {checked ? <IconCheckOutline16 /> : null}
      </span>
    </button>
  )
})

export const ExportSessionPicker = ({
  onClose,
  onConfirm,
}: {
  onClose: () => void
  onConfirm: (sessionIds: string[]) => void
}) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const [stats, setStats] = useState<SessionStatsRow[] | null>(null)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [sort, setSort] = useState<SessionSort>('recent')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(sessions.map((s) => s.id)))
  /** 进入/退出的过渡状态：先播完退场动画再真正卸载 */
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<number | null>(null)
  /** 排序选择条 */
  const [sortOpen, setSortOpen] = useState(false)
  const [sortClosing, setSortClosing] = useState(false)
  /** 虚拟列表窗口 */
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState({ start: 0, end: 32 })
  const frame = useRef<number | null>(null)

  useEffect(() => {
    let alive = true
    let timer: number | null = null
    const load = () => {
      loadSessionStats()
        .then((rows) => {
          if (alive) setStats(rows)
        })
        .catch(() => {
          if (alive) setStats([])
        })
    }
    // 轮次不显示，只在「聊得最多」排序时才需要：延后到空闲/400ms 后扫，
    // 打开页面先出列表，不再出现「先无轮次、一秒后刷新」的跳变。
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback
    if (typeof idle === 'function') {
      idle(load, { timeout: 1500 })
    } else {
      timer = window.setTimeout(load, 400)
    }
    return () => {
      alive = false
      if (timer !== null) {
        window.clearTimeout(timer)
      }
    }
  }, [])

  useEffect(() => () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
    }
    if (frame.current !== null) {
      window.cancelAnimationFrame(frame.current)
    }
  }, [])

  const requestClose = (after?: () => void) => {
    if (closing) {
      return
    }
    setClosing(true)
    closeTimer.current = window.setTimeout(() => {
      if (after) {
        after()
      } else {
        onClose()
      }
    }, 200)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      if (sortOpen) {
        dismissSort()
      } else {
        requestClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  const total = sessions.length
  const rows = useMemo(() => {
    const merged = mergeSessionRows(sessions, stats)
    return sortSessionRows(filterByTitle(merged, deferredQuery), sort)
  }, [sessions, stats, deferredQuery, sort])

  // 搜索/排序变化后回到顶部
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0
    }
    setViewport({ start: 0, end: 32 })
  }, [deferredQuery, sort])

  const recomputeWindow = useCallback(() => {
    const el = bodyRef.current
    if (!el) {
      return
    }
    const start = Math.max(0, Math.floor(el.scrollTop / ROW_HEIGHT) - OVERSCAN)
    const visible = Math.ceil(el.clientHeight / ROW_HEIGHT) + OVERSCAN * 2
    const end = start + visible
    setViewport((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
  }, [])

  const onScroll = useCallback(() => {
    if (frame.current !== null) {
      return
    }
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null
      recomputeWindow()
    })
  }, [recomputeWindow])

  const allSelected = selected.size >= total && total > 0
  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])
  const selectAll = () => setSelected(new Set(sessions.map((s) => s.id)))
  const clearAll = () => setSelected(new Set())

  const dismissSort = () => {
    if (sortClosing) {
      return
    }
    setSortClosing(true)
    window.setTimeout(() => {
      setSortOpen(false)
      setSortClosing(false)
    }, 180)
  }
  const pickSort = (next: SessionSort) => {
    setSort(next)
    dismissSort()
  }

  const sortLabel = sort === 'recent' ? t('exportSortRecent') : t('exportSortRounds')
  const windowRows = rows.slice(viewport.start, Math.min(viewport.end, rows.length))
  const topSpace = viewport.start * ROW_HEIGHT
  const bottomSpace = Math.max(0, (rows.length - Math.min(viewport.end, rows.length)) * ROW_HEIGHT)

  return createPortal(
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={t('exportSelectTitle')}
      data-closing={closing ? '1' : undefined}
    >
      <div className={styles.panel} data-closing={closing ? '1' : undefined}>
        <header className={styles.header}>
          <button type="button" className={styles.back} onClick={() => requestClose()} aria-label={t('cancel')}>
            <IconChevronRightOutline14 />
          </button>
          <h1 className={styles.title}>{t('exportSelectTitle')}</h1>
        </header>

        <div className={styles.body} ref={bodyRef} onScroll={onScroll}>
          <label className={styles.searchField}>
            <IconSearchOutline16 />
            <input
              className={styles.search}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('exportSelectSearch')}
              type="search"
              enterKeyHint="search"
            />
          </label>

          <div className={styles.controls}>
            <button type="button" className={styles.sortButton} onClick={() => setSortOpen(true)} aria-haspopup="listbox">
              <span>{sortLabel}</span>
              <IconChevronDownOutline14 />
            </button>
            <button type="button" className={styles.selectAll} onClick={allSelected ? clearAll : selectAll}>
              {allSelected ? t('exportSelectClear') : t('exportSelectAll')}
            </button>
          </div>

          <div className={styles.listCard}>
            {topSpace > 0 ? <div style={{ height: topSpace }} aria-hidden /> : null}
            {windowRows.map((row, index) => {
              const absolute = viewport.start + index
              return (
                <SessionRow
                  key={row.id}
                  row={row}
                  checked={selected.has(row.id)}
                  t={t}
                  animate={absolute < 12}
                  delay={absolute * 16}
                  onToggle={toggle}
                />
              )
            })}
            {bottomSpace > 0 ? <div style={{ height: bottomSpace }} aria-hidden /> : null}
            {rows.length === 0 ? <div className={styles.empty}>{t('exportSelectEmpty')}</div> : null}
          </div>
        </div>

        <footer className={styles.footer}>
          <span className={styles.count}>{t('exportSelectedCount', { count: selected.size, total })}</span>
          <div className={styles.actions}>
            <Button
              variant="primary"
              size="s"
              disabled={selected.size === 0}
              onClick={() => {
                if (closing) {
                  return
                }
                const ids = [...selected]
                setClosing(true)
                closeTimer.current = window.setTimeout(() => onConfirm(ids), 180)
              }}
            >
              {t('exportStartSelected')}
            </Button>
          </div>
        </footer>
      </div>

      {sortOpen ? (
        <div
          className={styles.sheetScrim}
          data-closing={sortClosing ? '1' : undefined}
          onClick={dismissSort}
        >
          <div
            className={styles.sortSheet}
            role="listbox"
            aria-label={t('exportSortLabel')}
            data-closing={sortClosing ? '1' : undefined}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.sheetGrabber} aria-hidden />
            {(['recent', 'rounds'] as const).map((mode) => {
              const active = sort === mode
              return (
                <button
                  key={mode}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={styles.sheetRow}
                  onClick={() => pickSort(mode)}
                >
                  <span>{mode === 'recent' ? t('exportSortRecent') : t('exportSortRounds')}</span>
                  {active ? (
                    <span className={styles.sheetCheck}>
                      <IconCheckOutline16 />
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>,
    document.body
  )
}
