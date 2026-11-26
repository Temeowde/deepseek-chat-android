import { readFileSync } from 'node:fs'
import path from 'node:path'
import { mobileAssets } from './mobileAssets.ts'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rspack/cli'
import { rspack, type Configuration } from '@rspack/core'

const dev = process.env.NODE_ENV !== 'production'
/* 兼容基线：华为/老机型系统 WebView 常见 Chromium 66(M99)；原 chrome>=105 会整包 SyntaxError 白屏 */
const targets = ['chrome >= 66', 'safari >= 12', 'firefox >= 78']

/*
 * web/mobile/*.js 是给 procedure 用的独立脚本，原本由 CopyPlugin 原样拷贝，
 * 不经过 swc —— 老内核（Chromium 66~79）会因其中的 ?. / ?? 解析失败，
 * 文件整段不执行，导致 window.chatHistoryMetadata 等未定义、模块顶层 TypeError、白屏。
 * 这里把它们改成独立入口，让它们也走 swc 降级。
 */
const mobileScripts = [
  'system-font', 'attachments', 'voice-composer', 'read-aloud', 'drawer-perf', 'mobile-history',
  'font-switch', 'fluid-blob', 'mobile-settings', 'message-share', 'message-actions', 'search', 'overscroll',
]
const root = path.dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string }

const cssLoader = {
  loader: 'builtin:lightningcss-loader',
  options: { targets },
}

type ConfigOptions = {
  /** 公开 API 的地址，注入为 __API_ORIGIN__ */
  apiOrigin?: string
  /** 开发服务器配置，支持本地接口代理 */
  devServer?: Configuration['devServer']
}

/** 创建构建配置，支持自定义 API 地址和开发服务器选项 */
export const createConfig = ({
  apiOrigin = 'https://api.deepseek.com',
  devServer,
}: ConfigOptions = {}): Configuration => ({
  mode: dev ? 'development' : 'production',
  entry: {
    main: './src/main.tsx',
    ...Object.fromEntries(mobileScripts.map((name) => [name, './mobile/' + name + '.js'])),
  },
  output: {
    path: path.resolve(root, 'dist'),
    // 运行时按当前脚本地址推导资源路径，file:// 下异步 chunk、字体都按相对位置加载
    publicPath: 'auto',
    filename: (pathData) =>
      mobileScripts.includes(pathData.chunk?.name ?? '')
        ? '[name].[contenthash:8].js'
        : 'static/js/[name].[contenthash:8].js',
    chunkFilename: 'static/js/async/[name].[contenthash:8].js',
    cssFilename: 'static/css/[name].[contenthash:8].css',
    cssChunkFilename: 'static/css/async/[name].[contenthash:8].css',
    assetModuleFilename: 'static/media/[name].[contenthash:8][ext]',
    clean: true,
  },
  devtool: dev ? 'cheap-module-source-map' : false,
  // 开发模式预编译异步模块，保持首次加载代码高亮和公式时的页面状态
  lazyCompilation: false,
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    // 将 .js 导入路径解析到同名 .ts、.tsx 或 .js 文件
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  module: {
    // CSS Modules 使用默认导出：`import styles from './x.module.css'`
    parser: { 'css/module': { namedExports: false } },
    generator: { 'css/module': { localIdentName: '[local]-[hash:6]' } },
    rules: [
      { test: /\.module\.css$/, type: 'css/module', use: [cssLoader] },
      { test: /\.css$/, exclude: /\.module\.css$/, type: 'css', use: [cssLoader] },
      {
        test: /\.[cm]?[jt]sx?$/,
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic', development: dev } },
            externalHelpers: true,
          },
          env: { targets },
        },
        type: 'javascript/auto',
      },
      { test: /\.(woff2?|ttf|webp)$/, type: 'asset/resource' },
    ],
  },
  plugins: [
    ...mobileAssets(root),
    // 经典 defer 脚本支持 file:// 页面的资源加载
    new rspack.HtmlRspackPlugin({
      template: './src/index.html',
      scriptLoading: 'defer',
      meta: { 'application-version': version },
      /*
       * mobile/*.js 现在是独立入口，如果不限定 chunks，
       * HTML 插件会把它们自动注入一遍，和我们手写的 mobileAssets 注入重复。
       */
      chunks: ['main'],
    }),
    new rspack.DefinePlugin({ __API_ORIGIN__: JSON.stringify(apiOrigin) }),
    new rspack.CopyRspackPlugin({
      patterns: [{ from: path.resolve(root, 'LICENSE'), to: 'LICENSE', toType: 'file' }],
    }),
  ],
  performance: { hints: false },
  devServer: { port: 8090, ...devServer },
})

// eslint-disable-next-line import/no-default-export
export default defineConfig(createConfig())
