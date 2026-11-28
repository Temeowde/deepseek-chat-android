import { Tool } from './mobileActions.js'
import { useTranslate } from '../../i18n/index.js'
import clsx from 'clsx'
import { memo, useState } from 'react'
import { IconWarningOutline16 } from '../base/icons.js'
import { MaskIcon } from '../base/MaskIcon.js'
import { describeReply, getContextLimit } from '../../services/chat/describe.js'
import { CompressProgressError, compressSessionContext } from '../../services/chat/contextCompression.js'
import { canContinueReply } from '../../services/chat/reply.js'
import { estimateUsageCost } from '../../services/chat/usageCost.js'
import { continueReply, regenerateReply, retryWithTruncatedQuestion } from '../../services/chat/store.js'
import { showToast } from '../base/toastState.js'
import { stopReadAloud } from '../../services/speech/readAloud.js'
import type { AssistantMessage as AssistantMessageType } from '../../services/chat/types.js'
import { ensureApiKey, openSettings } from '../settings/settingsDialogState.js'
import { IconButton } from '../base/IconButton.js'
import { Button } from '../base/Button.js'
import { Markdown } from '../markdown/Markdown.js'
import { SiteThumbnails } from '../search/SiteLogo.js'
import { toggleSearchPanel, useSearchPanel } from '../search/searchPanelState.js'
import { ReadAloudButton } from './ReadAloudButton.js'
import { CopyButton } from './CopyButton.js'
import { UsageSheet } from './UsageSheet.js'
import { ReplyArea } from './ReplyArea.js'
import { useReplyView } from './useReplyView.js'
import {
  BranchSwitcher,
  type MessageVersions,
  type SelectMessageVersion,
} from './BranchSwitcher.js'
import styles from './AssistantMessage.module.css'

const TOP_UP_URL = 'https://platform.deepseek.com/top_up'

