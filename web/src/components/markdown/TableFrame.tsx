import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { copyText } from '../../utils/clipboard.js'
import { IconCheckOutline16, IconChevronRightOutline14, IconCopyOutline16, IconDownloadOutline16, IconRightUpOutline14 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import './tableFrame.css'

const csvValue = (text: string) => {
  // Spreadsheet apps evaluate formulas even inside quoted CSV fields. Keep ordinary signed numbers numeric.
  const value = /^\s*[=+@-]/.test(text) && !/^\s*[+-]?\d+(\.\d+)?\s*$/.test(text) ? "'" + text : text
  return /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value
}

const exportCsv = (rows: string[][]) => {
  const data = '\uFEFF' + rows.map(row => row.map(csvValue).join(',')).join('\r\n') + '\r\n'
  const bridge = window.DeepSeekAndroid
  if (bridge?.shareMessage) return bridge.shareMessage('csv', data, false)
  const date = new Date()
  const name = 'table_' + [date.getFullYear(), date.getMonth()+1, date.getDate()].map(n=>String(n).padStart(2,'0')).join('') + '.csv'
  const url = URL.createObjectURL(new Blob([data], {type:'text/csv;charset=utf-8'}))
  const a = document.createElement('a')
  a.download = name; a.href = url; a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10000)
  return true
}

export function TableFrame({children}: {children: ReactNode}) {
  const mobile = useIsMobile()
  const t = useTranslate()
  const inline = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  useLayoutEffect(() => {
    if (!expanded || !mobile) return
    const el = dialog.current!
    el.showModal()
    return () => { el.close(); opener.current?.focus({preventScroll:true}) }
  }, [expanded, mobile])
  useEffect(() => { if (!mobile) setExpanded(false) }, [mobile])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false),1500)
    return () => clearTimeout(timer)
  }, [copied])
  if (!mobile) return <div className="markdown-table-wrapper">{children}</div>
  const rows = () => Array.from(inline.current!.querySelector('table')!.rows,
    row => Array.from(row.cells, cell => cell.innerText))
  const copy = async () => {
    const text = rows().map(row => row.map(cell => cell.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n')
    // The rest of the document is inert while the modal is open.
    const container = dialog.current?.open ? dialog.current : document.body
    if (await copyText(text, container)) setCopied(true)
    else showToast({ key: 'copyFailed' })
  }
  const download = () => { if (!exportCsv(rows())) showToast({key:'tableExportFailed'}) }
  const actions = <>
    <button type="button" aria-label={t('copyTable')} title={t('copyTable')} onClick={copy}>{copied ? <IconCheckOutline16/> : <IconCopyOutline16/>}</button>
    <button className="ds-table-download" type="button" aria-label={t('exportTable')} title={t('exportTable')} onClick={download}>
      <IconDownloadOutline16/><span aria-hidden="true">CSV</span>
    </button>
  </>
  return <>
    <div ref={inline} className="ds-table-card">
      <div className="ds-table-bar"><span>{t('answerTable')}</span>{actions}
        <button ref={opener} type="button" aria-label={t('expandTable')} title={t('expandTable')} aria-haspopup="dialog" onClick={()=>setExpanded(true)}>
          <i className="ds-table-expand" aria-hidden="true"><IconRightUpOutline14/><IconRightUpOutline14/></i>
        </button>
      </div>
      <div className="markdown-table-wrapper" role="region" tabIndex={0} aria-label={t('answerTable')}>{children}</div>
    </div>
    {expanded && <dialog ref={dialog} className="ds-table-full" data-table-full="" aria-label={t('answerTable')} onClose={()=>setExpanded(false)}>
      <div className="ds-table-bar">
        <button className="ds-table-back" type="button" aria-label={t('tableBack')} title={t('tableBack')} onClick={() => dialog.current?.close()}>
          <IconChevronRightOutline14/>
        </button>
        <span>{t('answerTable')}</span>{actions}
      </div>
      <div className="ds-table-page"><div className="ds-table-card"><div className="markdown-table-wrapper" role="region" tabIndex={0} aria-label={t('answerTable')}>{children}</div></div></div>
    </dialog>}
  </>
}
