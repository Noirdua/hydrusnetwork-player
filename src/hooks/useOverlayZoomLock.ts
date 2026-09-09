import { useEffect } from 'react'

let lockCount = 0
let previousViewport: string | null = null

function preventGesture(event: Event) {
  event.preventDefault()
}

function applyOverlayZoomLock() {
  if (typeof document === 'undefined') return

  const viewportMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')

  if (lockCount === 0) {
    previousViewport = viewportMeta?.content ?? null

    if (viewportMeta) {
      const normalized = viewportMeta.content
        .replace(/\s*,?\s*maximum-scale\s*=\s*[^,]+/gi, '')
        .replace(/\s*,?\s*user-scalable\s*=\s*[^,]+/gi, '')
        .trim()
        .replace(/,+$/g, '')
      viewportMeta.content = `${normalized},maximum-scale=1,user-scalable=no`
    }

    document.documentElement.classList.add('overlay-zoom-lock')
    document.addEventListener('gesturestart', preventGesture, { passive: false })
    document.addEventListener('gesturechange', preventGesture, { passive: false })
  }

  lockCount += 1
}

function releaseOverlayZoomLock() {
  if (typeof document === 'undefined') return

  lockCount = Math.max(0, lockCount - 1)
  if (lockCount > 0) return

  const viewportMeta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
  if (viewportMeta && previousViewport != null) viewportMeta.content = previousViewport

  document.documentElement.classList.remove('overlay-zoom-lock')
  document.removeEventListener('gesturestart', preventGesture)
  document.removeEventListener('gesturechange', preventGesture)
}

export function useOverlayZoomLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    applyOverlayZoomLock()
    return () => releaseOverlayZoomLock()
  }, [locked])
}
