import path from 'node:path'
import { rspack, type Compiler } from '@rspack/core'

// The small standalone adapters must run before React initializes the Android preferences.
const headScripts = ['system-font', 'attachments', 'voice-composer', 'read-aloud', 'drawer-perf', 'mobile-history', 'font-switch', 'fluid-blob', 'mobile-settings', 'message-share', 'message-actions', 'overscroll']
const styles = ['drawer-perf', 'brand', 'attachments', 'voice-composer', 'mobile-history', 'mobile-settings', 'message-actions']
const bodyScripts = ['search']

export const mobileAssets = (root: string) => [
  new rspack.CopyRspackPlugin({ patterns: [
    /* .js 已改成 rspack 入口（走 swc 降级），这里只拷 CSS 与静态资源 */
    { context: path.join(root, 'mobile'), from: '*.css', to: '[name].[contenthash:8][ext]' },
    { from: path.join(root, 'mobile/ui-icons'), to: 'ui-icons' },
    /* 内置 MiSans（子集化 woff2）：打包进 assets/chat/fonts/，任何机型都能用 */
    { from: path.join(root, 'mobile/fonts'), to: 'fonts' },
    ...['mobile/whale.svg', 'LICENSE.community', 'NOTICE'].map(file => ({ from: path.join(root, file), to: path.basename(file), toType: 'file' as const })),
  ] }),
  { apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap('MobileEntry', compilation => {
      compilation.hooks.processAssets.tap({ name: 'MobileEntry', stage: rspack.Compilation.PROCESS_ASSETS_STAGE_REPORT }, () => {
        const entry = compilation.getAsset('index.html')
        if (!entry) throw new Error('Missing compiled chat entry')
        const names = compilation.getAssets().map(asset => asset.name)
        function find(base: string, ext: string) {
          const matches = names.filter(file => file.startsWith(base + '.') && file.endsWith('.' + ext))
          if (matches.length !== 1) throw new Error(`Expected one asset for ${base}.${ext}`)
          return matches[0]
        }
        const script = (base: string) => `<script defer src="${find(base, 'js')}"></script>`
        const style = (base: string) => `<link rel="stylesheet" href="${find(base, 'css')}">`
        const html = entry.source.source().toString()
          .replace('<head>', '<head>' + headScripts.map(script).join(''))
          .replace('</head>', styles.map(style).join('') + '</head>')
          .replace('</body>', bodyScripts.map(script).join('') + '</body>')
        compilation.updateAsset('index.html', new rspack.sources.RawSource(html))
      })
    })
  } },
]
