/**
 * 扫描若干真实 PDF，看哪些有文字层——用来区分「解析器坏了」和「本来就是扫描件」。
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js')

const candidates = process.argv.slice(2)

for (const file of candidates) {
  try {
    const bytes = new Uint8Array(readFileSync(file))
    const started = Date.now()
    const document = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise
    let text = ''
    let itemCount = 0
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index)
      const content = await page.getTextContent()
      itemCount += content.items.length
      for (const item of content.items) {
        if (typeof item.str === 'string') text += item.str
      }
      page.cleanup()
    }
    await document.destroy()
    const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length
    console.log(
      `${file.split('\\').pop()} | ${document.numPages}页 | items=${itemCount} | chars=${text.length} | cjk=${cjk} | ${Date.now() - started}ms`
    )
    if (text.length > 0) console.log('   head:', text.slice(0, 100).replace(/\n/g, ' '))
  } catch (error) {
    console.log(`${file.split('\\').pop()} | ERROR ${error.message}`)
  }
}
