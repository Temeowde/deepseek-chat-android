import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { copyText } from '../../utils/clipboard.js'
import { IconCheckOutline16, IconChevronRightOutline14, IconCopyOutline16 } from '../base/icons.js'
import { TableIcon } from './tableIcons.js'
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

/** 表格全屏时的横屏切换：走原生 setRequestedOrientation（官方同款做法）。 */
const screen = () => window.ScreenAndroid

export function TableFrame({children}: {children: ReactNode}) {
  const mobile = useIsMobile()
  const t = useTranslate()
  const inline = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [landscape, setLandscape] = useState(false)
  const closeFull = () => {
    if (landscape) {
      screen()?.portrait()
      setLandscape(false)
    }
    dialog.current?.close()
  }
  const rotate = () => {
    const next = !landscape
    setLandscape(next)
    if (next) screen()?.landscape()
    else screen()?.portrait()
  }
  useLayoutEffect(() => {
    if (!expanded || !mobile) return
    const el = dialog.current!
    el.showModal()
    return () => {
      screen()?.portrait()
      el.close()
      opener.current?.focus({preventScroll:true})
    }
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
      <TableIcon name="download"/>
    </button>
  </>
  return <>
    <div ref={inline} className="ds-table-card">
      <div className="ds-table-bar"><span>{t('answerTable')}</span>{actions}
        <button ref={opener} type="button" aria-label={t('expandTable')} title={t('expandTable')} aria-haspopup="dialog" onClick={()=>setExpanded(true)}>
          <TableIcon name="fullscreen"/>
        </button>
      </div>
      <div className="markdown-table-wrapper" role="region" tabIndex={0} aria-label={t('answerTable')}>{children}</div>
    </div>
    {expanded && <dialog ref={dialog} className="ds-table-full" data-table-full="" data-landscape={landscape ? 'true' : 'false'} aria-label={t('answerTable')} onClose={()=>setExpanded(false)}>
      <div className="ds-table-bar">
        <button className="ds-table-back" type="button" aria-label={t('tableBack')} title={t('tableBack')} onClick={closeFull}>
          <IconChevronRightOutline14/>
        </button>
        <span>{t('answerTable')}</span>
        {/* 官方全屏顶栏就是「下载 + 旋转」两枚图标 */}
        <button className="ds-table-rotate" type="button" aria-label={t('rotateTable')} title={t('rotateTable')} onClick={rotate}>
          <TableIcon name="rotate"/>
        </button>
        <button className="ds-table-download" type="button" aria-label={t('exportTable')} title={t('exportTable')} onClick={download}>
          <TableIcon name="download"/>
        </button>
      </div>
      <div className="ds-table-page"><div className="ds-table-card"><div className="markdown-table-wrapper" role="region" tabIndex={0} aria-label={t('answerTable')}>{children}</div></div></div>
    </dialog>}
  </>
}
