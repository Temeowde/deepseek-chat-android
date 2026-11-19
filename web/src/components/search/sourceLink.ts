import type { MouseEvent } from 'react'

/** Source metadata may come from an imported archive rather than a live search. */
export const webSourceUrl = (value: string) => {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname && !url.username && !url.password
      ? url.href : undefined
  } catch { return undefined }
}

export function openSourcePage(event: MouseEvent<HTMLAnchorElement>) {
  const reader = window.DeepSeekAndroid
  if (!reader?.openSource || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
  const url = webSourceUrl(event.currentTarget.href)
  event.preventDefault()
  if (url) reader.openSource(url, document.documentElement.lang, document.body.classList.contains('dark'))
}
