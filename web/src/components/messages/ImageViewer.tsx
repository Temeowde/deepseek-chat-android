import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import { addDraftFiles } from '../../services/chat/drafts.js'
import { useChatStore } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import { CropEditor } from './CropEditor.js'
import styles from './ImageViewer.module.css'

/**
 * 全屏图片查看器。
 *
 * 查看模式只做三件事：双指缩放、单指平移、双击放大/还原。
 * 图片始终 contain 在「可用区域」内（避开顶栏/底栏），
 * 缩放时以手指中点为锚，**缩回最小后强制回到正中**（不会跑上跑下）。
 *
 * 裁切交给 CropEditor（Cropper.js），不在这里手搓几何。
 */

const MIN_SCALE = 1
const MAX_SCALE = 6
/** 顶部/底部给「还原/旋转」「✕/去提问」预留 */
const TOP_RESERVE = 96
const BOTTOM_RESERVE = 128
const EDGE = 18

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const readBlobBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('read failed'))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })

export const ImageViewer = ({ src, name, onClose }: { src: string; name: string; onClose: () => void }) => {
  const t = useTranslate()
  const [shown] = useState(src)
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [viewport, setViewport] = useState(() => ({
    w: typeof window === 'undefined' ? 360 : window.innerWidth,
    h: typeof window === 'undefined' ? 800 : window.innerHeight,
  }))
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [cropOpen, setCropOpen] = useState(false)
  const [busy, setBusy] = useState<'crop' | 'download' | null>(null)

  const animRef = useRef(0)
  const gesture = useRef<{ mode: 'pan' | 'pinch' | null; startX: number; startY: number; baseX: number; baseY: number; dist: number; baseScale: number }>({
    mode: null,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
    dist: 0,
    baseScale: 1,
  })

  /** 可用区域（避开顶栏/底栏） */
  const area = useMemo(
    () => ({
      x: EDGE,
      y: TOP_RESERVE,
      w: Math.max(40, viewport.w - EDGE * 2),
      h: Math.max(40, viewport.h - TOP_RESERVE - BOTTOM_RESERVE),
    }),
    [viewport]
  )

  /** 图片 contain 后的尺寸 */
  const fit = useMemo(() => {
    if (!natural.w || !natural.h) {
      return { w: 0, h: 0 }
    }
    const ratio = Math.min(area.w / natural.w, area.h / natural.h)
    return { w: natural.w * ratio, h: natural.h * ratio }
  }, [area, natural])

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => () => cancelAnimationFrame(animRef.current), [])

  /**
   * 夹紧图片位置。
   * 关键：缩放回到最小（1x）时必须**精确回到居中**（offset = 0,0），
   * 否则多次缩放会残留几十像素的偏移，看起来就是"图跑到屏幕上面/下面"。
   */
  const clampOffset = useCallback(
    (nextScale: number, nextOffset: { x: number; y: number }) => {
      if (nextScale <= MIN_SCALE + 0.0001) {
        return { x: 0, y: 0 }
      }
      const shownW = fit.w * nextScale
      const shownH = fit.h * nextScale
      const centeredX = area.x + (area.w - shownW) / 2
      const centeredY = area.y + (area.h - shownH) / 2
      let x = nextOffset.x
      let y = nextOffset.y
      const left = centeredX + x
      const top = centeredY + y
      if (shownW >= area.w) {
        x += clamp(area.x - left, Math.min(0, area.x + area.w - (left + shownW)), 0)
      } else {
        x = 0
      }
      if (shownH >= area.h) {
        y += clamp(area.y - top, Math.min(0, area.y + area.h - (top + shownH)), 0)
      } else {
        y = 0
      }
      // 亚像素抖动归零，避免累积漂移
      if (Math.abs(x) < 0.5) x = 0
      if (Math.abs(y) < 0.5) y = 0
      return { x, y }
    },
    [area, fit]
  )

  const applyScale = useCallback(
    (nextScale: number, nextOffset: { x: number; y: number }) => {
      const value = clamp(nextScale, MIN_SCALE, MAX_SCALE)
      setScale(value)
      setOffset(clampOffset(value, nextOffset))
    },
    [clampOffset]
  )

  /** rAF 动画（双击/回正用） */
  const animateTo = useCallback(
    (targetScale: number, targetOffset: { x: number; y: number }, duration = 220) => {
      cancelAnimationFrame(animRef.current)
      const s0 = scale
      const o0 = offset
      const startedAt = performance.now()
      const ease = (value: number) => 1 - Math.pow(1 - value, 3)
      const step = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / duration)
        const k = ease(progress)
        const nextScale = s0 + (targetScale - s0) * k
        setScale(nextScale)
        setOffset({ x: o0.x + (targetOffset.x - o0.x) * k, y: o0.y + (targetOffset.y - o0.y) * k })
        if (progress < 1) {
          animRef.current = requestAnimationFrame(step)
        } else {
          // 结束后再夹一次，确保精确落位（回正到 0,0）
          const finalScale = clamp(targetScale, MIN_SCALE, MAX_SCALE)
          setScale(finalScale)
          setOffset(clampOffset(finalScale, targetOffset))
        }
      }
      animRef.current = requestAnimationFrame(step)
    },
    [clampOffset, offset, scale]
  )

  /* ---------------- 触摸手势 ---------------- */

  const onTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    cancelAnimationFrame(animRef.current)
    if (event.touches.length === 2) {
      const [a, b] = [event.touches[0], event.touches[1]]
      gesture.current = {
        mode: 'pinch',
        startX: (a.clientX + b.clientX) / 2,
        startY: (a.clientY + b.clientY) / 2,
        baseX: offset.x,
        baseY: offset.y,
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        baseScale: scale,
      }
      return
    }
    if (event.touches.length === 1) {
      const touch = event.touches[0]
      gesture.current = {
        mode: 'pan',
        startX: touch.clientX,
        startY: touch.clientY,
        baseX: offset.x,
        baseY: offset.y,
        dist: 0,
        baseScale: scale,
      }
    }
  }

  const onTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g.mode) {
      return
    }
    if (g.mode === 'pinch' && event.touches.length === 2) {
      event.preventDefault()
      const [a, b] = [event.touches[0], event.touches[1]]
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      const nextScale = clamp(g.baseScale * (g.dist > 0 ? dist / g.dist : 1), MIN_SCALE, MAX_SCALE)
      /*
       * 以双指中点为锚：保证中点下的图片像素不动。
       * 再叠加"回正力"：缩到接近最小时，把平移量往 0 拉，
       * 这样松手时一定回到正中，不会残留偏移。
       */
      const centerX = area.x + area.w / 2
      const centerY = area.y + area.h / 2
      const zoomRatio = nextScale / Math.max(0.0001, g.baseScale)
      let nextX = g.baseX - (g.startX - centerX) * (zoomRatio - 1)
      let nextY = g.baseY - (g.startY - centerY) * (zoomRatio - 1)
      if (nextScale <= MIN_SCALE + 0.05) {
        nextX = 0
        nextY = 0
      }
      applyScale(nextScale, { x: nextX, y: nextY })
      return
    }
    if (g.mode === 'pan' && event.touches.length === 1 && scale > MIN_SCALE) {
      event.preventDefault()
      const touch = event.touches[0]
      applyScale(scale, { x: g.baseX + (touch.clientX - g.startX), y: g.baseY + (touch.clientY - g.startY) })
    }
  }

  const onTouchEnd = () => {
    const wasPinch = gesture.current.mode === 'pinch'
    gesture.current.mode = null
    // 捏合结束：接近最小就直接回正（消除累积偏移）
    if (wasPinch && scale <= MIN_SCALE + 0.05) {
      animateTo(MIN_SCALE, { x: 0, y: 0 })
    }
  }

  const lastTap = useRef(0)
  const onStageClick = () => {
    if (busy) {
      return
    }
    const now = Date.now()
    if (now - lastTap.current < 280) {
      lastTap.current = 0
      if (scale > 1.1) {
        animateTo(1, { x: 0, y: 0 })
      } else {
        animateTo(2.4, offset)
      }
      return
    }
    lastTap.current = now
  }

  /* ---------------- 裁切 / 下载 ---------------- */

  const handleCrop = async (blob: Blob) => {
    setBusy('crop')
    try {
      const sessionId = useChatStore.getState().activeId
      const settings = useSettings.getState()
      const inlineImages = settings.provider !== 'deepseek' && settings.search !== true
      const base = name.replace(/\.[^.]+$/, '') || 'image'
      const file = new File([blob], `${base}-crop.png`, { type: 'image/png' })
      const error = addDraftFiles(sessionId, [file], settings.apiKey ?? '', inlineImages)
      if (error) {
        return
      }
      setCropOpen(false)
      onClose()
    } finally {
      setBusy(null)
    }
  }

  const download = async () => {
    setBusy('download')
    try {
      const response = await fetch(shown)
      const blob = await response.blob()
      const base64 = await readBlobBase64(blob)
      const bridge = (window as unknown as { DeepSeekAndroid?: { exportFile?: (n: string, d: string) => void } }).DeepSeekAndroid
      bridge?.exportFile?.(name || 'image.png', base64)
    } catch {
      // ignore
    } finally {
      setBusy(null)
    }
  }

  /* ---------------- 返回键 / 侧滑 ---------------- */

  useEffect(() => {
    const w = window as unknown as { closeImageViewer?: () => boolean }
    w.closeImageViewer = () => {
      if (cropOpen) {
        setCropOpen(false)
        return true
      }
      onClose()
      return true
    }
    return () => {
      delete w.closeImageViewer
    }
  }, [cropOpen, onClose])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      if (cropOpen) {
        setCropOpen(false)
      } else {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cropOpen, onClose])

  return createPortal(
    <div className={styles.root} role="dialog" aria-modal="true" aria-label={name}>
      <div
        className={styles.stage}
        style={{ padding: `${TOP_RESERVE}px ${EDGE}px ${BOTTOM_RESERVE}px` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClick={onStageClick}
      >
        <img
          className={styles.image}
          src={shown}
          alt={name}
          draggable={false}
          onLoad={event => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
          style={{
            width: fit.w || undefined,
            height: fit.h || undefined,
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
          }}
        />
      </div>

      <button type="button" className={styles.close} aria-label={t('close')} onClick={onClose}>
        ×
      </button>
      <div className={styles.actions} style={{ opacity: cropOpen ? 0 : 1, pointerEvents: cropOpen ? 'none' : 'auto' }}>
        <button
          type="button"
          className={styles.action}
          aria-label={t('cropImage')}
          onClick={() => setCropOpen(true)}
          disabled={busy !== null || !natural.w}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M6 2v14a2 2 0 0 0 2 2h14" />
            <path d="M2 6h14a2 2 0 0 1 2 2v14" />
          </svg>
        </button>
        <button
          type="button"
          className={clsx(styles.action, styles.actionPrimary)}
          aria-label={t('downloadImage')}
          onClick={download}
          disabled={busy !== null}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path d="M12 3v12" />
            <path d="M7 11l5 5 5-5" />
            <path d="M4 20h16" />
          </svg>
        </button>
      </div>

      {cropOpen ? (
        <CropEditor src={shown} name={name} onCancel={() => setCropOpen(false)} onCrop={handleCrop} busy={busy !== null} />
      ) : null}
    </div>,
    document.body
  )
}
