import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * React 渲染期异常兜底。
 *
 * 以前只要 App 在渲染时抛一次错（例如本地数据缺字段、旧 WebView 不支持的 API），
 * React 18 会把整棵树卸载，页面变成纯白，用户只能清数据重装。
 * 这里把错误交给 index.html 里的启动兜底页，至少能看到错误信息和「重新加载」。
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static override getDerivedStateFromError() {
    return { failed: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      window.__dsBootFail?.(error, info.componentStack ?? '')
    } catch {
      // 兜底页不可用时保持静默
    }
  }

  override render() {
    return this.state.failed ? null : this.props.children
  }
}
