declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {}

/** 公开 API 的地址，见 rspack.config.ts 的 createConfig */
declare const __API_ORIGIN__: string

declare module '*.webp' {
  const url: string
  export default url
}

interface Window {
  DeepSeekHandleBack?: () => boolean
  DeepSeekAndroid?: {
    shareMessage?: (kind: 'text' | 'png' | 'csv', data: string, wechat: boolean) => boolean
    openSource?: (url: string, locale: string, dark: boolean) => boolean
    getApiKey: () => string
    setApiKey: (key: string) => boolean
    clearApiKey: () => void
    getSystemTheme: () => string
    setTheme: (theme: string) => void
    exportFile: (filename: string, base64: string) => void
    officialLogin?: () => void
    officialHasToken?: () => boolean
    officialLogout?: () => void
    officialRequest?: (id: string, path: string) => void
    officialPasswordLogin?: (id: string, account: string, password: string) => void
  }
}

/** Prism 语言包通过副作用注册到全局 Prism */
declare module 'prismjs/components/*' {}

/** KaTeX 化学公式扩展通过副作用注册到 KaTeX */
declare module 'katex/contrib/mhchem' {}
