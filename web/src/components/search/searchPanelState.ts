import { create } from 'zustand'
import type { Source } from '../../services/chat/view.js'

/** 右侧「搜索结果」面板：同一入口再次点击收起，换入口时替换内容 */
type SearchPanelState = {
  /** 打开面板的入口，用于判断再次点击是否收起 */
  entry: string | null
  sources: Source[]
  kind: 'list' | 'citations'
  closing: boolean
}

const empty: SearchPanelState = { entry: null, sources: [], kind: 'list', closing: false }
export const useSearchPanel = create<SearchPanelState>(() => empty)

export const toggleSearchPanel = (entry: string, sources: Source[], kind: SearchPanelState['kind'] = 'list') =>
  useSearchPanel.setState((state) =>
    state.entry === entry && !state.closing ? empty : { entry, sources, kind, closing: false }
  )

export const closeSearchPanel = () => useSearchPanel.setState(empty)
export const dismissSearchPanel = () => {
  if (!useSearchPanel.getState().entry) return false
  if (window.matchMedia('(max-width: 767px)').matches) useSearchPanel.setState({ closing: true })
  else closeSearchPanel()
  return true
}
