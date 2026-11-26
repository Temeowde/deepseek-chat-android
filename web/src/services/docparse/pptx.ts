/**
 * PPTX 本地解析：用项目里已有的 fflate 解压 + 正则抽 `<a:t>` 文本。
 *
 * 不引第三方 pptx 库：pptx-preview 是渲染器不是抽取器，还隐式带 echarts/lodash。
 * 这里只取幻灯片里真正显示的文字，表格按行拼成 `| a | b |`。
 * 图片、SmartArt、备注、版式全部丢弃——有损，但在消息头里会写明来源。
 */
import { unzipSync, strFromU8 } from 'fflate'

const decodeXml = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&')

/** 一页幻灯片 → 文本：段落换行，表格逐行拼成 Markdown 行 */
const slideToText = (xml: string): string => {
  const lines: string[] = []
  // 表格：<a:tbl> ... </a:tbl>，每 <a:tr> 一行
  const tables = xml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/g) ?? []
  for (const table of tables) {
    const rows = table.match(/<a:tr[\s\S]*?<\/a:tr>/g) ?? []
    for (const row of rows) {
      const cells = (row.match(/<a:tc[\s\S]*?<\/a:tc>/g) ?? []).map((cell) => {
        const texts = (cell.match(/<a:t>([\s\S]*?)<\/a:t>/g) ?? []).map((node) =>
          decodeXml(node.replace(/<\/?a:t>/g, ''))
        )
        return texts.join('').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')
      })
      if (cells.some(Boolean)) {
        lines.push(`| ${cells.join(' | ')} |`)
      }
    }
  }

  // 正文：按段落 <a:p> 切分，每段里的 <a:t> 拼接
  const body = xml.replace(/<a:tbl>[\s\S]*?<\/a:tbl>/g, '')
  const paragraphs = body.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? []
  for (const paragraph of paragraphs) {
    const texts = (paragraph.match(/<a:t>([\s\S]*?)<\/a:t>/g) ?? []).map((node) =>
      decodeXml(node.replace(/<\/?a:t>/g, ''))
    )
    const text = texts.join('').trim()
    if (text) {
      lines.push(text)
    }
  }
  return lines.join('\n')
}

export const parsePptx = async (bytes: Uint8Array): Promise<string> => {
  const files = unzipSync(bytes, {
    filter: (file) => /^ppt\/slides\/slide\d+\.xml$/.test(file.name),
  })
  const slides = Object.keys(files)
    .map((name) => ({ name, index: Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0) }))
    .filter((item) => item.index > 0)
    .sort((a, b) => a.index - b.index)

  const parts: string[] = []
  for (const slide of slides) {
    const xml = strFromU8(files[slide.name])
    const text = slideToText(xml).trim()
    if (text) {
      parts.push(`## 第 ${slide.index} 页\n\n${text}`)
    }
  }
  return parts.join('\n\n')
}
