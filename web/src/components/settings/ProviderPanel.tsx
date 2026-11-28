import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14, IconEditOutline16 } from '../base/icons.js'
import { useAnchoredPosition, useDismiss } from '../base/anchored.js'
import { Select } from '../base/Select.js'
import { useTranslate, type TranslationKey } from '../../i18n/index.js'
import {
  setProvider,
  setWorkBuddyModel,
  useSettings,
  type ChatProvider,
} from '../../services/settings.js'
import {
  workbuddyAccount,
  workbuddyAvailable,
  workbuddyHasToken,
  workbuddyLogin,
  workbuddyLogout,
  type WorkBuddyAccountInfo,
} from '../../services/workbuddy/bridge.js'
import {
  billingAvailable,
  claimWorkBuddyCheckin,
  fetchWorkBuddyBilling,
  maybeAutoCheckin,
  setWorkbuddyAutoCheckin,
  workbuddyAutoCheckin,
  type WorkBuddyBilling,
} from '../../services/workbuddy/billing.js'
import {
  WORKBUDDY_MODELS,
  workBuddyModelHint,
  workBuddyModelLabel,
} from '../../services/workbuddy/models.js'
import {
  clearCustomConfig,
  clearCustomKey,
  customAvailable,
  getCustomConfig,
  listCustomModels,
  saveCustomConfig,
  type CustomProviderConfig,
} from '../../services/custom/bridge.js'
import { ApiKeyField, type useApiKeyEditor } from './ApiKeyField.js'
import { PROVIDER_PRESETS, type ProviderPreset } from './providerPresets.js'
import styles from './Settings.module.css'

/**
 * 服务提供方选择：DeepSeek 开放平台（API Key）、WorkBuddy 账号或自定义接口。
 * 两条通道生成的回复事件格式一致，所以会话、历史、朗读等上层逻辑不分叉。
 *
 * 桌面端把「聊天方式」和「官方 Key」放在同一页；移动端拆成两个二级页，
 * 分别由 ProviderChatPanel / ProviderKeyPanel 渲染，避免一屏塞太多卡片。
 */
export const ProviderPanel = ({ editor }: { editor: ReturnType<typeof useApiKeyEditor> }) => (
  <>
    <ProviderChatPanel />
    <ProviderKeyPanel editor={editor} />
  </>
)

/**
 * 聊天方式：三个通道芯片 + 当前通道自己的配置。
 * 选中 DeepSeek 时不再平铺 Key 卡片，只留一个「去填写官方 Key」入口。
 */
