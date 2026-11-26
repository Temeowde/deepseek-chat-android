import * as React from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  IconCheckOutline16,
  IconChevronRightOutline14,
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconSettingsOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importHistory,
  type HistoryImportProgress,
} from '../../services/chat/backup.js'
import { useIsMobile } from '../../app/viewport.js'
import { useChatStore, type HistoryImportMode } from '../../services/chat/store.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import {
  isChineseBrowser,
  setLocale,
  setLocation,
  setProvider,
  setSafetyCheck,
  setThemePreference,
  setTtsVoice,
  setWorkBuddyModel,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { useApiKeyEditor } from './ApiKeyField.js'
import {
  ProviderConfig,
  ProviderKeyPanel,
  ProviderPanel,
} from './ProviderPanel.js'
import {
  closeSettings,
  consumeApiFocus,
  useSettingsDialog,
  type SettingsSection,
} from './settingsDialogState.js'
import {
  backupDir,
  backupLocal,
  lastBackupAt,
  listLocalBackups,
  saveZipToBackupDir,
  localBackupReady,
  localBackupSupported,
  requestLocalBackupAccess,
  restoreLocalBackup,
} from '../../services/chat/localBackup.js'
import { setLocalBackup } from '../../services/settings.js'
import styles from './Settings.module.css'

