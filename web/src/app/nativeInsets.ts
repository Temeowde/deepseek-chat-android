/**
 * WebView 页面重载后的安全区修复。
 *
 * 原生 ChatWindowInsets 只在 Activity 启动时推过一次 --ds-safe-top/--ds-safe-bottom；
 * WebView 页面一旦重载（CDP reload、页面重建等），documentElement 上的内联变量就没了，
 * 之后没有时机重推 → 顶栏 padding-top 退回 0，顶进状态栏，直到用户手动重启 App。
 *
 * 这里在页面启动时：
 * 1) 调 ScreenAndroid.refreshInsets() 让原生重新推一遍；
 * 2) 再读 ScreenAndroid.safeInsetsCss() 兜底直接写 CSS 变量（原生 push 是异步的）；
 * 3) 回到前台时再校验一次。
 */
export const installNativeInsetsRepair = (): void => {
  if (typeof window === 'undefined') {
    return
  }
  const bridge = window.ScreenAndroid
  if (!bridge?.refreshInsets && !bridge?.safeInsetsCss) {
    return
  }
  const style = document.documentElement.style
  const applyFromBridge = () => {
    let raw = ''
    try {
      raw = bridge.safeInsetsCss?.() ?? ''
    } catch {
      return
    }
    if (!raw) {
      return
    }
    const [topRaw, bottomRaw] = raw.split(',')
    const top = Math.round(Number(topRaw))
    const bottom = Math.round(Number(bottomRaw))
    if (Number.isFinite(top) && top > 0) {
      const current = style.getPropertyValue('--ds-safe-top').trim()
      if (!current || current === '0px') {
        style.setProperty('--ds-safe-top', `${top}px`)
      }
    }
    if (Number.isFinite(bottom) && bottom >= 0) {
      const current = style.getPropertyValue('--ds-safe-bottom').trim()
      if (!current) {
        style.setProperty('--ds-safe-bottom', `${bottom}px`)
      }
    }
  }
  const refresh = () => {
    try {
      bridge.refreshInsets?.()
    } catch {
      // 原生刷新失败时，下面的兜底仍会尝试直接写变量
    }
    applyFromBridge()
    window.setTimeout(applyFromBridge, 150)
    window.setTimeout(applyFromBridge, 700)
  }
  refresh()
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refresh()
    }
  })
}
