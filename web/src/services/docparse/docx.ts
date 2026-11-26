/**
 * DOCX 本地解析：mammoth 1.13.0（BSD-2-Clause）。
 *
 * 用 `convertToHtml` 而不是 `extractRawText`：后者会把表格塌成一列
 * （实测 5 列表格 → 每个单元格独占一行，列关系全丢），
 * 前者能保留 <table> 结构，再转成 Markdown 表格喂给模型。
 */
import mammoth from 'mammoth'

/** 把 mammoth 产出的 HTML 转成紧凑的 Markdown 文本 */
const htmlToMarkdown = (html: string): string => {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const blocks: string[] = []

  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? '').replace(/\s+/g, ' ')
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return ''
    }
    const element = node as HTMLElement
    const tag = element.tagName.toLowerCase()
    if (tag === 'br') {
      return '\n'
    }
    const inner = Array.from(element.childNodes).map(inline).join('')
    if (tag === 'strong' || tag === 'b') {
      return inner.trim() ? `**${inner.trim()}**` : ''
    }
    if (tag === 'em' || tag === 'i') {
      return inner.trim() ? `*${inner.trim()}*` : ''
    }
    if (tag === 'code') {
      return inner.trim() ? `\`${inner.trim()}\`` : ''
    }
    return inner
  }

  const table = (element: HTMLElement): string => {
    const rows = Array.from(element.querySelectorAll('tr'))
    const lines: string[] = []
    let columns = 0
    rows.forEach((row, index) => {
      const cells = Array.from(row.querySelectorAll('th,td')).map((cell) =>
        inline(cell).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')
      )
      if (cells.length === 0) {
        return
      }
      columns = Math.max(columns, cells.length)
      lines.push(`| ${cells.join(' | ')} |`)
      if (index === 0) {
        lines.push(`|${' --- |'.repeat(cells.length)}`)
      }
    })
    if (columns === 0) {
      return ''
    }
    return lines.join('\n')
  }

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').trim()
      if (text) {
        blocks.push(text)
      }
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return
    }
    const element = node as HTMLElement
    const tag = element.tagName.toLowerCase()

    if (tag === 'table') {
      const rendered = table(element)
      if (rendered) {
        blocks.push(rendered)
      }
      return
    }
    if (/^h[1-6]$/.test(tag)) {
      const text = inline(element).trim()
      if (text) {
        blocks.push(`${'#'.repeat(Number(tag[1]))} ${text}`)
      }
      return
    }
    if (tag === 'li') {
      const text = inline(element).trim()
      if (text) {
        blocks.push(`- ${text}`)
      }
      return
    }
    if (tag === 'p') {
      const text = inline(element).trim()
      if (text) {
        blocks.push(text)
      }
      return
    }
    if (tag === 'ul' || tag === 'ol' || tag === 'div' || tag === 'blockquote') {
      Array.from(element.childNodes).forEach(visit)
      return
    }
    Array.from(element.childNodes).forEach(visit)
  }

  Array.from(document.body.childNodes).forEach(visit)
  return blocks.join('\n\n')
}

export const parseDocx = async (bytes: Uint8Array): Promise<string> => {
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
  const result = await mammoth.convertToHtml({ arrayBuffer })
  return htmlToMarkdown(result.value)
}