/**
 * 璁剧疆寮圭獥锛氬垎銆岄€氱敤璁剧疆銆嶏紙涓婚銆佽瑷€銆佹湕璇婚煶鑹层€佷綅缃級涓庛€屾暟鎹鐞嗐€嶏紙API Key銆佸鍏ャ€佸鍑恒€佸垹闄わ級銆? * 妗岄潰绔负灞呬腑寮圭獥銆佸乏渚у鑸紱绉诲姩绔负搴曢儴寮瑰眰銆佸鑸í鎺掑湪鍐呭涓婃柟
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  const requestId = useSettingsDialog((state) => state.requestId)
  return open ? <SettingsContent key={requestId} /> : null
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
]

const MobileSettings = window.createChatMobileSettings(React, createPortal, {
  useStore: useSettings,
  set: {
    locale: setLocale,
    theme: setThemePreference,
    voice: setTtsVoice,
    provider: setProvider,
    workbuddyModel: setWorkBuddyModel,
    safety: setSafetyCheck,
  },
})

const SettingsContent = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 打开时按调用方指定的分组选中，之后在弹窗内切换
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  // 切换分组不丢失正在输入的 API Key 与导入状态
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory
  /** 导出进行中：设置页禁止返回/关闭，否则会打断打包 */
  const [exportBusy, setExportBusy] = useState(false)
  React.useEffect(() => {
    const onBusyBack = () => showToast(t(exportBusy ? 'exportBusyLocked' : 'historyBusyLocked'))
    window.addEventListener('ds-settings-busy-back', onBusyBack)
    return () => window.removeEventListener('ds-settings-busy-back', onBusyBack)
  }, [exportBusy, t])
  /* 一级只放一行「自定义 API」入口，点进去是二级页；对话数据直接铺在一级。
   * 返回靠设置页左上角的箭头：它在关闭设置前会先调 closeOverlay，我们在这里退二级页。 */
  /* 这次是不是因为「没填 Key 就发消息」被自动带上来的，用来弹一句说明 */
  const [focusApi] = useState(() => consumeApiFocus())
  /*
   * 数据管理的二/三级页不在 React 里自己管层级：它们注册成设置壳的正式视图
   * （dataApi / dataBackup），由 mobile-settings 的 page 栈负责转场与返回栈，
   * 这样每一级都与「设置→数据管理」同一条动画代码路径。
   */
  const initialDataView = (() => {
    if (!focusApi) {
      return undefined
    }
    const state = useSettings.getState()
    return state.provider === 'deepseek' && !state.apiKey ? 'dataApi' : undefined
  })()

  /* 自动跳到 API Key 页时提示一句，免得用户以为自己误触 */
  useEffect(() => {
    if (focusApi && initialDataView) {
      showToast(t('apiKeyFocusToast'))
    }
    // 只在这次打开设置时提示一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (isMobile) {
    return <>
      <MobileSettings initial={section} busy={historyBusy || exportBusy || apiKeyEditor.form.verifying} close={closeSettings}
        closeOverlay={() => {
          if (historyImport.file) { historyImport.cancel(); return true }
          if (historyDelete.opened) { historyDelete.cancel(); return true }
          return false
        }}
        panel={
          <MobileDataSettings
            historyImport={historyImport}
            historyDelete={historyDelete}
            disabled={historyBusy || exportBusy}
            onExportBusyChange={setExportBusy}
          />
        }
        initialDataView={initialDataView}
        dataApiPanel={
          <MobileDataApiPanel editor={apiKeyEditor} />
        }
        dataBackupPanel={
          <MobileDataBackupPanel />
        }
        locationPanel={<LocationSetting />}
      />
      {historyImport.file && <ImportConfirm historyImport={historyImport} />}
      {historyDelete.opened && <DeleteAllConfirm historyDelete={historyDelete} />}
    </>
  }
  return (
    <>
      <Modal
        title={t('settings')}
        closable
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        onClose={() => {
          if (!historyDelete.busy) {
            closeSettings()
          }
        }}
      >
        <div role="tablist" className={styles.navigation}>
          {sections.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={section === item.value}
              className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
              onClick={() => setSection(item.value)}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className={styles.content}>
          {section === 'general' ? (
            <>
              <ThemeSetting />
              <LocaleSetting />
              <TtsVoiceSetting />
              <SafetySetting />
              <LocationSetting />
            </>
          ) : (
            <>
              <ProviderPanel editor={apiKeyEditor} />
              <ImportHistory historyImport={historyImport} disabled={historyBusy} />
              <ExportHistory disabled={historyBusy} />
              <LocalBackupSetting />
              <SettingCell
                label={t('deleteAllSessions')}
                status={null}
                action={
                  <Button
                    variant="dangerOutlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={historyDelete.open}
                  >
                    {t('delete')}
                  </Button>
                }
              />
            </>
          )}
        </div>
      </Modal>
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

/** 鍒犻櫎纭淇濈暀鍦ㄨ缃箣涓婏紱澶辫触鍙噸璇曪紝鎴愬姛鍙叧闂‘璁ゅ脊绐椼€?*/
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  return (
    <SettingCell
      label={t('settingsLocation')}
      status={null}
      className={styles.locationCell}
      action={
        <div className={styles.locationSelectors}>
          {isChineseBrowser() ? (
            <>
              <Select
                ariaLabel={t('settingsLocationProvince')}
                className={styles.provinceSelect}
                value={province?.code ?? ''}
                placeholder={t('settingsLocationProvince')}
                options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                onChange={(value) => {
                  if (value !== province?.code) {
                    setLocation({ region: 'CN', province: value })
                  }
                }}
              />
              <Select
                ariaLabel={t('settingsLocationCity')}
                className={styles.citySelect}
                value={province ? (location?.city ?? '') : ''}
                disabled={!province?.cities.length}
                placeholder={t('settingsLocationCity')}
                options={
                  province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
                }
                onChange={(value) => {
                  if (province) {
                    setLocation({ region: 'CN', province: province.code, city: value })
                  }
                }}
              />
            </>
          ) : (
            <Select
              ariaLabel={t('settingsLocationRegion')}
              className={styles.regionSelect}
              value={location?.region ?? ''}
              placeholder={t('settingsLocationRegion')}
              options={regionCodes
                .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))}
              onChange={(value) => setLocation({ region: value })}
            />
          )}
        </div>
      }
    />
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

/** 鏈楄闊宠壊锛歴tella锛堟捣鏄燂紝濂冲０锛? tide锛堟殫娼紝鐢峰０锛?*/
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'mira', label: t('settingsTtsVoiceMira') },
            { value: 'echo', label: t('settingsTtsVoiceEcho') },
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

const SafetySetting = () => {
  const t = useTranslate()
  const safetyCheck = useSettings((state) => state.safetyCheck)
  return (
    <SettingCell
      label={t('settingsSafetyCheck')}
      description={t('settingsSafetyCheckDescription')}
      status={null}
      action={
        <Button
          variant={safetyCheck ? 'primary' : 'outlined'}
          size="m"
          className={styles.cellButton}
          role="switch"
          aria-checked={safetyCheck}
          onClick={() => setSafetyCheck(!safetyCheck)}
        >
          {t(safetyCheck ? 'settingsSafetyCheckEnabled' : 'settingsSafetyCheckDisabled')}
        </Button>
      }
    />
  )
}

/** 閫夋嫨鍚堝苟鎴栦粠澶囦唤鎭㈠锛屽彔鍦ㄦ暟鎹鐞嗛〉涓娿€?*/
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  const group = useId()
  const [mode, setMode] = useState<HistoryImportMode>('merge')
  const options = [
    { value: 'merge', label: 'historyMergeOption', detail: 'historyMergeDescription' },
    { value: 'replace', label: 'historyReplaceOption', detail: 'historyReplaceDescription' },
  ] as const
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button
            variant={mode === 'merge' ? 'primary' : 'dangerOutlined'} size="m"
            onClick={() => void historyImport.confirm(mode)}
          >
            {t(mode === 'merge' ? 'historyImportConfirm' : 'historyReplaceConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importOptions} role="radiogroup" aria-label={t('historyImportConfirmTitle')}>
        {options.map(({ value, label, detail }) => (
          <label key={value} className={styles.importOption}>
            <input
              type="radio" name={group} value={value} checked={mode === value}
              aria-labelledby={`${group}-${value}`} aria-describedby={`${group}-${value}-detail`}
              onChange={() => setMode(value)}
            />
            <span>
              <strong id={`${group}-${value}`}>{t(label)}</strong>
              <span id={`${group}-${value}-detail`}>{t(detail)}</span>
            </span>
          </label>
        ))}
      </div>
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 涓婚椤癸細鏍囬涓嬫柟娴呰壊 / 娣辫壊 / 璺熼殢绯荤粺涓変釜閫夊潡銆? * 涓庝笅鏂硅瑷€閫夐」杩炵画鎺掑垪銆? */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 涓哄け璐ュ師鍥犵殑鏂囨 key锛屽睍绀烘椂鎸夊綋鍓嶈瑷€缈昏瘧鍚庡～鍏?`message` 鍙傛暟銆?*/
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 瀵煎嚭澶辫触闄勫甫鍘熷洜锛氶鏈熺殑閿欒鐢ㄥ搴旀枃妗堜綔鍘熷洜锛屽叾浠栭敊璇敤閿欒淇℃伅銆?*/
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

/** 行内动作行：跟「个性化」一样的一行 + 右侧文字 + 箭头，不用外面套边框按钮 */
const DataRow = ({
  label,
  value,
  onClick,
  disabled,
  danger,
  description,
}: {
  label: string
  value?: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  description?: string
}) => {
  return (
    <div className={styles.dataRowBlock}>
      <button
        type="button"
        className={clsx(styles.dataRow, danger && styles.dataRowDanger)}
        onClick={onClick}
        disabled={disabled}
      >
        <span className={styles.dataRowLabel}>{label}</span>
        {value ? <span className={styles.dataRowValue}>{value}</span> : null}
        <span className={styles.dataRowChevron} aria-hidden>
          <IconChevronRightOutline14 />
        </span>
      </button>
      {description ? <div className={styles.dataRowNote}>{description}</div> : null}
    </div>
  )
}

/** 行内开关行：右侧是「个性化」同款开关 */
const DataToggleRow = ({
  label,
  checked,
  onChange,
  disabled,
  description,
}: {
  label: string
  checked: boolean
  onChange: () => void
  disabled?: boolean
  description?: string
}) => (
  <div className={styles.dataRowBlock}>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={styles.dataRow}
      onClick={onChange}
      disabled={disabled}
    >
      <span className={styles.dataRowLabel}>{label}</span>
      <span className={styles.dataSwitch} aria-hidden />
    </button>
    {description ? <div className={styles.dataRowNote}>{description}</div> : null}
  </div>
)

const SettingCell = ({
  label,
  description,
  status,
  action,
  className,
}: {
  label: string
  description?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div role={status ? 'status' : undefined} className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 閫夋枃浠跺悗淇濈暀纭鐘舵€併€傜‘璁ゅ悗寮€濮嬫牎楠屽拰瀵煎叆銆?*/
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<HistoryImportProgress | null>(null)
  const [status, setStatus] = useState<Status>(null)
  const [errorText, setErrorText] = useState('')
  const importing = useRef(false)

  const confirm = async (mode: HistoryImportMode) => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setFile(null)
    setProgress({ stage: 'checking' })
    setStatus(null)
    setErrorText('')
    try {
      const { added, updated } = await importHistory(file, mode, setProgress)
      if (mode === 'replace') {
        setStatus({ key: added === 1 ? 'historyImportedOne' : 'historyImported', params: { count: added } })
      } else {
        setStatus({ key: added || updated ? 'historyMerged' : 'historyAlreadyImported', params: { added, updated } })
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
      if (error instanceof BackupError) {
        setStatus(errorStatus('historyImportError', error))
      } else {
        setStatus({ key: 'historyImportFailed', error: true })
      }
    } finally {
      importing.current = false
      setProgress(null)
    }
  }

  return { file, busy: progress !== null, progress, status, errorText, select: setFile, cancel: () => setFile(null), confirm }
}

/** 鎵撳紑绯荤粺鏂囦欢閫夋嫨鍣ㄥ苟鍑嗗瀵煎叆褰掓。銆?*/
const ImportHistory = ({
  historyImport,
  disabled,
  description,
  row,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
  description?: string
  row?: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)
  const { progress } = historyImport
  const status: Status = progress?.stage === 'reading'
    ? { key: 'historyImportReading', params: { percent: progress.percent } }
    : progress
      ? { key: progress.stage === 'checking' ? 'historyImportChecking' : 'historyImportSaving' }
      : historyImport.status

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept=".zip,application/zip,application/x-zip-compressed"
      hidden
      onChange={(event) => {
        const file = event.target.files?.[0]
        event.target.value = ''
        if (file) {
          historyImport.select(file)
        }
      }}
    />
  )

  if (row) {
    const busyImport = historyImport.busy
    const value = busyImport
      ? progress?.stage === 'reading'
        ? `${progress.percent}%`
        : t('historyImportSaving').replace('…', '')
      : t('upload')
    return (
      <>
        <DataRow
          label={t('historyImport')}
          value={value}
          disabled={disabled || busyImport}
          onClick={() => inputRef.current?.click()}
          description={historyImport.errorText || undefined}
        />
        {input}
      </>
    )
  }

  return (
    <SettingCell
      label={t('historyImport')}
      description={description}
      status={status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          {input}
        </>
      }
    />
  )
}

/** 灏嗗叏閮ㄤ細璇濆強鍥剧墖瀵煎嚭涓?ZIP 鏂囦欢骞朵笅杞?*/
/**
 * 鏈湴淇濈暀寮€鍏炽€? *
 * 默认关闭：Android 11+ 写公共目录需要「所有文件访问权限」，
 * 涓婃潵灏卞脊杩欎釜鏉冮檺瀵规櫘閫氱敤鎴峰緢鍚撲汉锛屾墍浠ュ彧鍦ㄧ敤鎴蜂富鍔ㄦ墦寮€寮€鍏虫椂鎵嶇敵璇枫€? */
/** 上次备份时间（相对时间），没有就显示占位符 */
const lastBackupLabel = (): string => {
  const at = lastBackupAt()
  if (!at) {
    return '—'
  }
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000))
  if (minutes < 1) {
    return '刚刚'
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`
  }
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} 小时前` : `${Math.round(hours / 24)} 天前`
}

/** 备份文件名 → 类型 + 时间；解析不出来就用文件修改时间兜底。 */
const parseBackupEntry = (
  entry: { name: string; modified: number },
): { kind: 'full' | 'incremental' | 'export' | 'other'; at: number } => {
  const stamp = (y: string, mo: string, d: string, h: string, mi: string, se: string) => {
    const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se))
    return Number.isNaN(date.getTime()) ? entry.modified : date.getTime()
  }
  const inc = /^deepseek_inc-(?:.+?-)?(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.zip$/i.exec(entry.name)
  if (inc) {
    return { kind: 'incremental', at: stamp(inc[1], inc[2], inc[3], inc[4], inc[5], inc[6]) }
  }
  const full = /^dschat-auto-(?:.+?-)?(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.zip$/i.exec(entry.name)
  if (full) {
    return { kind: 'full', at: stamp(full[1], full[2], full[3], full[4], full[5], full[6]) }
  }
  const exported = /^deepseek_data-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.zip$/i.exec(entry.name)
  if (exported) {
    return { kind: 'export', at: stamp(exported[1], exported[2], exported[3], exported[4], exported[5], exported[6]) }
  }
  return { kind: 'other', at: entry.modified || Date.now() }
}

const formatBackupTime = (at: number, t: ReturnType<typeof useTranslate>): string => {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  const clock = pad(date.getHours()) + ':' + pad(date.getMinutes())
  const today = new Date()
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(date, today)) {
    return t('localBackupToday') + ' ' + clock
  }
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (sameDay(date, yesterday)) {
    return t('localBackupYesterday') + ' ' + clock
  }
  return date.getFullYear() === today.getFullYear()
    ? `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`
    : `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${clock}`
}

const formatBackupSize = (size: number): string => {
  if (size >= 1024 * 1024) {
    return (size / 1024 / 1024).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1) + ' MB'
  }
  return Math.max(1, Math.round(size / 1024)) + ' KB'
}

