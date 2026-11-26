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

/** 「本地保留」桥：只在用户开启开关后才会申请权限。 */
interface BackupAndroidBridge {
  backupDir: () => string
  hasAccess: () => boolean
  requestAccess: () => void
  deviceTag: () => string
  listBackups: () => string
  readBackup: (name: string) => string | null
  saveBackup: (name: string, base64: string) => boolean
  deleteBackup: (name: string) => boolean
  /** 分块读写（大文件用；老版本 App 可能没有这些方法，调用前先判断类型） */
  backupSize?: (name: string) => number
  readBackupChunk?: (name: string, offset: number, length: number) => string | null
  beginBackupWrite?: (name: string) => boolean
  appendBackup?: (name: string, base64: string) => boolean
  finishBackupWrite?: (name: string, expectedSize: number) => boolean
  abortBackupWrite?: (name: string) => boolean
  /** 把文件登记进系统媒体库，让它出现在「最近文件」里 */
  scanMedia?: (name: string) => boolean
  /** 打开系统「文件」App（返回 "ok:..." 或 "fail:原因"） */
  openFilesApp?: () => string | boolean
  /** 复制文本到系统剪贴板（打开失败时的兜底） */
  copyText?: (text: string) => boolean
}

/** 屏幕方向桥：表格全屏时切横屏。 */
interface ScreenAndroidBridge {
  landscape: () => void
  portrait: () => void
  orientation: () => number
}

/** 头像缓存桥：原生下载一次并存到缓存目录，返回 dataURL。 */
interface AvatarAndroidBridge {
  avatar: (url: string) => string
}

interface Window {
  AvatarAndroid?: AvatarAndroidBridge
  ScreenAndroid?: ScreenAndroidBridge
  BackupAndroid?: BackupAndroidBridge
  DeepSeekHandleBack?: () => boolean
  /** 关闭全屏图片查看器（裁切页先退回查看页）；返回 true 表示已消费返回事件 */
  closeImageViewer?: () => boolean
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
    officialPost?: (id: string, path: string, json: string) => void
    officialPasswordLogin?: (id: string, account: string, password: string) => void
  }
}

/** Prism 语言包通过副作用注册到全局 Prism */
declare module 'prismjs/components/*' {}

/** KaTeX 化学公式扩展通过副作用注册到 KaTeX */
declare module 'katex/contrib/mhchem' {}
