export type Katex = typeof import('katex').default

let katex: Katex | null = null
let katexPromise: Promise<Katex> | null = null

/** 按需加载 KaTeX 及其样式、化学公式扩展；已加载时同步返回 */
export const ensureKatex = (): Katex | Promise<Katex> => {
  if (katex !== null) {
    return katex
  }
  katexPromise ??= Promise.all([
    import('katex'),
    import('katex/contrib/mhchem'),
    // 本地改写的样式：@font-face 只保留 woff2，去掉 woff/ttf 后备，
    // APK 体积少 0.58 MiB（Chromium 36+ / Safari 12+ / Firefox 78+ 都支持 woff2）。
    import('./katex.min.css'),
  ]).then(([module]) => (katex = module.default))
  return katexPromise
}
