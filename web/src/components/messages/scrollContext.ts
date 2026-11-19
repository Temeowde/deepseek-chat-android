import { createContext, useContext } from 'react'

/** 渲染更新后请求滚到底部；用户上滑离开底部时由列表忽略 */
export const ScrollToBottomContext = createContext({ follow: () => {}, hold: () => {} })

export const useScrollToBottom = () => useContext(ScrollToBottomContext).follow
export const useHoldReadingPosition = () => useContext(ScrollToBottomContext).hold
