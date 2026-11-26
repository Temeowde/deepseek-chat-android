import { useSettings } from '../services/settings.js'
import { en } from './en.js'
import { zh } from './zh.js'

export type TranslationKey = keyof typeof zh
export type TranslationParams = Record<string, string | number>
export type TranslationMessage = { key: TranslationKey; params?: TranslationParams }
/** 带文字链接的提示：link 跟在正文后，在新窗口打开；type 为 error 时前面带错误图标 */
export type LinkedMessage = TranslationMessage & {
  type?: 'error'
  link?: { key: TranslationKey; href: string }
}

export const isTranslationKey = (key: unknown): key is TranslationKey =>
  typeof key === 'string' && Object.hasOwn(zh, key)

/*
 * 缺键兜底：之前某个键在语言包里缺失时，messages[key] 是 undefined，
 * 直接 .replace 会抛异常，而异常发生在渲染期 → 整页白屏（用户看到全黑/全白）。
 * 这里改成「当前语言 → 中文 → 键名」三级回退，任何缺键最多显示得不好看，不会白屏。
 */
const createTranslate =
  (messages: Record<TranslationKey, string>, fallback?: Record<TranslationKey, string>) =>
  (key: TranslationKey, params?: TranslationParams): string => {
    const template = messages[key] ?? fallback?.[key] ?? String(key)
    return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
      const value = params?.[name]
      return typeof value === 'string' || typeof value === 'number' ? String(value) : placeholder
    })
  }

const translators = {
  'zh-CN': createTranslate(zh),
  'en-US': createTranslate(en, zh),
}

/** 组件订阅语言变化；普通函数在调用时读取当前语言。 */
export const useTranslate = () => useSettings((state) => translators[state.locale])

export const translate = (key: TranslationKey, params?: TranslationParams): string =>
  translators[useSettings.getState().locale](key, params)
