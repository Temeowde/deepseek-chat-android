import type { CSSProperties } from 'react'

/** 官方矢量图标（来自官方 APK，拷进 web/mobile/ui-icons/*.svg）用 mask 渲染，颜色跟随 currentColor */
export const MaskIcon = ({
  name,
  size,
  className,
}: {
  name: string
  size?: number
  className?: string
}) => (
  <span
    className={className ? `ds-ui-icon ${className}` : 'ds-ui-icon'}
    aria-hidden
    style={{
      '--ds-icon': `url("ui-icons/${name}.svg")`,
      ...(size ? { width: `${size}px`, height: `${size}px` } : null),
    } as CSSProperties}
  />
)
