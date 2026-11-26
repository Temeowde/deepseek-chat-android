import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslate } from '../../i18n/index.js'
import styles from './CropEditor.module.css'

/**
 * 裁切页（直接使用 Cropper.js 1.6，不再手搓几何）
 *
 * 选 Cropper.js 的原因（对照用户要的行为）：
 *  - viewMode: 1 = 裁切框被限制在图片内 → **永远不可能裁到图外**
 *  - 裁切框与图片变换分离 → 缩放图片时**框大小不变**，不会出现"图跟着框放大"
 *  - 内置 8 个方向控制点（4 角 + 4 边）+ 框内拖动，触摸手势成熟
 *  - 支持双指缩放（zoomOnTouch），旋转 rotate(90)、重置 reset()
 *  - getCroppedCanvas() 直接给出裁切后的 canvas，像素映射由库负责
 *
 * 我们只做两件事：套上 App 的顶栏/底栏样式、把控制点改成官方那种白色标记。
 */
export const CropEditor = ({
  src,
  name,
  onCancel,
  onCrop,
  busy,
}: {
  src: string
  name: string
  onCancel: () => void
  onCrop: (blob: Blob) => void
  busy: boolean
}) => {
  const t = useTranslate()
  const imageRef = useRef<HTMLImageElement | null>(null)
  const cropperRef = useRef<Cropper | null>(null)
  const [ready, setReady] = useState(false)
  const [working, setWorking] = useState(false)

  useEffect(() => {
    const image = imageRef.current
    if (!image) {
      return
    }
    // 官方最小裁切框 = min(视口宽, 视口高) / 10
    const minBox = Math.max(24, Math.round(Math.min(window.innerWidth, window.innerHeight) / 10))
    const cropper = new Cropper(image, {
      viewMode: 1, // 裁切框限制在图片内（核心：不可能裁到图外）
      dragMode: 'crop',
      aspectRatio: Number.NaN,
      autoCropArea: 1,
      background: false,
      modal: false,
      guides: false,
      center: false,
      highlight: false,
      responsive: true,
      restore: false,
      checkCrossOrigin: false,
      toggleDragModeOnDblclick: false,
      zoomOnTouch: true,
      zoomOnWheel: false,
      movable: true,
      rotatable: true,
      scalable: false,
      minCropBoxWidth: minBox,
      minCropBoxHeight: minBox,
      ready: () => setReady(true),
    })
    cropperRef.current = cropper
    return () => {
      cropper.destroy()
      cropperRef.current = null
    }
  }, [src])

  const reset = () => {
    cropperRef.current?.reset()
  }

  const rotate = () => {
    cropperRef.current?.rotate(90)
  }

  const confirm = async () => {
    const cropper = cropperRef.current
    if (!cropper || working || busy) {
      return
    }
    setWorking(true)
    try {
      const canvas = cropper.getCroppedCanvas({
        maxWidth: 4096,
        maxHeight: 4096,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
      })
      if (!canvas) {
        return
      }
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(value => resolve(value), 'image/png'))
      if (blob) {
        onCrop(blob)
      }
    } finally {
      setWorking(false)
    }
  }

  return createPortal(
    <div className={styles.root} role="dialog" aria-modal="true" aria-label={name}>
      <div className={styles.topBar}>
        <button type="button" className={styles.topAction} onClick={reset} disabled={!ready}>
          {t('imageReset')}
        </button>
        <button type="button" className={styles.topAction} onClick={rotate} disabled={!ready}>
          <span className={styles.topIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M4 8h9a5 5 0 0 1 0 10H7" />
              <path d="M7 4L3 8l4 4" />
            </svg>
          </span>
          {t('imageRotate')}
        </button>
      </div>

      <div className={styles.stage}>
        <img ref={imageRef} src={src} alt={name} className={styles.image} />
      </div>

      <div className={styles.bottomBar}>
        <button type="button" className={styles.cancel} aria-label={t('cancel')} onClick={onCancel}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <button type="button" className={styles.confirm} onClick={confirm} disabled={!ready || working || busy}>
          {t('imageAsk')}
        </button>
      </div>
    </div>,
    document.body
  )
}
