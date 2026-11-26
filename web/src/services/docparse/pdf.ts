/**
 * PDF 本地解析：pdfjs-dist 3.11.174（Apache-2.0）。
 *
 * 本机实测的 `file://` 限制（页面在 `file:///android_asset/`，origin 为 `file://`）：
 * - `new Worker('file://...')` 被同源策略拒绝（ONERROR blocked）
 * - `fetch()` / `XHR` 读本地文件被拦
 * - `new Worker(blobUrl)` 可用，但需要在包里内联 1 MB 的 worker 源码，
 *   而且内联的源码不经过 swc 降级，老内核（Chromium 66）会直接语法报错，
 *   连上后不响应会让 pdf.js 永久挂起。
 *
 * 所以这里用 pdf.js 自带的「主线程 worker」机制：把 worker 模块挂到
 * `globalThis.pdfjsWorker` 上，pdf.js 检测到后就不再创建真 worker，
 * 直接在主线程解析。代价是解析期间阻塞主线程 ~1 秒，换来的是
 * 全内核可用、零 URL/同源问题、体积只算一份。
 */
import * as pdfjsModule from 'pdfjs-dist/build/pdf.js'

type TextItem = { str?: string; hasEOL?: boolean }

type PdfPage = {
  getTextContent: () => Promise<{ items: TextItem[] }>
  cleanup: () => void
}

type PdfDocument = {
  numPages: number
  getPage: (index: number) => Promise<PdfPage>
  destroy: () => Promise<void>
}

type PdfjsApi = {
  getDocument: (source: { data: Uint8Array }) => { promise: Promise<PdfDocument> }
}

const api = pdfjsModule as unknown as PdfjsApi

let workerReady: Promise<void> | null = null

/**
 * 把 worker 模块挂到 globalThis.pdfjsWorker，让 pdf.js 走主线程解析。
 * 用动态 import，worker 代码只在真正解析 PDF 时才加载。
 */
const ensureWorker = (): Promise<void> => {
  const global = globalThis as { pdfjsWorker?: unknown }
  if (global.pdfjsWorker) {
    return Promise.resolve()
  }
  workerReady ??= import('pdfjs-dist/build/pdf.worker.min.js').then((module) => {
    const loaded = module as unknown as { default?: unknown; WorkerMessageHandler?: unknown }
    global.pdfjsWorker = loaded.default ?? loaded
  })
  return workerReady
}

/** 逐页抽文字，页与页之间空行分隔；扫描件没有文字层时返回空串 */
export const parsePdf = async (bytes: Uint8Array): Promise<string> => {
  await ensureWorker()
  const task = api.getDocument({ data: bytes })
  const document = await task.promise
  const pages: string[] = []
  try {
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index)
      try {
        const content = await page.getTextContent()
        let text = ''
        for (const item of content.items) {
          if (typeof item.str !== 'string') {
            continue
          }
          text += item.str
          if (item.hasEOL) {
            text += '\n'
          }
        }
        const trimmed = text.trim()
        if (trimmed) {
          pages.push(trimmed)
        }
      } finally {
        page.cleanup()
      }
    }
  } finally {
    await document.destroy()
  }
  return pages.join('\n\n')
}
