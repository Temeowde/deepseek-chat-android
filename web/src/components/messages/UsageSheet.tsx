import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import clsx from 'clsx'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { MaskIcon } from '../base/MaskIcon.js'
import type { MessageUsage } from '../../services/api/types.js'
import { estimateUsageCost, formatTokens, formatYuan } from '../../services/chat/usageCost.js'
import styles from './UsageSheet.module.css'

/** 官方 AppModalBottomSheetM2：spring(dampingRatio=1.0, stiffness=1500) 采样成 CSS linear()，约 220ms */
const SPRING_MS = 220
const SPRING_EASE =
  'linear(0, 0.0688 5%, 0.2104 10%, 0.3661 15%, 0.509 20%, 0.6293 25%, 0.7254 30%, 0.7997 35%, 0.8557 40%, 0.8972 45%, 0.9275 50%, 0.9494 55%, 0.965 60%, 0.9761 65%, 0.984 70%, 0.9895 75%, 0.9933 80%, 0.996 85%, 0.9978 90%, 0.9991 95%, 1)'

/** 金额按「元 / 百万 tokens」展示，整数/小数都去掉多余的 0 */
const unitPrice = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, '').replace(/\.$/, '')

const percentText = (value: number): string => {
  if (value < 1) {
    return value.toFixed(1)
  }
  return String(Math.round(value))
}

