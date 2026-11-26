/**
 * 在桌面 Node 里先验证三种解析器的抽取效果，避免每次都打包 APK 才能发现问题。
 * 逻辑与 web/src/services/docparse/* 保持一致（pdf/docx 直接复用库，pptx 复用同一段正则）。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js')
const mammoth = require('mammoth')
const { unzipSync, strFromU8 } = require('fflate')

const DIR = 'C:/Users/zzzy/Desktop/1121/ds-merged/.build/probe-docs'
const CODE = 'BLUE-WHALE-42'

const readBytes = (name) => new Uint8Array(readFileSync(`${DIR}/${name}`))

async function parsePdf(bytes, label) {
  const started = Date.now()
  const document = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise
  const pages = []
  for (let index = 1; index <= document.numPages; index++) {
    const page = await document.getPage(index)
    const content = await page.getTextContent()
    let text = ''
    for (const item of content.items) {
      if (typeof item.str !== 'string') continue
      text += item.str
      if (item.hasEOL) text += '\n'
    }
    if (text.trim()) pages.push(text.trim())
    page.cleanup()
  }
  await document.destroy()
  const text = pages.join('\n\n')
  console.log(`[pdf] ${label}: ${document.numPages} 页, ${text.length} 字符, ${Date.now() - started} ms`)
  return text
}

const decodeXml = (text) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&')

async function parseDocx(bytes, label) {
  const started = Date.now()
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(arrayBuffer) })
  console.log(`[docx] ${label}: html ${result.value.length} 字符, ${Date.now() - started} ms`)
  console.log('       html head:', result.value.slice(0, 260).replace(/\n/g, ' '))
  return result.value
}

function parsePptx(bytes, label) {
  const started = Date.now()
  const files = unzipSync(bytes, { filter: (file) => /^ppt\/slides\/slide\d+\.xml$/.test(file.name) })
  const slides = Object.keys(files)
    .map((name) => ({ name, index: Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0) }))
    .filter((item) => item.index > 0)
    .sort((a, b) => a.index - b.index)
  const parts = []
  for (const slide of slides) {
    const xml = strFromU8(files[slide.name])
    const texts = (xml.match(/<a:t>([\s\S]*?)<\/a:t>/g) ?? []).map((node) =>
      decodeXml(node.replace(/<\/?a:t>/g, ''))
    )
    parts.push(`## 第 ${slide.index} 页\n\n${texts.filter(Boolean).join('\n')}`)
  }
  const text = parts.join('\n\n')
  console.log(`[pptx] ${label}: ${slides.length} 页, ${text.length} 字符, ${Date.now() - started} ms`)
  return text
}

const check = (label, text) => {
  const has = text.includes(CODE)
  console.log(`  -> ${label} 含代号: ${has ? 'OK' : 'MISSING'}`)
  return has
}

const pdfText = await parsePdf(readBytes('probe.pdf'), 'probe.pdf')
check('probe.pdf', pdfText)

const cnText = await parsePdf(readBytes('probe-cn.pdf'), 'probe-cn.pdf')
console.log('       cn head:', cnText.slice(0, 120).replace(/\n/g, ' | '))
const cjk = (cnText.match(/[\u4e00-\u9fff]/g) || []).length
console.log('  -> 中文样本 CJK 字符数:', cjk)

const docxHtml = await parseDocx(readBytes('probe.docx'), 'probe.docx')
check('probe.docx(html)', docxHtml)
console.log('  -> 表格 html 存在:', docxHtml.includes('<table'))

const pptxText = parsePptx(readBytes('probe.pptx'), 'probe.pptx')
check('probe.pptx', pptxText)
console.log('       pptx head:', pptxText.slice(0, 120).replace(/\n/g, ' | '))

console.log('\nDONE')
