import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { IconEditOutline16 } from '../base/icons.js'
import { setApiKey, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { IconButton } from '../base/IconButton.js'
import { useApiKeyForm } from './useApiKeyForm.js'
import { useTranslate } from '../../i18n/index.js'
import { officialHasToken } from '../../services/official/bridge.js'
import styles from './Settings.module.css'

/** API Key 的编辑状态：输入框与移动端底部的「确定」按钮共用 */
export const useApiKeyEditor = () => {
  const apiKey = useSettings((state) => state.apiKey)
  const [editing, setEditing] = useState(false)
  const form = useApiKeyForm(() => setEditing(false))
  return {
    apiKey,
    editing,
    setEditing,
    form,
    // DeepSeek Key 不再只属于 DeepSeek 聊天通道，WorkBuddy/自定义下也要能填写。
    showInput: !apiKey || editing,
  }
}

type ApiKeyEditor = ReturnType<typeof useApiKeyEditor>

/** API Key：保存后只显示掩码，点编辑按钮才能重新输入 */
export const ApiKeyField = ({ editor }: { editor: ApiKeyEditor }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const { apiKey, editing, setEditing, form, showInput } = editor
  const provider = useSettings((state) => state.provider)
  const officialOnly = provider !== 'deepseek'
  const [confirmDelete, setConfirmDelete] = useState(false)
  /* DeepSeek 通道默认展开说明：很多人不知道去哪拿 Key、怎么填 */
  const [showHelp, setShowHelp] = useState(() => useSettings.getState().provider === 'deepseek')

  /** 通过原生 SourceReader 打开官方 API Key 页面，页面内还可以再选「在浏览器打开」。 */
  const openPlatform = () => {
    const url = 'https://platform.deepseek.com/api_keys'
    const bridge = (window as unknown as {
      DeepSeekAndroid?: {
        openSource?: (url: string, locale: string, dark: boolean) => boolean
      }
    }).DeepSeekAndroid
    if (bridge?.openSource) {
      bridge.openSource(url, useSettings.getState().locale, document.body.classList.contains('dark'))
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  useEffect(() => {
    if (!apiKey || editing) {
      setConfirmDelete(false)
    }
  }, [apiKey, editing])

  useEffect(() => {
    if (!confirmDelete) {
      return
    }
    const timer = window.setTimeout(() => setConfirmDelete(false), 4000)
    return () => window.clearTimeout(timer)
  }, [confirmDelete])

  const removeApiKey = () => {
    setApiKey(null)
    form.setValue('')
    setEditing(false)
    setConfirmDelete(false)
  }

  return (
    <div className={styles.cell}>
      <div className={styles.apiKey}>
        <div className={styles.apiKeyHeader}>
          <div className={styles.label}>
            {officialOnly
              ? t('deepseekOfficialKey')
              : t(apiKey && !editing ? 'apiKeyEdit' : 'apiKeyStart')}
          </div>
        </div>
        {officialOnly && !apiKey ? (
          <div className={styles.hint}>{t('deepseekOfficialKeyHint')}</div>
        ) : null}
        {apiKey && !editing ? (
          <div className={clsx(styles.apiKeySaved, styles.apiKeyBox)}>
            <span className={styles.apiKeyMask}>{'*'.repeat(apiKey.length)}</span>
            <div className={styles.apiKeyActions}>
              <button
                type="button"
                className={styles.apiKeyDelete}
                onClick={() => {
                  if (confirmDelete) {
                    removeApiKey()
                  } else {
                    setConfirmDelete(true)
                  }
                }}
              >
                {confirmDelete ? t('apiKeyDeleteConfirm') : t('apiKeyDelete')}
              </button>
              <IconButton
                tone="primary"
                icon={<IconEditOutline16 />}
                tooltip={t('apiKeyEdit')}
                onClick={() => {
                  setConfirmDelete(false)
                  setEditing(true)
                }}
              />
            </div>
          </div>
        ) : (
          <div className={clsx(styles.apiKeyInput, styles.apiKeyBox)}>
            <input
              type="password"
              placeholder={t('apiKeyPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              // 移动端打开设置时不弹键盘，点编辑后才聚焦
              autoFocus={!isMobile || editing}
              value={form.value}
              onChange={(event) => form.setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  void form.submit()
                }
              }}
              onBlur={() => {
                // 修改时没输入就离开，回到已保存的状态
                if (apiKey && !form.value.trim()) {
                  setEditing(false)
                }
              }}
            />
            {form.value.trim() ? (
              <>
                <span className={styles.divider} />
                <button
                  type="button"
                  className={styles.confirm}
                  disabled={form.verifying}
                  // 保持输入框焦点
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void form.submit()}
                >
                  {form.verifying ? t('apiKeyVerifying') : t('confirm')}
                </button>
              </>
            ) : null}
          </div>
        )}
        {/*
         * 用户很容易困惑：明明已经登录官方账号了，为什么还要单独填 API Key。
         * 这两条链路确实是分开的 —— 官方账号 token 只用于同步会话历史，
         * 发消息走的是 DeepSeek 开放平台，需要用户自己的 API Key。
         * 不解释的话，登录过的用户会以为「设置没保存」或者「登录没生效」。
         */}
        {/* 输入框下面这一行就是获取 Key 的入口：点开看步骤，不直接跳官网 */}
        {showInput && !apiKey ? (
          <div className={styles.hint}>
            {!officialOnly && officialHasToken() ? `${t('apiKeyOfficialHint')} ` : ''}
            <button
              type="button"
              className={styles.apiKeyInlineLink}
              aria-expanded={showHelp}
              onClick={() => setShowHelp((value) => !value)}
            >
              {t('apiKeyGetLink')}
            </button>
          </div>
        ) : null}
        {/* 教程跟其它折叠区一样：高度 + 透明度过渡，不要瞬间弹出 */}
        <div className={clsx(styles.expander, showHelp && styles.expanderOpen)}>
          <div className={styles.expanderInner}>

            <div className={styles.apiKeyHelp}>
              <div className={styles.hint}>
                {officialOnly ? t('apiKeyHelpWhatOfficial') : t('apiKeyHelpWhatDeepSeek')}
              </div>
              <div className={styles.apiKeyHelpSteps}>
                <span>{t('apiKeyHelpStep1')}</span>
                <span>{t('apiKeyHelpStep2')}</span>
                <span>{t('apiKeyHelpStep3')}</span>
                <span>{t('apiKeyHelpStep4')}</span>
              </div>
              <button type="button" className={styles.apiKeyInlineLink} onClick={openPlatform}>
                {t('apiKeyGetLinkOpen')} →
              </button>
            </div>

          </div>
        </div>
        {showInput && form.error ? <div className={styles.error}>{form.error}</div> : null}
      </div>
    </div>
  )
}