export const ProviderChatPanel = ({
  onOpenKey,
  hideHeader = false,
}: {
  onOpenKey?: () => void
  /** 二级页自己已经有标题与说明，卡片里不再重复一遍 */
  hideHeader?: boolean
}) => {
  const t = useTranslate()
  const provider = useSettings((state) => state.provider)
  const apiKey = useSettings((state) => state.apiKey)
  const choose = (value: ChatProvider) => setProvider(value)

  return (
    <>
      <div className={clsx(styles.cell, 'ds-pref-key-cell')}>
        {hideHeader ? null : <div className={styles.label}>{t('providerTitle')}</div>}
        <div className={styles.providerRow} role="radiogroup" aria-label={t('providerTitle')}>
          <button
            type="button"
            role="radio"
            aria-checked={provider === 'deepseek'}
            className={clsx(styles.providerOption, provider === 'deepseek' && styles.providerOptionActive)}
            onClick={() => choose('deepseek')}
          >
            {t('providerDeepSeekShort')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={provider === 'workbuddy'}
            className={clsx(styles.providerOption, provider === 'workbuddy' && styles.providerOptionActive)}
            onClick={() => choose('workbuddy')}
          >
            {t('providerWorkBuddyShort')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={provider === 'custom'}
            className={clsx(styles.providerOption, provider === 'custom' && styles.providerOptionActive)}
            onClick={() => choose('custom')}
          >
            {t('providerCustomShort')}
          </button>
        </div>
        <div className={styles.hint}>
          {hideHeader
            ? null
            : provider === 'workbuddy'
              ? t('providerWorkBuddyHint')
              : provider === 'custom'
                ? t('providerCustomHint')
                : t('providerDeepSeekHint')}
        </div>
        {!hideHeader && !apiKey ? (
          <div className={styles.hint}>{t('providerSummaryOfficialMissing')}</div>
        ) : null}
      </div>
      {provider === 'workbuddy' ? (
        <WorkBuddyField />
      ) : provider === 'custom' ? (
        <CustomProviderField />
      ) : onOpenKey ? (
        // 移动端：DeepSeek 的 Key 单独一页，这里只留跳转，别把输入框塞回本页
        <button
          type="button"
          className={clsx(styles.cell, styles.row, styles.dataMenuRow)}
          onClick={onOpenKey}
        >
          <span className={styles.label}>{t('deepseekOfficialKey')}</span>
          <span className={styles.dataMenuChevron}>
            <IconChevronRightOutline14 />
          </span>
        </button>
      ) : null}
    </>
  )
}

/**
 * 三选一的聊天方式：用单行单选，而不是并排芯片。
 * 并排芯片容易被小白理解成「三个都要填」，单行单选配上说明就清楚多了。
 */
export const ProviderChoiceRows = () => {
  const t = useTranslate()
  const provider = useSettings((state) => state.provider)
  const options: { id: ChatProvider; label: TranslationKey; desc: TranslationKey }[] = [
    { id: 'deepseek', label: 'providerDeepSeekShort', desc: 'providerChoiceDeepSeekDesc' },
    { id: 'workbuddy', label: 'providerWorkBuddyShort', desc: 'providerChoiceWorkBuddyDesc' },
    { id: 'custom', label: 'providerCustomShort', desc: 'providerChoiceCustomDesc' },
  ]
  return (
    <>
      {options.map((option) => {
        const active = provider === option.id
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            className={clsx(styles.choiceRow, active && styles.choiceRowActive)}
            onClick={() => setProvider(option.id)}
          >
            <span className={clsx(styles.choiceMark, active && styles.choiceMarkOn)} aria-hidden>
              {active ? <IconCheckOutline16 /> : null}
            </span>
            <span className={styles.choiceBody}>
              <span className={styles.choiceLabel}>{t(option.label)}</span>
              <span className={styles.choiceDesc}>{t(option.desc)}</span>
            </span>
          </button>
        )
      })}
    </>
  )
}

/** 当前通道自己的配置（不含选择器） */
export const ProviderConfig = () => {
  const provider = useSettings((state) => state.provider)
  if (provider === 'workbuddy') {
    return <WorkBuddyField />
  }
  if (provider === 'custom') {
    return <CustomProviderField />
  }
  return null
}

/** DeepSeek 官方 Key：语音 / 朗读 / 识图 / 搜索用，和聊天通道无关 */
export const ProviderKeyPanel = ({ editor }: { editor: ReturnType<typeof useApiKeyEditor> }) => (
  <ApiKeyField editor={editor} />
)

/**
 * WorkBuddy 的长说明：收进页面底部的「说明」折叠里，
 * 配置区只留必要的行，避免一进来就被大段文字糊住。
 */
/**
 * WorkBuddy 的说明：二次确认弹窗已经说清能做到什么、风险是什么，
 * 页面上只留一条风险详情，避免一屏全是字。
 */
export const WorkBuddyNotes = () => {
  const t = useTranslate()
  return (
    <div className={styles.workbuddyRiskDetail}>{t('workbuddyRiskWarning')}</div>
  )
}

/** WorkBuddy 账号：原生登录页负责 OAuth，网页只读账号、积分、签到和模型。 */
const WorkBuddyField = () => {
  const t = useTranslate()
  const available = workbuddyAvailable()
  const model = useSettings((state) => state.workbuddyModel)
  const [account, setAccount] = useState<WorkBuddyAccountInfo | null>(() => workbuddyAccount())
  const [hasToken, setHasToken] = useState(() => workbuddyHasToken())
  const [busy, setBusy] = useState(false)
  const [billing, setBilling] = useState<WorkBuddyBilling | null>(null)
  const [billingBusy, setBillingBusy] = useState(false)
  const [billingError, setBillingError] = useState('')
  const [autoCheckin, setAutoCheckin] = useState(() => workbuddyAutoCheckin())
  const [claimBusy, setClaimBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [riskDialog, setRiskDialog] = useState(false)
  /* 弹窗里的勾选：只说清「WorkBuddy 账号可能被封」，不暗示 DeepSeek 安全 */
  const [riskAccepted, setRiskAccepted] = useState(false)
  /* 登录后风险那句常驻在卡片上，这里只控制「展开详细风险」 */
  const [notesOpen, setNotesOpen] = useState(false)

  useEffect(() => {
    setNotesOpen(false)
  }, [hasToken])

  const refreshAccount = useCallback(() => {
    setAccount(workbuddyAccount())
    setHasToken(workbuddyHasToken())
    setAutoCheckin(workbuddyAutoCheckin())
  }, [])

  const refreshBilling = useCallback(async () => {
    if (!workbuddyHasToken() || !billingAvailable()) {
      setBilling(null)
      return
    }
    setBillingBusy(true)
    setBillingError('')
    /* 网络抖动很常见：先自动重试一次，还失败才让用户看到错误并手动重试 */
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        setBilling(await fetchWorkBuddyBilling())
        setBillingError('')
        break
      } catch (error) {
        if (attempt === 0) {
          await new Promise((resolve) => window.setTimeout(resolve, 1200))
          continue
        }
        setBillingError(error instanceof Error ? error.message : String(error))
      }
    }
    setBillingBusy(false)
  }, [])

  const refresh = useCallback(() => {
    refreshAccount()
    void refreshBilling()
  }, [refreshAccount, refreshBilling])

  useEffect(() => {
    refresh()
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [refresh])

  // 旧账号没有昵称：让原生补一次资料，再轮询几秒等它写回；昵称已有就不再请求。
  useEffect(() => {
    if (!available || workbuddyAccount()?.nickname?.trim()) {
      return
    }
    try {
      window.WorkBuddyAndroid?.refreshAccount?.()
    } catch {
      // 忽略
    }
    let tries = 0
    const timer = window.setInterval(() => {
      refreshAccount()
      tries += 1
      if (tries >= 4) {
        window.clearInterval(timer)
      }
    }, 1200)
    return () => window.clearInterval(timer)
  }, [available, refreshAccount])

  // 登录页在原生 Activity，WebView 不一定收到 focus；登录期间轮询。
  useEffect(() => {
    if (!busy) {
      return
    }
    const timer = window.setInterval(() => {
      if (workbuddyHasToken()) {
        refresh()
        setBusy(false)
      }
    }, 2000)
    const timeout = window.setTimeout(() => {
      refresh()
      setBusy(false)
    }, 10 * 60 * 1000)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(timeout)
    }
  }, [busy, refresh])

  // 自动签到：只在开启且今日未签时执行一次。
  useEffect(() => {
    if (!hasToken || !autoCheckin) {
      return
    }
    let cancelled = false
    void maybeAutoCheckin().then((result) => {
      if (cancelled) {
        return
      }
      if (result) {
        setNotice(t('workbuddyCheckinClaimed', { credit: result.claim.credit }))
        void refreshBilling()
      }
    })
    return () => {
      cancelled = true
    }
  }, [hasToken, autoCheckin, refreshBilling, t])

  const login = () => {
    if (!available) {
      return
    }
    setBusy(true)
    setNotice('')
    workbuddyLogin()
  }

  /** 先弹风险确认，确认后才启动原生 OAuth 登录。 */
  const startLogin = () => {
    if (!available) {
      return
    }
    setRiskAccepted(false)
    setRiskDialog(true)
  }

  const confirmLogin = () => {
    setRiskDialog(false)
    login()
  }

  const logout = () => {
    workbuddyLogout()
    setHasToken(false)
    setAccount(null)
    setBilling(null)
    setBillingError('')
    setBusy(false)
    setNotice('')
  }

  const toggleAutoCheckin = () => {
    const next = !autoCheckin
    setWorkbuddyAutoCheckin(next)
    setAutoCheckin(next)
    if (next) {
      void maybeAutoCheckin().then((result) => {
        if (result) {
          setNotice(t('workbuddyCheckinClaimed', { credit: result.claim.credit }))
          void refreshBilling()
        }
      })
    }
  }

  const claim = async () => {
    if (claimBusy) {
      return
    }
    setClaimBusy(true)
    setNotice('')
    try {
      const result = await claimWorkBuddyCheckin()
      setBilling({ credits: result.credits, checkin: result.checkin })
      setNotice(t('workbuddyCheckinClaimed', { credit: result.claim.credit }))
      if (!result.credits || !result.checkin) {
        void refreshBilling()
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setClaimBusy(false)
    }
  }

  const modelHint = workBuddyModelHint(model)
  const credits = billing?.credits
  const checkin = billing?.checkin
  const number = (value: number) => Math.round(value).toLocaleString('zh-CN')

  return (
    <div className={clsx(styles.cell, 'ds-pref-key-cell')}>
      <div className={styles.apiKey}>
        <div className={styles.label}>{t('workbuddyAccount')}</div>
        {/* 没登录：把「能给你什么 / 怎么用 / 怎么做到 / 风险」一次说清，不折叠 */}
        {!hasToken ? (
          <div className={styles.workbuddyIntroBlock}>{t('workbuddyIntroBody')}</div>
        ) : (
          <>
            {/* 登录后：风险常驻一行，需要细节再展开 */}
            <div className={styles.workbuddyRiskLine}>{t('workbuddyRiskLine')}</div>
            <button
              type="button"
              className={styles.notesToggleTop}
              aria-expanded={notesOpen}
              onClick={() => setNotesOpen((value) => !value)}
            >
              {notesOpen ? t('workbuddyNotesCollapse') : t('workbuddyNotesExpand')}
            </button>
            <div className={clsx(styles.expander, notesOpen && styles.expanderOpen)}>
              <div className={styles.expanderInner}>
                <WorkBuddyNotes />
              </div>
            </div>
          </>
        )}
        {!available ? (
          <div className={styles.error}>{t('workbuddyUnavailable')}</div>
        ) : hasToken ? (
          <div className={styles.workbuddyAccount}>
            <div className={styles.workbuddyWho}>
              <span className={styles.workbuddyName}>
                {account?.nickname?.trim() || account?.uid?.trim() || 'WorkBuddy'}
              </span>
              <span className={styles.hint}>{t('workbuddyLoggedIn')}</span>
            </div>
            <Button variant="outlined" size="m" onClick={logout}>
              {t('workbuddyLogout')}
            </Button>
          </div>
        ) : (
          <div className={styles.workbuddyAccount}>
            <div className={styles.hint}>{busy ? t('workbuddyLoginPending') : t('workbuddyNoToken')}</div>
            <Button variant="primary" size="m" disabled={busy} onClick={startLogin} className={styles.workbuddyLoginButton}>
              {busy ? t('workbuddyLoginPendingButton') : t('workbuddyLogin')}
            </Button>
          </div>
        )}

        {hasToken ? (
          <>
            <div className={styles.workbuddyBilling}>
              <span className={styles.workbuddyCredits}>
                {billingBusy && !credits
                  ? t('workbuddyBillingLoading')
                  : `${t('workbuddyCredits')} ${credits ? number(credits.total) : '--'}`}
              </span>
              {credits && credits.expiringSoon > 0 ? (
                <span className={styles.hint}>
                  {t('workbuddyExpiringSoon', { credit: number(credits.expiringSoon) })}
                </span>
              ) : null}
            </div>
            {billingError ? (
              <div className={styles.billingErrorRow}>
                <div className={styles.error}>{billingError}</div>
                <button type="button" className={styles.billingRetry} onClick={() => void refreshBilling()}>
                  {t('workbuddyBillingRetry')}
                </button>
              </div>
            ) : null}

            {checkin?.active ? (
              <div className={styles.workbuddyCheckin}>
                <div className={styles.hint}>
                  {t('workbuddyCheckinStreak', { days: checkin.streakDays })}
                  {' · '}
                  {checkin.todayCheckedIn
                    ? t('workbuddyCheckinToday', { credit: checkin.todayCredit })
                    : t('workbuddyCheckinAvailable', { credit: checkin.dailyCredit })}
                </div>
                {checkin.todayCheckedIn ? null : (
                  <Button variant="primary" size="s" disabled={claimBusy} onClick={() => void claim()}>
                    {claimBusy ? t('workbuddyCheckinClaiming') : t('workbuddyCheckinClaim')}
                  </Button>
                )}
              </div>
            ) : null}

            <div className={styles.workbuddySwitchRow}>
              <span className={styles.label}>{t('workbuddyAutoCheckin')}</span>
              <button
                type="button"
                role="switch"
                aria-checked={autoCheckin}
                className={clsx(styles.workbuddySwitch, autoCheckin && styles.workbuddySwitchOn)}
                onClick={toggleAutoCheckin}
              >
                <span className={styles.workbuddySwitchKnob} />
              </button>
            </div>
            {notice ? <div className={styles.hint}>{notice}</div> : null}

            <div className={styles.workbuddyModel}>
              <div className={styles.label}>{t('workbuddyModel')}</div>
              <Select
                className={styles.modelSelect}
                value={model}
                options={WORKBUDDY_MODELS.map((item) => ({ value: item.id, label: workBuddyModelLabel(item) }))}
                onChange={setWorkBuddyModel}
                ariaLabel={t('workbuddyModel')}
              />
              {modelHint ? <div className={styles.hint}>{modelHint}</div> : null}
            </div>
          </>
        ) : null}
      </div>
      {riskDialog ? createPortal(
        <div
          className={styles.workbuddyRiskMask}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              setRiskDialog(false)
            }
          }}
        >
          <div
            className={styles.workbuddyRiskDialog}
            role="dialog"
            aria-modal="true"
            aria-label={t('workbuddyRiskTitle')}
          >
            <div className={styles.workbuddyRiskDialogTitle}>{t('workbuddyRiskTitle')}</div>
            <div className={clsx(styles.workbuddyConfirmBlock, styles.workbuddyConfirmCan)}>
              <div className={styles.workbuddyConfirmLabel}>{t('workbuddyConfirmCanTitle')}</div>
              <div className={styles.workbuddyConfirmList}>{t('workbuddyConfirmCan')}</div>
            </div>
            <div className={clsx(styles.workbuddyConfirmBlock, styles.workbuddyConfirmCannot)}>
              <div className={styles.workbuddyConfirmLabel}>{t('workbuddyConfirmCannotTitle')}</div>
              <div className={styles.workbuddyConfirmList}>{t('workbuddyConfirmCannot')}</div>
            </div>
            <div className={clsx(styles.workbuddyConfirmBlock, styles.workbuddyConfirmRisk)}>
              <div className={styles.workbuddyConfirmLabel}>{t('workbuddyConfirmRiskTitle')}</div>
              <div className={styles.workbuddyConfirmList}>{t('workbuddyConfirmRisk')}</div>
            </div>
            <label className={styles.workbuddyRiskCheck}>
              <input
                type="checkbox"
                checked={riskAccepted}
                onChange={(event) => setRiskAccepted(event.target.checked)}
              />
              <span>{t('workbuddyRiskCheckLabel')}</span>
            </label>
            <div className={styles.workbuddyRiskDialogActions}>
              <Button variant="outlined" size="m" onClick={() => setRiskDialog(false)}>
                {t('cancel')}
              </Button>
              <Button variant="primary" size="m" disabled={!riskAccepted} onClick={confirmLogin}>
                {t('workbuddyRiskContinue')}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  )
}