export const AssistantMessage = memo(function AssistantMessage({
  sessionId,
  message,
  isLast,
  streaming,
  busy,
  versions,
  onSelectVersion,
}: {
  sessionId: string
  message: AssistantMessageType
  isLast: boolean
  streaming: boolean
  busy: boolean
  versions: MessageVersions
  onSelectVersion: SelectMessageVersion
}) {
  const t = useTranslate()
  const view = useReplyView(message, streaming)
  const panelEntry = useSearchPanel((state) => state.entry)
  const notice = streaming ? null : describeReply(message)
  /** 压缩按钮的进行中状态（仅"上下文爆满"这条错误提示会用到） */
  const [compressing, setCompressing] = useState(false)
  /** 截断重发按钮的进行中状态（仅"当前这条太大"这条错误提示会用到） */
  const [trimming, setTrimming] = useState(false)
  /** 本轮消耗额度面板 */
  const [usageOpen, setUsageOpen] = useState(false)
  const usageCost = message.usage
    ? estimateUsageCost(message.usage, message.model, message.createdAt)
    : null
  const zhText = !document.documentElement.lang.startsWith('en')
  /**
   * 用户主动点「截断后发送」：只把当前这条文本截到安全长度重新发一次。
   * 只在"当前这条本身太大"的错误上出现；历史太长的场景给的是压缩按钮。
   */
  const trimAndResend = () => {
    if (trimming || busy) {
      return
    }
    setTrimming(true)
    try {
      const done = retryWithTruncatedQuestion(sessionId, message.id)
      if (!done) {
        showToast(
          zhText
            ? '这条内容过长且无法自动截断（可能来自附件），请减少内容后重试'
            : 'Too long to trim automatically (maybe from attachments); please reduce the content and retry.'
        )
      }
    } finally {
      setTrimming(false)
    }
  }

  /**
   * 把早期轮次压成摘要存到本地，然后重新生成这条失败的回答。
   * 平时聊天不会走到这里。
   */
  const compressContext = async () => {
    if (compressing || busy) {
      return
    }
    setCompressing(true)
    try {
      const result = await compressSessionContext(
        sessionId,
        getContextLimit(message.error?.message),
        message.error?.questionTokens ?? 0
      )
      showToast(
        zhText
          ? `已把前 ${result.coveredRounds} 轮对话压缩成记忆，正在继续回答…`
          : `Compressed ${result.coveredRounds} earlier turns; retrying…`
      )
      regenerateReply(sessionId, message.id)
    } catch (error) {
      // 只是「还没压完」，进度已保存：不要显示成失败
      if (error instanceof CompressProgressError) {
        showToast(error.message)
        return
      }
      showToast(
        (zhText ? '压缩失败：' : 'Compression failed: ') +
          (error instanceof Error ? error.message : String(error))
      )
    } finally {
      setCompressing(false)
    }
  }
  // 安全拒绝：已下发的思考与正文按协议丢弃，只显示模板答复。
  const refused = message.stopReason === 'refusal'
  const answer = refused ? null : view.answer
  const responseText = [answer?.text, notice?.presentation === 'response' ? notice.text : null]
    .filter(Boolean)
    .join('\n\n')
  const copyText = responseText || notice?.text
  const waiting = streaming && view.steps.length === 0 && !view.answer && !message.thinking
  const canContinue = isLast && canContinueReply(message)
  const inlineActions = isLast || !responseText
  const summaryEntry = `${message.id}-summary`
  return (
    <div className={styles.message} data-chat-role="assistant" data-chat-message={message.id}>
      {refused ? null : (
        <ReplyArea
          message={message}
          view={view}
          streaming={streaming}
          hasResponse={!!responseText}
        />
      )}
      {answer ? (
        <Markdown
          className="ds-assistant-message-main-content"
          content={answer.markdown}
          loading={streaming}
          cacheKey={message.id}
          disableLink={false}
          sources={view.sources}
        />
      ) : null}
      {waiting ? (
        <div className={styles.waiting} role="status">
          <span className={styles.waitingDot} aria-hidden />
          {t('waitingForReply')}
        </div>
      ) : null}
      {notice?.presentation === 'response' ? (
        <Markdown
          className="ds-assistant-message-main-content"
          content={notice.text}
          loading={false}
          cacheKey={`${message.id}-template`}
          disableLink={false}
        />
      ) : notice ? (
        <div className={styles.notice}>
          <IconWarningOutline16 />
          <span>
            {notice.text}
            {notice.action === 'apiKey' ? (
              <>
                {' '}
                <button
                  type="button"
                  className={styles.noticeAction}
                  onClick={() => openSettings(window.matchMedia('(max-width:767px)').matches ? 'key' : 'data')}
                >
                  {t('changeApiKey')}
                </button>
              </>
            ) : null}
            {notice.action === 'topUp' ? (
              <>
                {' '}
                <a
                  className={styles.noticeAction}
                  href={TOP_UP_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('topUp')}
                </a>
              </>
            ) : null}
            {notice.action === 'compressContext' ? (
              <>
                {' '}
                <button
                  type="button"
                  className={styles.noticeAction}
                  disabled={compressing || busy}
                  onClick={() => void compressContext()}
                >
                  {compressing
                    ? zhText
                      ? '正在压缩…'
                      : 'Compressing…'
                    : zhText
                      ? '压缩上下文并继续'
                      : 'Compress context & continue'}
                </button>
              </>
            ) : null}
            {notice.action === 'trimInput' ? (
              <>
                {' '}
                <button
                  type="button"
                  className={styles.noticeAction}
                  disabled={trimming || busy}
                  onClick={() => trimAndResend()}
                >
                  {trimming
                    ? zhText
                      ? '正在发送…'
                      : 'Sending…'
                    : zhText
                      ? '截断后发送'
                      : 'Trim & send'}
                </button>
              </>
            ) : null}
          </span>
        </div>
      ) : null}
      {!streaming && !refused && view.searchResults.length > 0 ? (
        <button type="button"
          className={clsx(styles.summary, panelEntry === summaryEntry && styles.summaryActive)}
          onClick={() => toggleSearchPanel(summaryEntry, view.searchResults)}
        >
          <SiteThumbnails sources={view.searchResults} />
          <span>
            {t(
              view.searchResults.length === 1 ? 'messageSearchSummary' : 'messageSearchSummaries',
              { count: view.searchResults.length }
            )}
          </span>
        </button>
      ) : null}
      {streaming ? null : (
        <div className={styles.bottom} data-inline={inlineActions || versions.ids.length > 1}>
          <BranchSwitcher versions={versions} disabled={busy} onSelect={onSelectVersion} />
          <div className={clsx(styles.actions, isLast && styles.alwaysShow)} data-inline={inlineActions}>
            {copyText ? <CopyButton text={copyText} /> : null}
                                    {responseText && !refused ? (
              <ReadAloudButton messageId={message.id} text={responseText} />
            ) : null}
            {responseText && !refused && <Tool kind="share" message={message} />}
            {usageCost ? (
              <IconButton
                data-msg-action="usage"
                icon={<MaskIcon name="database" />}
                tooltip={t('usageTitle')}
                tooltipPlacement="bottom"
                onClick={() => setUsageOpen(true)}
              />
            ) : null}
            <IconButton
              data-msg-action="regenerate"
              icon={<MaskIcon name="rotate-cw" />}
              tooltip={t('regenerate')}
              tooltipPlacement="bottom"
              disabled={busy || refused}
              onClick={() => {
                if (!ensureApiKey()) return
                stopReadAloud()
                regenerateReply(sessionId, message.id)
              }}
            />
          </div>
          {canContinue ? (
            <Button
              variant="outlined"
              size="s"
              className={styles.continueButton}
              disabled={busy}
              onClick={() => {
                if (!ensureApiKey()) return
                stopReadAloud()
                continueReply(sessionId, message.id)
              }}
            >
              {t('continueGenerating')}
            </Button>
          ) : null}
        </div>
      )}
      {usageOpen && message.usage ? (
        <UsageSheet
          usage={message.usage}
          model={message.model}
          provider={message.provider}
          at={message.createdAt}
          onClose={() => setUsageOpen(false)}
        />
      ) : null}
    </div>
  )
})
