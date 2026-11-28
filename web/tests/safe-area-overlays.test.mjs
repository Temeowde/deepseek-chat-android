/**
 * 全屏覆盖层安全区检查（防回归）。
 *
 * 背景：这个 WebView 是 edge-to-edge 的，env(safe-area-inset-*) 恒为 0，
 * 状态栏/手势条高度只认原生写的 --ds-safe-top / --ds-safe-bottom。
 * 新增 position: fixed; inset: 0 的全屏页面时，忘了加 safe-area padding，
 * 标题/关闭按钮就会顶到状态栏上（导出选择页就这么出过一次）。
 *
 * 规则：含 `position: fixed` 且 `inset: 0`（或 top:0）的选择器块里，
 * 必须出现 --ds-safe-top；只做「遮罩/底部弹层/居中查看器」的允许豁免。
 *
 * 运行：node web/tests/safe-area-overlays.test.mjs
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.argv[2] ?? path.resolve('web/src')
const ALLOW = new Set([
  // 半透明遮罩：没有顶部内容
  'components/base/Modal.module.css',
  'components/chatInput/DragMask.module.css',
  // 底部弹层 / 居中对话框：顶部不贴屏幕
  'components/messages/UsageSheet.module.css',
  'components/search/sourceSheet.css',
  'components/search/SearchPanel.module.css',
  'components/settings/Settings.module.css',
  // 全屏看图：内容居中，没有顶栏
  'components/messages/MessageFile.module.css',
  'components/messages/ImageViewer.module.css',
])

const walk = (dir) => {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (name.endsWith('.css')) out.push(full)
  }
  return out
}

const offenders = []
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).replaceAll('\\', '/')
  if (ALLOW.has(rel)) continue
  const text = readFileSync(file, 'utf8')
  // 只检查同时出现 fixed 与 inset/top 0 的文件；文件里任何一个块加了 safe-top 就放行
  if (!/position:\s*fixed/.test(text)) continue
  if (!/(inset:\s*0|top:\s*0)/.test(text)) continue
  if (text.includes('--ds-safe-top') || text.includes('--ds-safe-bottom')) continue
  offenders.push(rel)
}

assert.deepEqual(offenders, [], '这些全屏覆盖层可能顶到状态栏，请给容器加 padding-top: var(--ds-safe-top, 0px)：\n' + offenders.join('\n'))
console.log('PASS  全屏覆盖层安全区检查：' + walk(ROOT).length + ' 个 CSS 文件')
