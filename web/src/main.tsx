import './app/compat.js'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { ErrorBoundary } from './app/ErrorBoundary.js'
import { setupTheme } from './app/theme.js'
import { installNativeInsetsRepair } from './app/nativeInsets.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

const fail = (error: unknown) => {
  try {
    window.__dsBootFail?.(error)
  } catch {
    // 兜底页本身失败时没法再处理
  }
}

try {
  ensureKatex()
  setupTheme()
  installNativeInsetsRepair()
  createRoot(document.getElementById('root') as HTMLElement).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  )
} catch (error) {
  fail(error)
  throw error
}
