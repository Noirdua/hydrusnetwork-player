// ==UserScript==
// @name         API Media Player: Open in mpv
// @namespace    https://local.api-media-player
// @version      0.1.0
// @description  Redirect direct media playback from this app into mpv instead of playing inside the browser.
// @match        *://*/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

(() => {
  const RECENT_OPEN_WINDOW_MS = 1500
  const DIRECT_MEDIA_EXTENSION = /\.(mp4|m4v|mkv|webm|mov|mp3|m4a|flac|ogg|opus|wav|aac)(?:$|[?#])/i
  const PRIVATE_IPV4_HOST = /^(?:10\.|127\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/
  const LOCAL_HOST_SUFFIX = /(?:\.local|\.lan)$/i

  let lastOpenedUrl = ''
  let lastOpenedAt = 0

  function isAllowedHost(hostname) {
    return hostname === 'localhost'
      || hostname === '[::1]'
      || PRIVATE_IPV4_HOST.test(hostname)
      || LOCAL_HOST_SUFFIX.test(hostname)
  }

  function getMediaUrlFromElement(element) {
    if (!element) return ''
    return element.currentSrc
      || element.src
      || element.getAttribute('src')
      || element.querySelector('source[src]')?.getAttribute('src')
      || ''
  }

  function isDirectMediaUrl(rawUrl) {
    if (!rawUrl) return false

    try {
      const url = new URL(rawUrl, location.href)
      if (!/^https?:$/i.test(url.protocol)) return false

      return DIRECT_MEDIA_EXTENSION.test(url.pathname)
        || /\/get_files\/file$/i.test(url.pathname)
        || url.searchParams.has('file_id')
    } catch {
      return false
    }
  }

  function encodeUrlSafeBase64(value) {
    const bytes = new TextEncoder().encode(value)
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return btoa(binary).replace(/\//g, '_').replace(/\+/g, '-').replace(/=+$/g, '')
  }

  function looksLikeVideo(url, element) {
    if (element?.tagName === 'VIDEO') return true

    try {
      const pathname = new URL(url, location.href).pathname
      return /\.(mp4|m4v|mkv|webm|mov)$/i.test(pathname)
    } catch {
      return false
    }
  }

  function buildIntentStringExtra(key, value) {
    const trimmed = (value || '').trim()
    if (!trimmed) return ''
    return `;S.${key}=${encodeURIComponent(trimmed)}`
  }

  function isUsableTitle(title, url) {
    const trimmed = (title || '').trim()
    if (!trimmed) return false
    if (trimmed === url) return false
    if (/^https?:\/\//i.test(trimmed)) return false
    return true
  }

  function extractFallbackTitle(url) {
    try {
      const parsed = new URL(url, location.href)
      const hydrusFileId = parsed.searchParams.get('file_id')
      if (hydrusFileId) return `Hydrus File ${hydrusFileId}`

      const segments = parsed.pathname.split('/').filter(Boolean)
      const lastSegment = segments[segments.length - 1]
      return lastSegment ? decodeURIComponent(lastSegment) : 'Media'
    } catch {
      return 'Media'
    }
  }

  function buildMediaMetadata(url, element) {
    const candidates = [
      element?.getAttribute?.('data-title') || '',
      element?.getAttribute?.('title') || '',
      element?.getAttribute?.('aria-label') || '',
      element?.textContent || '',
      document.title || '',
    ]

    const title = candidates.find((candidate) => isUsableTitle(candidate, url)) || extractFallbackTitle(url)
    return { title }
  }

  function buildDesktopMpvUrl(url, metadata) {
    const encodedUrl = encodeUrlSafeBase64(url)
    const queryParts = ['enqueue=append']
    if (metadata.title) {
      queryParts.push(`v_title=${encodeUrlSafeBase64(metadata.title)}`)
    }
    const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : ''
    return `mpv-handler://play/${encodedUrl}/${query}`
  }

  function buildAndroidMpvUrl(url, element, metadata) {
    try {
      const parsed = new URL(url, location.href)
      const scheme = parsed.protocol.replace(':', '') || 'https'
      const intentPath = `${parsed.host}${parsed.pathname}${parsed.search}`
      const mimeType = looksLikeVideo(url, element) ? 'video/*' : 'audio/*'
      return `intent://${intentPath}#Intent;scheme=${scheme};package=is.xyz.mpv;action=android.intent.action.VIEW;type=${mimeType}${buildIntentStringExtra('title', metadata.title)};end`
    } catch {
      return url
    }
  }

  function buildExternalPlayerUrl(url, metadata, element) {
    if (/Android/i.test(navigator.userAgent || '')) {
      return buildAndroidMpvUrl(url, element, metadata)
    }

    return buildDesktopMpvUrl(url, metadata)
  }

  function openInExternalPlayer(url, element) {
    const now = Date.now()
    if (url === lastOpenedUrl && now - lastOpenedAt < RECENT_OPEN_WINDOW_MS) {
      return
    }

    lastOpenedUrl = url
    lastOpenedAt = now

    const metadata = buildMediaMetadata(url, element)
    const targetUrl = buildExternalPlayerUrl(url, metadata, element)
    location.assign(targetUrl)
  }

  function shouldInterceptCurrentPage() {
    return isAllowedHost(location.hostname)
  }

  function rejectPlaybackRedirect() {
    return Promise.reject(new DOMException('Playback redirected to external player', 'AbortError'))
  }

  function interceptElementPlayback(element) {
    if (!shouldInterceptCurrentPage()) return false

    const mediaUrl = getMediaUrlFromElement(element)
    if (!isDirectMediaUrl(mediaUrl)) return false

    try { element.pause() } catch {}
    try { element.removeAttribute('src') } catch {}
    try { element.load() } catch {}

    openInExternalPlayer(mediaUrl, element)
    return true
  }

  const originalPlay = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function play(...args) {
    if (interceptElementPlayback(this)) {
      return rejectPlaybackRedirect()
    }

    return originalPlay.apply(this, args)
  }

  document.addEventListener('click', (event) => {
    if (!shouldInterceptCurrentPage()) return

    const target = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!target) return

    const href = target.getAttribute('href') || ''
    if (!isDirectMediaUrl(href)) return

    event.preventDefault()
    event.stopPropagation()
    openInExternalPlayer(href)
  }, true)
})()