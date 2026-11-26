/**
 * pdfjs-dist 3.11 只给包根 `pdfjs-dist` 配了类型，`build/pdf.js`（浏览器 UMD 构建）
 * 与 worker 文件没有声明。这里补上，避免 any 泄漏。
 */
declare module 'pdfjs-dist/build/pdf.js' {
  export * from 'pdfjs-dist'
}

declare module 'pdfjs-dist/build/pdf.worker.min.js' {
  const worker: { WorkerMessageHandler?: unknown }
  export = worker
}