const LocalBackupSetting = ({ row }: { row?: boolean } = {}) => {
  const t = useTranslate()
  const enabled = useSettings((state) => state.localBackup)
  const [ready, setReady] = useState(() => localBackupReady())
  const [backups, setBackups] = useState(() => listLocalBackups())
  const [busy, setBusy] = useState(false)
  /** 备份记录默认只列最近 5 份，太多会刷屏 */
  const [showAllBackups, setShowAllBackups] = useState(false)
  /** 备份/恢复的实时进度（0-100）；点下去后一直有反馈，不再"卡住变灰" */
  const [progress, setProgress] = useState<{ label: string; percent: number | 'indeterminate' } | null>(null)
  /** 扫描本机备份中；进度条 effect 要用，所以提前声明 */
  const [scanning, setScanning] = useState(false)
  /** 点「扫描本机备份」先确认，避免误触直接跳系统授权页 */
  const [scanConfirmOpen, setScanConfirmOpen] = useState(false)
  /** 点备份记录先弹确认，避免手抖误触直接合并导入 */
  const [pendingRestore, setPendingRestore] = useState<{
    name: string
    label: string
    size: string
    chain?: string
  } | null>(null)
  const supported = localBackupSupported()

  React.useEffect(() => {
    if (!supported) {
      return
    }
    const timer = window.setInterval(() => {
      const next = localBackupReady()
      setReady(next)
      if (next) {
        setBackups(listLocalBackups())
      }
    }, 1500)
    return () => window.clearInterval(timer)
  }, [supported])

  React.useEffect(() => {
    if (enabled && !ready && supported) {
      requestLocalBackupAccess()
    }
  }, [enabled, ready, supported])

  /*
   * 备份/恢复都在 JS 侧跑长任务，靠 window 上的进度钩子回报：
   * __backupProgress（localBackup 导出阶段）/ __restoreProgress（恢复导入阶段）。
   * 这里统一轮询成一条进度条，用户点下去立刻能看到百分比。
   */
  React.useEffect(() => {
    if (scanning) {
      setProgress({ label: t('backupScanProgress'), percent: 'indeterminate' })
      return undefined
    }
    if (!busy) {
      setProgress(null)
      return undefined
    }
    const read = () => {
      const target = window as unknown as {
        __backupProgress?: { percent?: number } | null
        __restoreProgress?: { stage?: string; percent?: number } | null
      }
      const restore = target.__restoreProgress
      if (restore) {
        const percent = restore.stage === 'saving' ? 100 : Math.round(Number(restore.percent ?? 0))
        setProgress({ label: t('restoreProgress'), percent: Math.max(2, percent) })
        return
      }
      const backup = target.__backupProgress
      if (backup) {
        setProgress({ label: t('backupProgress'), percent: Math.max(1, Math.round(Number(backup.percent ?? 0))) })
      }
    }
    read()
    const timer = window.setInterval(read, 350)
    return () => window.clearInterval(timer)
  }, [busy, scanning, t])

  const resetProgressHooks = () => {
    const target = window as unknown as { __backupProgress?: unknown; __restoreProgress?: unknown }
    target.__backupProgress = null
    target.__restoreProgress = null
  }

  /** 鎵弿鏈満澶囦唤锛氭病鏈夋潈闄愬厛鐢宠锛岀敵璇烽€氳繃鍚庡垪鍑烘枃浠躲€傞噸瑁呭悗鐢ㄥ畠涓€姝ユ壘鍥炪€?*/
  /**
   * 扫描本机备份。
   *
   * 以前是"申请权限 → 轮询 20 秒"，但用户会被跳到系统设置页，WebView 进入后台后
   * 定时器被冻结，等回来时 20 秒早就过了 → 按钮永远卡在 "…"。
   * 现在改成：一有权限就立刻列目录，回到前台也会再检查一次，且不依赖计时上限。
   */
  React.useEffect(() => {
    if (!scanning) {
      return
    }
    const finish = () => {
      if (!localBackupReady()) {
        return
      }
      const found = listLocalBackups()
      setScanning(false)
      setReady(true)
      setBackups(found)
      showToast(found.length ? t('backupScanFound', { count: found.length }) : t('backupScanEmpty'))
    }
    const timer = window.setInterval(finish, 800)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        finish()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [scanning])

  const scan = () => {
    if (!supported) {
      return
    }
    if (localBackupReady()) {
      /* 已经有权限：立刻列目录，但也要给结果反馈，不能点完像没反应 */
      const found = listLocalBackups()
      setReady(true)
      setBackups(found)
      setScanning(false)
      showToast(found.length ? t('backupScanFound', { count: found.length }) : t('backupScanEmpty'))
      return
    }
    setScanning(true)
    requestLocalBackupAccess()
  }

  const toggle = () => {
    if (!supported) {
      return
    }
    if (enabled) {
      setLocalBackup(false)
      return
    }
    setLocalBackup(true)
    requestLocalBackupAccess()
    window.setTimeout(() => {
      if (!localBackupReady()) {
        setLocalBackup(false)
        showToast(t('localBackupDenied'))
      }
    }, 1200)
  }

  const backupNow = async () => {
    if (busy) {
      return
    }
    resetProgressHooks()
    setBusy(true)
    try {
      const name = await backupLocal()
      if (name) {
        setBackups(listLocalBackups())
        showToast(`${t('localBackupDone')}: ${name}`)
      } else {
        showToast(t('localBackupFailed'))
      }
    } catch {
      showToast(t('localBackupFailed'))
    } finally {
      setBusy(false)
      resetProgressHooks()
    }
  }

  const restore = async (name: string) => {
    if (busy) {
      return
    }
    resetProgressHooks()
    setBusy(true)
    try {
      await restoreLocalBackup(name)
      showToast(t('localBackupRestored'))
    } catch {
      showToast(t('localBackupFailed'))
    } finally {
      setBusy(false)
      resetProgressHooks()
    }
  }

  if (row) {
    return (
      <>
        <DataToggleRow
          label={t('localBackupTitle')}
          checked={enabled}
          onChange={toggle}
          disabled={!supported}
          description={t('mobileDataBackupDesc2')}
        />
        {progress ? (
          <div className={styles.progressBlock} role="status" aria-live="polite">
            <div className={styles.progressLabel}>
              <span>{progress.label}</span>
              <span>{progress.percent === 'indeterminate' ? '' : `${progress.percent}%`}</span>
            </div>
            <div className={styles.progressTrack}>
              <div
                className={clsx(styles.progressFill, progress.percent === 'indeterminate' && styles.progressIndeterminate)}
                style={progress.percent === 'indeterminate' ? undefined : { width: `${progress.percent}%` }}
              />
            </div>
          </div>
        ) : null}
        {ready ? (
          <DataRow
            label={t('localBackupNow')}
            value={busy ? '…' : lastBackupLabel()}
            disabled={busy}
            onClick={() => void backupNow()}
          />
        ) : null}
        <DataRow
          label={t('localBackupScan')}
          value={scanning ? '…' : t('localBackupScanAction')}
          disabled={!supported || scanning}
          onClick={() => setScanConfirmOpen(true)}
          description={t('mobileDataScanDesc')}
        />
        {scanConfirmOpen ? (
          <Modal
            title={t('backupScanConfirmTitle')}
            onClose={() => setScanConfirmOpen(false)}
            footer={
              <>
                <Button variant="outlined" size="m" autoFocus onClick={() => setScanConfirmOpen(false)}>
                  {t('cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="m"
                  onClick={() => {
                    setScanConfirmOpen(false)
                    scan()
                  }}
                >
                  {t('backupScanStart')}
                </Button>
              </>
            }
          >
            <p>{t('backupScanConfirmBody')}</p>
          </Modal>
        ) : null}
        {ready && backups.length > 0 ? (
          <>
            {(backups.slice(0, 5)).map((entry) => {
              const parsed = parseBackupEntry(entry)
              const kindLabel =
                parsed.kind === 'full'
                  ? t('localBackupKindFull')
                  : parsed.kind === 'incremental'
                    ? t('localBackupKindIncremental')
                    : parsed.kind === 'export'
                      ? t('localBackupKindExport')
                      : t('localBackupKindOther')
              return (
                <DataRow
                  key={entry.name}
                  label={`${formatBackupTime(parsed.at, t)} · ${kindLabel}`}
                  value={formatBackupSize(entry.size)}
                  disabled={busy}
                  onClick={() => {
                    /*
                     * 增量包只包含「上次备份之后变化的会话」，单独恢复是残缺的。
                     * 真正恢复时会自动先恢复它对应的完整基线，再按时间叠加增量。
                     * 这里先把这条链算出来告诉用户，免得以为增量包只有几 KB/几百 KB 就恢复不了全部。
                     */
                    let chain: string | undefined
                    if (parsed.kind === 'incremental') {
                      const all = listLocalBackups()
                      const baseline = all
                        .filter((item) => item.name.startsWith('dschat-auto-') && item.modified <= entry.modified)
                        .sort((a, b) => b.modified - a.modified)[0]
                      if (baseline) {
                        const count = all.filter(
                          (item) => item.name.startsWith('deepseek_inc-') && item.modified > baseline.modified && item.modified <= entry.modified,
                        ).length
                        chain = t('localBackupChainHint', {
                          base: formatBackupTime(parseBackupEntry(baseline).at, t),
                          count,
                        })
                      }
                    }
                    setPendingRestore({
                      name: entry.name,
                      label: `${formatBackupTime(parsed.at, t)} · ${kindLabel}`,
                      size: formatBackupSize(entry.size),
                      chain,
                    })
                  }}
                />
              )
            })}
            {backups.length > 5 ? (
              <div className={clsx(styles.expander, showAllBackups && styles.expanderOpen)}>
                <div className={styles.expanderInner}>
                  {(backups.slice(5)).map((entry) => {
              const parsed = parseBackupEntry(entry)
              const kindLabel =
                parsed.kind === 'full'
                  ? t('localBackupKindFull')
                  : parsed.kind === 'incremental'
                    ? t('localBackupKindIncremental')
                    : parsed.kind === 'export'
                      ? t('localBackupKindExport')
                      : t('localBackupKindOther')
              return (
                <DataRow
                  key={entry.name}
                  label={`${formatBackupTime(parsed.at, t)} · ${kindLabel}`}
                  value={formatBackupSize(entry.size)}
                  disabled={busy}
                  onClick={() => {
                    /*
                     * 增量包只包含「上次备份之后变化的会话」，单独恢复是残缺的。
                     * 真正恢复时会自动先恢复它对应的完整基线，再按时间叠加增量。
                     * 这里先把这条链算出来告诉用户，免得以为增量包只有几 KB/几百 KB 就恢复不了全部。
                     */
                    let chain: string | undefined
                    if (parsed.kind === 'incremental') {
                      const all = listLocalBackups()
                      const baseline = all
                        .filter((item) => item.name.startsWith('dschat-auto-') && item.modified <= entry.modified)
                        .sort((a, b) => b.modified - a.modified)[0]
                      if (baseline) {
                        const count = all.filter(
                          (item) => item.name.startsWith('deepseek_inc-') && item.modified > baseline.modified && item.modified <= entry.modified,
                        ).length
                        chain = t('localBackupChainHint', {
                          base: formatBackupTime(parseBackupEntry(baseline).at, t),
                          count,
                        })
                      }
                    }
                    setPendingRestore({
                      name: entry.name,
                      label: `${formatBackupTime(parsed.at, t)} · ${kindLabel}`,
                      size: formatBackupSize(entry.size),
                      chain,
                    })
                  }}
                />
              )
                  })}
                </div>
              </div>
            ) : null}            {backups.length > 5 ? (
              <DataRow
                label={showAllBackups ? t('localBackupCollapse') : t('localBackupShowAll', { count: backups.length })}
                onClick={() => setShowAllBackups((value) => !value)}
              />
            ) : null}
          </>
        ) : null}
        <p className={styles.backupRetentionNote}>{t('localBackupRetentionHint')}</p>
        {pendingRestore ? (
          <Modal
            title={t('localBackupRestoreTitle')}
            onClose={() => setPendingRestore(null)}
            footer={
              <>
                <Button variant="outlined" size="m" autoFocus onClick={() => setPendingRestore(null)}>
                  {t('cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="m"
                  onClick={() => {
                    const target = pendingRestore.name
                    setPendingRestore(null)
                    void restore(target)
                  }}
                >
                  {t('localBackupRestoreConfirm')}
                </Button>
              </>
            }
          >
            <p>{t('localBackupRestoreBody', { name: pendingRestore.label, size: pendingRestore.size })}</p>
            {pendingRestore.chain ? <p className={styles.backupRetentionNote}>{pendingRestore.chain}</p> : null}
          </Modal>
        ) : null}
      </>
    )
  }

  return (
    <>
      <SettingCell
        label={t('localBackupScan')}
        description={t('mobileDataScanDesc')}
        status={null}
        action={
          <Button variant="outlined" size="m" onClick={scan} disabled={!supported || scanning}>
            {scanning ? '…' : t('localBackupScanAction')}
          </Button>
        }
      />
      <SettingCell
        label={t('localBackupTitle')}
        description={t('mobileDataBackupDesc2')}
        status={null}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant={enabled ? 'primary' : 'outlined'} size="m" onClick={toggle} disabled={!supported}>
              {enabled ? t('localBackupOn') : t('localBackupOff')}
            </Button>
            {ready ? (
              <Button variant="outlined" size="m" onClick={backupNow} disabled={busy}>
                {t('localBackupNow')}
              </Button>
            ) : null}
          </div>
        }
      />
      {enabled && ready ? (
        <>
          <SettingCell
            label={`${t('localBackupRestore')} ${backupDir()}`}
            status={
              backups.length
                ? { key: 'localBackupCount', params: { count: backups.length } }
                : { key: 'localBackupEmpty' }
            }
            action={null}
          />
          {backups.slice(0, 5).map((entry) => (
            <SettingCell
              key={entry.name}
              label={entry.name}
              status={{ key: 'localBackupSize' as TranslationKey, params: { size: `${Math.round(entry.size / 1024)}` } }}
              action={
                <Button variant="outlined" size="m" onClick={() => restore(entry.name)} disabled={busy}>
                  {t('confirm')}
                </Button>
              }
            />
          ))}
        </>
      ) : null}
    </>
  )
}

const ExportHistory = ({
  disabled,
  description,
  row,
  onBusyChange,
}: {
  disabled: boolean
  description?: string
  row?: boolean
  /** 导出期间通知外层锁住返回/退出，避免半路被打断 */
  onBusyChange?: (busy: boolean) => void
}) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [percent, setPercent] = useState(0)
  const [done, setDone] = useState(false)
  const [errorText, setErrorText] = useState('')
  /** 大包改写到 /sdcard/DS-Chat 时记下完整路径，导出完成后展示给用户 */
  const [savedPath, setSavedPath] = useState('')
  /** 点导出先确认，避免误触直接开始长时间导出 */
  const [confirmOpen, setConfirmOpen] = useState(false)

  const onExport = async () => {
    setSavedPath('')
    setBusy(true)
    onBusyChange?.(true)
    setStatus(null)
    setDone(false)
    setErrorText('')
    setPercent(0)
    try {
      const report = await exportHistory((value) => setPercent(value))
      const { name, blob } = report
      /*
       * 「导出成功」必须按真实内容判定：
       * 只要还有会话没导出来、或者图片没补全，就不能显示"已导出"，否则用户以为备份完整，
       * 删了本地再导入才发现少对话（真实反馈过的数据丢失）。
       */
      const partial =
        report.skipped > 0 || report.skippedImages > 0 || report.emptyResponses > 0 || report.fetchAborted || report.shells > 0
      if (partial) {
        /*
         * 之前这段文案把"缺正文/空壳/图片缺原件/原因"全堆在一起，又长又难懂。
         * 这里压成两句：第一句结果，第二句下一步（只在需要用户操作时才出现）。
         */
        const pieces: string[] = []
        if (report.skipped > 0) {
          pieces.push(`${report.skipped} 个会话缺正文` + (report.shells > 0 ? '（已保留为空对话）' : ''))
        }
        if (report.skippedImages > 0) {
          pieces.push(`${report.skippedImages} 张图片缺原件`)
        }
        const needsLogin = /登录|未授权|失效/i.test(report.fetchError || '')
        setErrorText(
          `导出完成：${report.exported}/${report.total} 个会话` +
            (pieces.length ? `；${pieces.join('，')}` : '') +
            (needsLogin ? '。官方登录可能失效，重新登录后再导出。' : '。')
        )
      }
      /*
       * 大包不能走 MediaStore 那条一次性 Base64 通道：
       * 100MB+ 的 ZIP 转成 dataURL 再转 Base64，峰值会到 6~9 倍体积，WebView 直接被杀。
       * 所以超过 8MB 时改为分块写进 /sdcard/DS-Chat/（有「所有文件访问权限」时），
       * 再把完整路径提示给用户；小包保持原来的下载行为。
       */
      const chunkBridge = window.BackupAndroid
      const chunkReady = !!(chunkBridge?.hasAccess?.() && typeof chunkBridge.beginBackupWrite === 'function')
      if (!chunkReady && blob.size > 48 * 1024 * 1024) {
        /*
         * 没有分块桥（旧版 App / 没「所有文件访问权限」）时只能一次性转 Base64：
         * 48MB 以上的包峰值会到 6~9 倍体积，WebView 会直接被系统杀掉（连错误都看不到）。
         * 这里提前拒绝并说明办法，而不是让用户点下去崩掉。
         */
        throw new Error(
          `导出包 ${(blob.size / 1024 / 1024).toFixed(0)}MB，超过当前通道能安全处理的大小` +
            '（需要「所有文件访问权限」才能分块写）。请到 设置 → 数据管理 → 备份 里给本机备份打开权限后重试。'
        )
      }
      if (blob.size > 8 * 1024 * 1024 && chunkReady) {
        const savedPath = await saveZipToBackupDir(name, blob)
        setSavedPath(savedPath)
      } else if (window.DeepSeekAndroid) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => {
            const result = reader.result
            if (typeof result === 'string') {
              resolve(result.slice(result.indexOf(',') + 1))
            } else {
              reject(new Error('Unable to encode history'))
            }
          }
          reader.onerror = () => reject(reader.error ?? new Error('Unable to read history'))
          reader.readAsDataURL(blob)
        })
        window.DeepSeekAndroid.exportFile(name, base64)
      } else {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = name
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      }
      setPercent(100)
      // 部分成功也算「导出完成」：缺了什么写在下面说明里，别让按钮看起来没点过
      setDone(true)
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      onBusyChange?.(false)
    }
  }

  if (row) {
    const value = busy
      ? `${percent}%`
      : done
        ? t('historyExportDone')
        : t('exportAllDownload')
    return (
      <>
        <DataRow
          label={t('exportAllLabel')}
          value={value}
          disabled={disabled || busy || empty}
          onClick={() => setConfirmOpen(true)}
          description={savedPath ? `已保存到 ${savedPath}` : errorText || undefined}
        />
        {confirmOpen ? (
          <Modal
            title={t('exportConfirmTitle')}
            onClose={() => setConfirmOpen(false)}
            footer={
              <>
                <Button variant="outlined" size="m" autoFocus onClick={() => setConfirmOpen(false)}>
                  {t('cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="m"
                  onClick={() => {
                    setConfirmOpen(false)
                    void onExport()
                  }}
                >
                  {t('exportConfirmStart')}
                </Button>
              </>
            }
          >
            <p>{t('exportConfirmBody')}</p>
          </Modal>
        ) : null}
        {savedPath && window.BackupAndroid?.openFilesApp ? (
          <DataRow
            label={t('exportOpenFilesApp')}
            value={t('exportOpen')}
            onClick={() => {
              /*
               * 不同 ROM 的文件管理器支持差别很大：有的能吃目录 URI，有的只认自己的入口。
               * 原生层会逐个候选尝试；全部失败时把路径复制到剪贴板，用户至少能自己去文件管理里粘贴。
               */
              const result = window.BackupAndroid?.openFilesApp?.()
              if (typeof result === 'string' && result.startsWith('fail:')) {
                const copied = savedPath ? window.BackupAndroid?.copyText?.(savedPath) : false
                showToast(copied ? t('exportOpenFailedCopied', { path: savedPath }) : t('exportOpenFailed'))
              }
            }}
          />
        ) : null}
      </>
    )
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={description}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}

/** 瀵硅瘽鏁版嵁锛氫富鑿滃崟鍙暀涓や釜浜岀骇鍏ュ彛锛屽叿浣撳姛鑳芥敹杩涘瓙椤点€?*/
/*
 * 移动端「数据管理」：
 * - 一级：一行「自定义 API」入口（二级页）+ 直接铺开的「对话数据」；
 * - 二级：聊天方式（三选一）、当前通道配置、DeepSeek 官方 Key、长说明。
 * 版式照「个性化」：分组标题 + 白卡里的若干行，长文字收进底部「说明」折叠。
 * 不加自造返回键，靠设置页左上角的箭头退二级页（closeOverlay 里处理）。
 */

const API_CHOICES: {
  id: 'deepseek' | 'workbuddy' | 'custom'
  label: TranslationKey
  hint?: TranslationKey
}[] = [
  { id: 'deepseek', label: 'providerDeepSeekShort', hint: 'apiProviderHintDeepSeek' },
  { id: 'workbuddy', label: 'providerWorkBuddyShort', hint: 'apiProviderHintWorkBuddy' },
  { id: 'custom', label: 'providerCustomShort' },
]

/** B：行内单选，右侧蓝勾，无说明 */
const ApiChoiceRows = ({ onPicked }: { onPicked?: () => void }) => {
  const t = useTranslate()
  const provider = useSettings((state) => state.provider)
  return (
    <>
      {API_CHOICES.map((choice) => {
        const active = provider === choice.id
        return (
          <button
            key={choice.id}
            type="button"
            role="radio"
            aria-checked={active}
            className={styles.apiChoiceRow}
            onClick={() => {
              setProvider(choice.id)
              onPicked?.()
            }}
          >
            <span className={styles.apiChoiceLabel}>
              {t(choice.label)}
              {choice.hint ? <span className={styles.apiChoiceHint}>{t(choice.hint)}</span> : null}
            </span>
            {active ? (
              <span className={styles.apiChoiceCheck} aria-hidden>
                <IconCheckOutline16 />
              </span>
            ) : null}
          </button>
        )
      })}
    </>
  )
}

/** C：折叠行，点开就地展开三个选项 */
const MobileDataSettings = ({
  historyImport,
  historyDelete,
  disabled,
  onNavigate,
  onExportBusyChange,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  historyDelete: ReturnType<typeof useHistoryDelete>
  disabled: boolean
  /** 由设置壳注入：打开数据管理的三级页 */
  onNavigate?: (view: 'dataApi' | 'dataBackup') => void
  /** 导出期间通知外层锁住返回，避免打包被打断 */
  onExportBusyChange?: (busy: boolean) => void
}) => {
  const t = useTranslate()

  return (
    <>
      <div className="ds-pref-block">
        <section className={styles.groupCard}>
          <button type="button" className={styles.dataRow} onClick={() => onNavigate?.('dataApi')}>
            <span className={styles.dataRowLabel}>{t('mobileCustomApiTitle')}</span>
            <span className={styles.dataRowChevron} aria-hidden>
              <IconChevronRightOutline14 />
            </span>
          </button>
        </section>
      </div>

      <div className="ds-pref-block">
        <section className={styles.dataGroup}>
          <ImportHistory historyImport={historyImport} disabled={disabled} row />
          <ExportHistory disabled={disabled} row onBusyChange={onExportBusyChange} />
        </section>
      </div>

      {/* 备份单独一栏：跟导入导出分开 */}
      <div className="ds-pref-block">
        <section className={styles.dataGroup}>
          <button type="button" className={styles.dataRow} onClick={() => onNavigate?.('dataBackup')}>
            <span className={styles.dataRowLabel}>{t('mobileDataBackupGroup')}</span>
            <span className={styles.dataRowChevron} aria-hidden>
              <IconChevronRightOutline14 />
            </span>
          </button>
        </section>
      </div>

      {/* 删除单独一栏：跟其它操作隔开，避免误点 */}
      <div className="ds-pref-block">
        <section className={styles.dataGroup}>
          <DataRow label={t('deleteAllSessions')} danger disabled={disabled} onClick={historyDelete.open} />
        </section>
      </div>
    </>
  )
}

/* ───────── 数据管理：三级页 · 自定义 API ─────────
 * 供应商单独一张卡（点开选），选中哪家，下面的配置卡就显示哪家的设置。
 */
const ApiProviderRow = () => {
  const t = useTranslate()
  const provider = useSettings((state) => state.provider)
  const [open, setOpen] = useState(false)
  const current = API_CHOICES.find((choice) => choice.id === provider)
  return (
    <>
      <button
        type="button"
        className={styles.dataRow}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.dataRowLabel}>{t('apiProviderLabel')}</span>
        <span className={styles.dataRowValue}>{t(current?.label ?? 'providerDeepSeekShort')}</span>
        <span
          className={clsx(styles.dataRowChevron, open && styles.dataRowChevronOpen)}
          aria-hidden
        >
          <IconChevronRightOutline14 />
        </span>
      </button>
      <div className={clsx(styles.expander, open && styles.expanderOpen)}>
        <div className={styles.expanderInner}>
          <ApiChoiceRows onPicked={() => setOpen(false)} />
        </div>
      </div>
    </>
  )
}

const MobileDataApiPanel = ({ editor }: { editor: ReturnType<typeof useApiKeyEditor> }) => {
  const provider = useSettings((state) => state.provider)
  return (
    <>
      <div className="ds-pref-block">
        <section className={styles.dataGroup}>
          <ApiProviderRow />
        </section>
      </div>

      {provider === 'deepseek' ? (
        <div className="ds-pref-block">
          <section className={styles.groupCard}>
            <ProviderKeyPanel editor={editor} />
          </section>
        </div>
      ) : (
        <>
          <div className="ds-pref-block">
            <section className={styles.groupCard}>
              <ProviderConfig />
            </section>
          </div>
          <div className="ds-pref-block">
            <section className={styles.groupCard}>
              <ProviderKeyPanel editor={editor} />
            </section>
          </div>
        </>
      )}
    </>
  )
}

/* ───────── 数据管理：三级页 · 备份 ───────── */
const MobileDataBackupPanel = () => (
  <div className="ds-pref-block">
    <section className={styles.dataGroup}>
      <LocalBackupSetting row />
    </section>
  </div>
)
