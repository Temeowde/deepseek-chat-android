import * as React from 'react'
import clsx from 'clsx'
import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import {
  IconGlobeLanguageOutline14,
  IconSendOutline16,
  IconStopFill16,
  IconThinkOutline14,
} from '../base/icons.js'
import { setSearch, setThinking, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { editMessage, sendMessage, stopReply, useChatStore } from '../../services/chat/store.js'
import {
  addDraftFiles,
  EMPTY_DRAFT,
  getDraft,
  prepareDraftMessage,
  removeDraftAttachment,
  retryDraftAttachment,
  setDraftText,
  useDrafts,
} from '../../services/chat/drafts.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import { Tooltip } from '../base/Tooltip.js'
import { ensureApiKey } from '../settings/settingsDialogState.js'
import { DragMask, useFileDrop } from './DragMask.js'
import { showToast } from '../base/toastState.js'
import { ACCEPT, useUploads } from '../../services/attachments.js'
import { DraftAttachments } from './DraftAttachments.js'
import { useVoiceInput } from './useVoiceInput.js'
import { VoiceButton } from './VoiceButton.js'
import { Spectrum } from './Spectrum.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './ChatInput.module.css'

type MessageEdit = {
  messageId: string
  text: string
  hasFiles: boolean
  onChange(text: string): void
  onClose(): void
}

type InputProps = { sessionId: string | null; unavailable?: boolean; edit?: MessageEdit | null }

/** 移动端保留输入节点，切换会话时独立重置录音和文件选择。 */
/** 轻触反馈，和原生开关一致 */
const vibrate = () => {
  try {
    navigator.vibrate?.(8)
  } catch {
    // 不支持震动时忽略
  }
}

export const ChatInput = memo(function ChatInput(props: InputProps) {
  const isMobile = useIsMobile()
  return <Input key={isMobile ? 'mobile' : props.sessionId === null ? 'new' : 'session:' + props.sessionId} {...props} />
})

const Input = ({ sessionId, unavailable = false, edit }: InputProps) => {
  const t = useTranslate()
  const draft = useDrafts((state) => state.drafts.get(sessionId) ?? EMPTY_DRAFT)
  const text = edit?.text ?? draft.text
  const { attachments } = draft
  const setText = edit?.onChange ?? ((value: string) => setDraftText(sessionId, value))
  const editId = edit?.messageId
  const closeEdit = edit?.onClose
  const draftReady = useUploads((state) => prepareDraftMessage(draft, state.tasks) !== null)
  const streaming = useChatStore(
    (state) => sessionId !== null && Object.hasOwn(state.streaming, sessionId)
  )
  const thinking = useSettings((state) => state.thinking)
  const importingHistory = useChatStore((state) => state.importingHistory)
  const isMobile = useIsMobile()
  const search = useSettings((state) => state.search)
  const voiceResult = useRef<((text: string) => void) | null>(null)
  const voiceLimit = useRef<(() => void) | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const togglesRef = useRef<HTMLDivElement>(null)
  const draftScope = useRef(sessionId)
  const dismissEdit = useCallback(() => {
    if (!closeEdit) return false
    textareaRef.current?.blur()
    closeEdit()
    return true
  }, [closeEdit])

  useLayoutEffect(() => {
    if (draftScope.current === sessionId) return
    draftScope.current = sessionId
    const textarea = textareaRef.current
    textarea?.blur()
    if (textarea) textarea.scrollTop = 0
  }, [sessionId])

  useLayoutEffect(() => {
    const toggles = togglesRef.current
    if (!toggles) {
      return
    }

    const updateLabels = () => {
      toggles.classList.remove(styles.collapsedToggles)
      toggles.classList.toggle(styles.collapsedToggles, toggles.scrollWidth > toggles.clientWidth)
    }

    updateLabels()
    const observer = new ResizeObserver(updateLabels)
    observer.observe(toggles)
    return () => observer.disconnect()
  }, [t])

  const acceptFiles = (files: File[]) => {
    if (editId || files.length === 0 || unavailable || useChatStore.getState().importingHistory || !ensureApiKey()) {
      return
    }
    const error = addDraftFiles(sessionId, files, useSettings.getState().apiKey ?? '')
    if (error) {
      showToast(error)
    }
  }
  const retryFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory && ensureApiKey()) {
        retryDraftAttachment(sessionId, id, useSettings.getState().apiKey ?? '')
      }
    },
    [sessionId]
  )
  const removeFile = useCallback(
    (id: string) => {
      if (!useChatStore.getState().importingHistory) {
        removeDraftAttachment(sessionId, id)
      }
    },
    [sessionId]
  )
  const dragging = useFileDrop(acceptFiles)

  /** 转写结果插入到光标处，并把光标移到插入内容之后 */
  const voice = useVoiceInput((transcript) => {
    if (isMobile) { voiceResult.current?.(transcript); return }
    const textarea = textareaRef.current
    const current = getDraft(sessionId).text
    const start = textarea?.selectionStart ?? current.length
    const end = textarea?.selectionEnd ?? current.length
    setText(current.slice(0, start) + transcript + current.slice(end))
    requestAnimationFrame(() => {
      textarea?.focus({ preventScroll: true })
      textarea?.setSelectionRange(start + transcript.length, start + transcript.length)
    })
  }, isMobile ? voiceLimit : undefined)

  // 欢迎页导入后会话 ID 不变，不能依赖卸载取消语音；订阅开始事件也覆盖快速完成的导入。
  const cancelVoice = voice.cancel
  useLayoutEffect(() => {
    if (!editId) return
    cancelVoice()
    const textarea = textareaRef.current
    textarea?.focus({ preventScroll: true })
    const end = textarea?.value.length ?? 0
    textarea?.setSelectionRange(end, end)
    window.cancelComposerEdit = dismissEdit
    return () => {
      if (window.cancelComposerEdit === dismissEdit) delete window.cancelComposerEdit
    }
  }, [cancelVoice, dismissEdit, editId])
  useEffect(
    () =>
      useChatStore.subscribe((state, previous) => {
        if (state.importingHistory && !previous.importingHistory) {
          cancelVoice()
        }
      }),
    [cancelVoice]
  )

  // 移动端录音时用频谱替代输入框内容
  const recording = !edit && voice.status === 'recording'

  // 排队、上传中或上传失败的附件都留在输入框，全部上传成功后才能发送
  const disabled = unavailable || importingHistory
  const ready = edit ? !!text.trim() || edit.hasFiles : draftReady
  const canSend = !disabled && !streaming && voice.status === 'idle' && ready

  const send = () => {
    if (edit) {
      if (canSend && sessionId && ensureApiKey() && editMessage(sessionId, edit.messageId, text)) {
        stopReadAloud()
        dismissEdit()
      }
      return
    }
    if (
      unavailable ||
      useChatStore.getState().importingHistory ||
      voice.status !== 'idle' ||
      !prepareDraftMessage(getDraft(sessionId), useUploads.getState().tasks)
    ) {
      return
    }
    // 文本与上传完成态由提交动作读取最新快照，不使用上一次渲染的草稿。
    if (!ensureApiKey() || !sendMessage(sessionId)) {
      return
    }
    stopReadAloud()
    if (isMobile) {
      textareaRef.current?.blur()
    } else {
      textareaRef.current?.focus()
    }
  }

  const voiceUI = window.useMobileComposerVoice(React, {
    mobile: isMobile, sessionId, busy: disabled || streaming || !!edit, voice, text, fileCount: attachments.length,
    textarea: textareaRef, limitRef: voiceLimit, resultRef: voiceResult, ensureKey: ensureApiKey, setText, send,
  })
  const attachment = window.useComposerAttachments(
    React, disabled || !!edit || (isMobile && voice.status !== 'idle'), ensureApiKey, acceptFiles, ACCEPT, sessionId,
  )
  const showVoice = isMobile && voiceUI.showToggle && !streaming && !edit
  const action = showVoice ? voiceUI.toggle : (
    <button
      type="button"
      className={clsx(styles.sendButton, !streaming && !canSend && styles.disabled)}
      aria-label={t(streaming ? 'chatInputStopButtonTooltip' : 'send')}
      aria-disabled={!streaming && !canSend}
      onMouseDown={(event) => { if (isMobile) event.preventDefault() }}
      onClick={() => {
        if (streaming && sessionId !== null) {
          stopReadAloud()
          stopReply(sessionId)
        } else {
          send()
        }
      }}
    >
      <span key={streaming ? 'stop' : 'send'} className={styles.actionGlyph}>
        {streaming ? <IconStopFill16 /> : <IconSendOutline16 />}
      </span>
    </button>
  )

  return (<>
    <div
      className={clsx(styles.wrapper, sessionId === null ? styles.home : styles.session)}
      data-chat-composer
      data-composer-editing={!!edit}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          textareaRef.current?.focus({ preventScroll: true })
        }
      }}
    >
      {edit ? (
        <div className={styles.editBar}>
          <span>{t('editMessage')}</span>
          <button type="button" className={styles.discardEdit} onClick={dismissEdit}>
            {t('discardMessageEdit')}
          </button>
        </div>
      ) : <DraftAttachments items={attachments} onRetry={retryFile} onRemove={removeFile} />}
      <div className={styles.textareaWrapper}>
        <textarea
          ref={textareaRef}
          onFocus={voiceUI.onFocus}
          onBlur={voiceUI.onBlur}
          className={clsx(styles.textarea, recording && isMobile && styles.textareaHidden)}
          placeholder={t('chatInputPlaceholderChat')}
          aria-label={t(edit ? 'editMessage' : 'chatInputPlaceholderChat')}
          rows={2}
          enterKeyHint={isMobile ? 'enter' : undefined}
          // 移动端不自动聚焦，避免一打开就弹出键盘
          autoFocus={!isMobile}
          disabled={disabled}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onMouseDown={(event) => {
            // 首次点击时手动聚焦，避免 Safari 把整个页面滚到输入框位置。
            if (isMobile && event.button === 0 && document.activeElement !== event.currentTarget) {
              event.preventDefault()
              event.currentTarget.focus({ preventScroll: true })
            }
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Escape' && edit) {
              event.preventDefault()
              dismissEdit()
            } else if (!isMobile && event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (!edit && files.length > 0) {
              event.preventDefault()
              acceptFiles(files)
            }
          }}
        />
        {!edit && voiceUI.pad}
        {recording && isMobile ? <Spectrum getAnalyser={voice.getAnalyser} /> : null}
        <div className={styles.mirror} aria-hidden>
          {`${text}\n`}
        </div>
      </div>
      <div className={styles.functionRow}>
        {/* 深度思考 / 智能搜索开关，tooltip 在按钮上方 */}
        <div ref={togglesRef} className={styles.toggles}>
          <Tooltip content={t('deactivatedThinkTooltip')}>
            <button
              type="button"
              className={clsx(styles.toggle, thinking && styles.selected)}
              aria-label={t('thinkingSwitch')}
              aria-pressed={thinking}
              onClick={() => { vibrate(); setThinking(!thinking) }}
            >
              <IconThinkOutline14 />
              <span className={styles.toggleLabel}>{t('thinkingSwitch')}</span>
            </button>
          </Tooltip>
          <Tooltip content={t('deactivatedSearchTooltip')}>
            <button
              type="button"
              className={clsx(styles.toggle, search && styles.selected)}
              aria-label={t('search')}
              aria-pressed={search}
              onClick={() => { vibrate(); setSearch(!search) }}
            >
              <IconGlobeLanguageOutline14 />
              <span className={styles.toggleLabel}>{t('search')}</span>
            </button>
          </Tooltip>
        </div>
        <div className={styles.right}>
          {!isMobile && <VoiceButton
            status={voice.status}
            disabled={!voice.available}
            seconds={voice.seconds}
            onClick={() => {
              if (
                voice.status !== 'idle' ||
                (!useChatStore.getState().importingHistory && ensureApiKey())
              ) {
                void voice.toggle()
              }
            }}
          />}
          {!edit && attachment.toggle}
          {!edit && attachment.inputs}
          {isMobile ? <div className={styles.actionSlot} data-voice={showVoice}>{action}</div> : action}
        </div>
      </div>
      {dragging && !edit ? <DragMask /> : null}
    </div>
    {!edit && attachment.panel}
  </>)
}