/** 自定义 OpenAI 兼容供应商：Base URL / Key / 模型，Key 由原生 Keystore 保存。 */
/**
 * 本地/局域网地址（Ollama、LM Studio 等）通常不需要 API Key，也常是 http。
 * 判断规则与原生 isPrivateHost 保持一致：只认 IP 字面量 / localhost / ::1。
 */
const isLocalBaseUrl = (value: string): boolean => {
  try {
    // 先按原文判断歧义写法：前导零 / 尾点（浏览器会把它们规范化，和原生判定不一致）
    const rawHost = value.trim().replace(/^https?:\/\//i, '').split(/[/:?#]/)[0]
    if (rawHost.endsWith('.')) {
      return false
    }
    if (/^\d+(\.\d+){3}$/.test(rawHost) && rawHost.split('.').some((part) => part.length > 1 && part.startsWith('0'))) {
      return false
    }
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false
    }
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || host === '::1' || host === '[::1]' || host === '0.0.0.0') {
      return true
    }
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return false
    }
    const parts = host.split('.').map(Number)
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return false
    }
    const [a, b] = parts
    return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
  } catch {
    return false
  }
}

const CustomProviderField = () => {
  const t = useTranslate()
  const available = customAvailable()
  const [config, setConfig] = useState<CustomProviderConfig>(() => getCustomConfig())
  const [name, setName] = useState(config.name)
  const [baseUrl, setBaseUrl] = useState(config.baseUrl)
  const [model, setModel] = useState(config.model)
  const [apiKey, setApiKey] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [preset, setPreset] = useState<ProviderPreset | null>(null)
  const [showAllPresets, setShowAllPresets] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [editingKey, setEditingKey] = useState(!config.hasKey)
  const [keyConfirmDelete, setKeyConfirmDelete] = useState(false)
  /* 没配过就把说明摊开；配过之后收起来，只留一个强调色入口 */
  const [notesOpen, setNotesOpen] = useState(() => !config.hasKey)
  // 本地/局域网服务没有 Key 也算配置完成
  const configured = config.hasKey || config.local === true

  const modelMenu = useAnchoredPosition<HTMLDivElement, HTMLDivElement>(modelOpen, {
    align: 'start',
    maxHeight: 300,
    minSpace: 180,
  })
  useDismiss(modelOpen, [modelMenu.anchorRef, modelMenu.floatingRef], () => setModelOpen(false), {
    captureEscape: true,
  })

  useEffect(() => {
    if (!config.hasKey) {
      setEditingKey(true)
    }
    setNotesOpen(!config.hasKey)
  }, [config.hasKey])

  useEffect(() => {
    if (!keyConfirmDelete) {
      return
    }
    const timer = window.setTimeout(() => setKeyConfirmDelete(false), 4000)
    return () => window.clearTimeout(timer)
  }, [keyConfirmDelete])

  useEffect(() => {
    const next = getCustomConfig()
    setConfig(next)
    setName(next.name)
    setBaseUrl(next.baseUrl)
    setModel(next.model)
    setPreset(PROVIDER_PRESETS.find((item) => item.baseUrl === next.baseUrl) ?? null)
  }, [])

  const pickPreset = (item: ProviderPreset) => {
    setPreset(item)
    setName(item.label)
    setBaseUrl(item.baseUrl)
    setModel(item.model)
    setModels([])
    setStatus('')
    setError('')
    setEditingKey(true)
    setKeyConfirmDelete(false)
  }

  const commonPresets = PROVIDER_PRESETS.filter((item) => item.common)

  /** 切回手动填写：清掉预设带入的地址/模型，避免看起来还锁在某个供应商上。 */
  const useCustom = () => {
    setPreset(null)
    setName('')
    setBaseUrl('')
    setModel('')
    setModels([])
    setStatus('')
    setError('')
    setEditingKey(true)
    setKeyConfirmDelete(false)
  }

  const save = (): boolean => {
    const result = saveCustomConfig({
      name: name || preset?.label || t('customPresetCustom'),
      baseUrl,
      model,
      apiKey,
    })
    if (!result.ok) {
      setError(result.error || t('customSaveFailed'))
      return false
    }
    setError('')
    setStatus(t('customSaved'))
    /*
     * 只信「保存成功 + 这次真的填了 Key」，不要只看紧接着的读回结果：
     * 刚写完就立刻读配置偶尔会读到空的，会把 UI 吓得以为 Key 没存上，
     * 于是清掉输入框、藏起已保存的掩码行 —— 看起来就是「保存后 Key 消失了」。
     */
    const typedKey = apiKey.trim()
    const next = getCustomConfig()
    // 本地/局域网服务本来就没有 Key：不能因为它没有 Key 就当成「没保存成功」
    const local = isLocalBaseUrl(next.baseUrl || baseUrl)
    const hasKey = next.hasKey || typedKey.length > 0 || local
    setConfig({
      ...next,
      hasKey,
      keyLength: next.keyLength > 0 ? next.keyLength : typedKey.length,
    })
    if (hasKey) {
      setApiKey('')
      setEditingKey(false)
    } else {
      setError(t('customKeyMissing'))
      setEditingKey(true)
    }
    setKeyConfirmDelete(false)
    return true
  }

  const test = async () => {
    if (!baseUrl.trim()) {
      setError(t('customRequired'))
      return
    }
    if (!apiKey.trim() && !config.hasKey && !isLocalBaseUrl(baseUrl)) {
      setError(t('customNeedKeyFirst'))
      return
    }
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const list = await listCustomModels(baseUrl, apiKey)
      setModels(list)
      setStatus(list.length > 0 ? t('customModelsFound', { count: list.length }) : t('customNoModels'))
      if (!model.trim() && list.length > 0) {
        setModel(list[0])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const clear = () => {
    clearCustomConfig()
    const next = getCustomConfig()
    setConfig(next)
    setName('')
    setBaseUrl('')
    setModel('')
    setApiKey('')
    setModels([])
    setError('')
    setStatus(t('customCleared'))
    setEditingKey(true)
    setKeyConfirmDelete(false)
  }

  const removeKey = () => {
    clearCustomKey()
    const next = getCustomConfig()
    setConfig(next)
    setApiKey('')
    setModels([])
    setStatus('')
    setError('')
    setEditingKey(true)
    setKeyConfirmDelete(false)
  }

  return (
    <div className={clsx(styles.cell, 'ds-pref-key-cell')}>
      <div className={styles.apiKey}>
        <div className={styles.apiKeyHeader}>
          <div className={styles.label}>{t('providerCustom')}</div>
          {configured ? (
            <button
              type="button"
              className={styles.apiKeyHelpButton}
              aria-expanded={notesOpen}
              onClick={() => setNotesOpen((value) => !value)}
            >
              {notesOpen ? t('customNotesCollapse') : t('customNotesExpand')}
            </button>
          ) : null}
        </div>
        <div className={clsx(styles.expander, (!configured || notesOpen) && styles.expanderOpen)}>
          <div className={styles.expanderInner}>
            <div className={clsx(styles.hint, styles.workbuddyIntro)}>{t('providerCustomDesc')}</div>
            <div className={styles.featureBox}>
              <div className={styles.featureTitle}>{t('customFreeTitle')}</div>
              <div className={styles.featureList}>{t('customFreeList')}</div>
            </div>
          </div>
        </div>

        {!available ? (
          <div className={styles.error}>{t('customUnavailable')}</div>
        ) : (
          <>
            <div className={styles.customPresets}>
              {(showAllPresets ? PROVIDER_PRESETS : commonPresets.slice(0, 3)).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={clsx(
                    styles.customPreset,
                    preset?.id === item.id && styles.customPresetActive
                  )}
                  onClick={() => pickPreset(item)}
                >
                  {item.label}
                </button>
              ))}
              {showAllPresets ? (
                <button
                  type="button"
                  className={clsx(styles.customPreset, !preset && styles.customPresetActive)}
                  onClick={useCustom}
                >
                  {t('customPresetCustom')}
                </button>
              ) : null}
            </div>
            {!showAllPresets ? (
              <div className={styles.customPresetSecondRow}>
                {commonPresets.slice(3).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={clsx(
                      styles.customPreset,
                      preset?.id === item.id && styles.customPresetActive
                    )}
                    onClick={() => pickPreset(item)}
                  >
                    {item.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={clsx(styles.customPreset, !preset && styles.customPresetActive)}
                  onClick={useCustom}
                >
                  {t('customPresetCustom')}
                </button>
                <button
                  type="button"
                  className={styles.customPresetMoreLink}
                  onClick={() => setShowAllPresets(true)}
                >
                  {t('customPresetsMore')}
                </button>
              </div>
            ) : (
              <div className={styles.customPresetSecondRow}>
                <button
                  type="button"
                  className={styles.customPresetMoreLink}
                  onClick={() => setShowAllPresets(false)}
                >
                  {t('customPresetsLess')}
                </button>
              </div>
            )}
            <div className={styles.customForm}>
              <label className={styles.customField}>
                <span>{t('customBaseUrl')}</span>
                <input
                  className={styles.customInput}
                  value={baseUrl}
                  placeholder="https://api.openai.com/v1"
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="url"
                  onChange={(event) => {
                    setBaseUrl(event.target.value)
                    setModels([])
                  }}
                />
              </label>
              <div className={styles.customField}>
                <span>{t('customApiKey')}</span>
                {config.local === true && !config.hasKey ? (
                  <div className={styles.hint}>{t('customLocalNoKey')}</div>
                ) : config.hasKey && !editingKey ? (
                  <div className={clsx(styles.apiKeySaved, styles.apiKeyBox)}>
                    <span className={styles.apiKeyMask}>
                      {'•'.repeat(Math.min(Math.max(config.keyLength || 18, 18), 32))}
                    </span>
                    <div className={styles.apiKeyActions}>
                      <button
                        type="button"
                        className={styles.apiKeyDelete}
                        onClick={() => {
                          if (keyConfirmDelete) {
                            removeKey()
                          } else {
                            setKeyConfirmDelete(true)
                          }
                        }}
                      >
                        {keyConfirmDelete ? t('apiKeyDeleteConfirm') : t('apiKeyDelete')}
                      </button>
                      <IconButton
                        tone="primary"
                        icon={<IconEditOutline16 />}
                        tooltip={t('apiKeyEdit')}
                        onClick={() => {
                          setKeyConfirmDelete(false)
                          setEditingKey(true)
                          setApiKey('')
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className={clsx(styles.apiKeyInput, styles.apiKeyBox)}>
                    <input
                      type="password"
                      value={apiKey}
                      placeholder={config.hasKey ? t('customApiKeySaved') : 'sk-...'}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(event) => setApiKey(event.target.value)}
                      onBlur={() => {
                        if (config.hasKey && !apiKey.trim()) {
                          setEditingKey(false)
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing && apiKey.trim()) {
                          save()
                        }
                      }}
                    />
                    {apiKey.trim() ? (
                      <>
                        <span className={styles.divider} />
                        <button
                          type="button"
                          className={styles.confirm}
                          disabled={busy}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => save()}
                        >
                          {t('confirm')}
                        </button>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
              <label className={styles.customField}>
                <span>{t('customModel')}</span>
                <div ref={modelMenu.anchorRef} className={styles.customModelRow}>
                  <input
                    className={styles.customInput}
                    value={model}
                    placeholder={t('customModelHint')}
                    autoComplete="off"
                    spellCheck={false}
                    onClick={() => {
                      if (models.length > 0) {
                        setModelOpen(true)
                      }
                    }}
                    onChange={(event) => setModel(event.target.value)}
                  />
                  {models.length > 0 ? (
                    <button
                      type="button"
                      className={styles.customModelSelectButton}
                      aria-label={t('customSelectModel')}
                      aria-haspopup="listbox"
                      aria-expanded={modelOpen}
                      onClick={() => setModelOpen((value) => !value)}
                    >
                      {t('customSelectModel')}
                      <IconChevronDownOutline14 />
                    </button>
                  ) : null}
                </div>
              </label>
            </div>
            {modelOpen && models.length > 0
              ? createPortal(
                  <div
                    ref={modelMenu.floatingRef}
                    className={styles.customModelMenu}
                    style={modelMenu.position ?? undefined}
                    role="listbox"
                    aria-label={t('customModel')}
                  >
                    {models.map((item) => (
                      <button
                        key={item}
                        type="button"
                        role="option"
                        aria-selected={model === item}
                        className={clsx(
                          styles.customModelOption,
                          model === item && styles.customModelOptionActive
                        )}
                        onClick={() => {
                          setModel(item)
                          setModelOpen(false)
                        }}
                      >
                        <span>{item}</span>
                        {model === item ? <IconCheckOutline16 /> : null}
                      </button>
                    ))}
                  </div>,
                  document.body
                )
              : null}
            <div className={styles.customActions}>
              <Button
                variant="primary"
                size="m"
                disabled={busy}
                onClick={() => {
                  setStatus('')
                  save()
                }}
              >
                {t('customSave')}
              </Button>
              <Button variant="outlined" size="m" disabled={busy} onClick={() => void test()}>
                {busy ? t('customTesting') : t('customTest')}
              </Button>
              <button type="button" className={styles.customClearLink} disabled={busy} onClick={clear}>
                {t('customClear')}
              </button>
            </div>
            {status ? <div className={styles.hint}>{status}</div> : null}
            {error ? <div className={styles.error}>{error}</div> : null}
          </>
        )}
      </div>
    </div>
  )
}