/** 底部小圆环：表示上下文占用比例 */
const Ring = ({ percent }: { percent: number }) => {
  const radius = 6
  const length = 2 * Math.PI * radius
  const filled = (Math.max(0, Math.min(100, percent)) / 100) * length
  return (
    <svg className={styles.ring} width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${filled} ${length - filled}`}
        transform="rotate(-90 8 8)"
      />
    </svg>
  )
}

/**
 * 本轮消耗额度面板。
 *
 * 数据全部来自这条回复的 usage（输入命中 / 输入未命中 / 输出），单价按时间估算：
 * 高峰期按官方高峰价，其余按空闲价；未知模型只显示用量，不显示金额。
 *
 * 交互照官方：点遮罩/返回关闭；抓着把手下滑超过阈值或甩动速度够快也关闭，没到阈值弹回。
 */
export const UsageSheet = ({
  usage,
  model,
  provider,
  at,
  onClose,
}: {
  usage: MessageUsage
  model: string | null
  /** 本轮实际通道；第三方通道没有公开单价，只显示用量 */
  provider?: 'deepseek' | 'workbuddy' | 'custom'
  /** 回复开始时间，用来判断高峰/空闲时段 */
  at: number
  onClose: () => void
}) => {
  const t = useTranslate()
  // 只有 DeepSeek 官方通道才有公开单价；第三方通道即使模型名相同也可能计费不同，一律只显示用量
  const cost = estimateUsageCost(usage, provider && provider !== 'deepseek' ? null : model, at)

  const sheetRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)
  const dragInfo = useRef<{ startY: number; lastY: number; lastT: number; velocity: number; dy: number } | null>(null)

  const [closing, setClosing] = useState(false)
  const [dragY, setDragY] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const [snapping, setSnapping] = useState(false)
  const [sheetHeight, setSheetHeight] = useState(0)

  const clearTimer = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  // 关闭：从当前位置继续下滑到屏幕外，动画结束再卸载（官方同一个弹簧）
  const startClosing = useCallback(() => {
    if (closing) {
      return
    }
    clearTimer()
    setSheetHeight((height) => height || sheetRef.current?.offsetHeight || 600)
    setDragY(null)
    setDragging(false)
    setSnapping(false)
    setClosing(true)
    closeTimer.current = window.setTimeout(onClose, SPRING_MS)
  }, [closing, onClose])

  const requestClose = useCallback(() => {
    if (closing) {
      return
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      onClose()
      return
    }
    startClosing()
  }, [closing, onClose, startClosing])

  useEffect(() => () => clearTimer(), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        requestClose()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [requestClose])

  if (!cost) {
    return null
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (closing || (event.pointerType === 'mouse' && event.button !== 0)) {
      return
    }
    clearTimer()
    const height = sheetRef.current?.offsetHeight || 600
    setSheetHeight(height)
    dragInfo.current = { startY: event.clientY, lastY: event.clientY, lastT: performance.now(), velocity: 0, dy: 0 }
    setSnapping(false)
    setDragging(true)
    setDragY(0)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const info = dragInfo.current
    if (!info) {
      return
    }
    const dy = Math.max(0, event.clientY - info.startY)
    const now = performance.now()
    const dt = now - info.lastT
    if (dt > 0) {
      info.velocity = (event.clientY - info.lastY) / dt
      info.lastY = event.clientY
      info.lastT = now
    }
    info.dy = dy
    setDragY(dy)
    if (dy > 0) {
      event.preventDefault()
    }
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const info = dragInfo.current
    dragInfo.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!info) {
      return
    }
    const dy = Math.max(info.dy, dragY ?? 0)
    const height = sheetHeight || sheetRef.current?.offsetHeight || 600
    setDragging(false)
    if (dy > height * 0.26 || info.velocity > 0.55) {
      startClosing()
    } else {
      setSnapping(true)
      setDragY(0)
      closeTimer.current = window.setTimeout(() => {
        setSnapping(false)
        setDragY(null)
      }, SPRING_MS)
    }
  }

  const hitRate = cost.promptTokens > 0 ? (cost.cacheHitTokens / cost.promptTokens) * 100 : null
  const footer =
    cost.contextPercent !== null && hitRate !== null
      ? t('usageContextHit', { percent: percentText(cost.contextPercent), hit: Math.round(hitRate) })
      : cost.contextPercent !== null
        ? t('usageContext', { percent: percentText(cost.contextPercent) })
        : hitRate !== null
          ? t('usageHitRate', { hit: Math.round(hitRate) })
          : null

  const sections = [
    {
      title: t('usageInput'),
      sub: t('usageCacheHit'),
      rate: cost.rates?.cacheHit ?? null,
      tokens: cost.cacheHitTokens,
      money: cost.cacheHitCost,
    },
    {
      title: t('usageInput'),
      sub: t('usageCacheMiss'),
      rate: cost.rates?.cacheMiss ?? null,
      tokens: cost.cacheMissTokens,
      money: cost.cacheMissCost,
    },
    {
      title: t('usageOutput'),
      sub: null,
      rate: cost.rates?.output ?? null,
      tokens: cost.outputTokens,
      money: cost.outputCost,
    },
  ]

  const sheetStyle: CSSProperties = {}
  if (closing) {
    sheetStyle.transform = `translateY(${sheetHeight || 600}px)`
    sheetStyle.transition = `transform ${SPRING_MS}ms ${SPRING_EASE}`
  } else if (dragY !== null) {
    sheetStyle.transform = `translateY(${dragY}px)`
    sheetStyle.transition = dragging ? 'none' : `transform ${SPRING_MS}ms ${SPRING_EASE}`
  }

  // 拖拽小横条时遮罩保持原样，不跟着变透明；只有真正关闭时才淡出
  const overlayStyle: CSSProperties = {}
  if (closing) {
    overlayStyle.opacity = 0
    overlayStyle.transition = `opacity ${SPRING_MS}ms ${SPRING_EASE}`
  }

  return createPortal(
    <div
      className={clsx(styles.overlay, closing && styles.closing)}
      style={overlayStyle}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          requestClose()
        }
      }}
    >
      <div
        ref={sheetRef}
        className={styles.sheet}
        style={sheetStyle}
        data-dragging={dragging ? '' : undefined}
        data-closing={closing ? '' : undefined}
        data-snapping={snapping ? '' : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={t('usageTitle')}
      >
        <div
          className={styles.grab}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-hidden
        >
          <div className={styles.handle} />
        </div>
        <div className={styles.header}>
          <span className={styles.icon} aria-hidden>
            <MaskIcon name="database" />
          </span>
          <span className={styles.title}>{t('usageTitle')}</span>
          <span className={styles.amount}>
            {cost.known && cost.totalCost !== null
              ? `${formatYuan(cost.totalCost)} 元`
              : t('usageTokensOnly')}
          </span>
        </div>
        <div className={styles.subtitle}>
          {cost.known
            ? t(cost.tier === 'peak' ? 'usageEstimatePeak' : 'usageEstimateIdle')
            : t('usageEstimateUnknown')}
        </div>
        <div className={styles.card}>
          {sections.map((section) => (
            <div className={styles.section} key={section.title + section.sub}>
              <div className={styles.name}>
                <span className={styles.nameMain}>{section.title}</span>
                {section.sub ? <span className={styles.nameSub}>{section.sub}</span> : null}
              </div>
              <div className={styles.values}>
                <div className={styles.valueRow}>
                  <span className={styles.valueLabel}>{t('usageUnitPrice')}</span>
                  <span className={styles.value}>
                    {section.rate === null ? '—' : `${unitPrice(section.rate)} 元 / 百万 tokens`}
                  </span>
                </div>
                <div className={styles.valueRow}>
                  <span className={styles.valueLabel}>{t('usageTokens')}</span>
                  <span className={styles.value}>{formatTokens(section.tokens)} tokens</span>
                </div>
                <div className={styles.valueRow}>
                  <span className={styles.valueLabel}>{t('usageAmount')}</span>
                  <span className={styles.value}>
                    {section.money === null ? '—' : `${formatYuan(section.money)} 元`}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
        {footer ? (
          <div className={styles.footer}>
            {cost.contextPercent !== null ? <Ring percent={cost.contextPercent} /> : null}
            <span>{footer}</span>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
