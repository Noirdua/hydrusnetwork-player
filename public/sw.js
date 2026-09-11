const CACHE_NAME = 'api-mediaplayer-v2'
const MEDIA_CACHE_NAME = 'api-mediaplayer-media-v2'
const ASSETS = ['/', '/index.html', '/manifest.json', '/no-image.svg']
const MAX_MEDIA_CACHE_ITEMS = 12

function isNavigationRequest(request, acceptHeader) {
  if (!request) return false
  return request.mode === 'navigate' || acceptHeader.includes('text/html')
}

function getRangeBounds(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader || '')
  if (!match) return null

  let start = match[1] ? Number(match[1]) : NaN
  let end = match[2] ? Number(match[2]) : NaN

  if (Number.isNaN(start) && Number.isNaN(end)) return null
  if (Number.isNaN(start)) {
    const suffixLength = end
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
    start = Math.max(size - suffixLength, 0)
    end = size - 1
  } else {
    if (!Number.isFinite(start) || start < 0 || start >= size) return null
    if (Number.isNaN(end) || end >= size) end = size - 1
  }

  if (end < start) return null
  return { start, end }
}

async function trimMediaCache(cache) {
  const keys = await cache.keys()
  if (keys.length <= MAX_MEDIA_CACHE_ITEMS) return

  const overflow = keys.length - MAX_MEDIA_CACHE_ITEMS
  for (let index = 0; index < overflow; index += 1) {
    await cache.delete(keys[index])
  }
}

async function createRangeResponse(cachedResponse, rangeHeader) {
  const blob = await cachedResponse.blob()
  const size = blob.size
  const bounds = getRangeBounds(rangeHeader, size)

  if (!bounds) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` }
    })
  }

  const { start, end } = bounds
  const slice = blob.slice(start, end + 1)
  const headers = new Headers(cachedResponse.headers)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Content-Length', String(end - start + 1))
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`)

  return new Response(slice, {
    status: 206,
    statusText: 'Partial Content',
    headers,
  })
}

function isHydrusFileRequest(url) {
  return /\/get_files\/(file|thumbnail)\?/i.test(url || '')
}

function isThumbnailRequest(url) {
  return /\/get_files\/thumbnail\?/i.test(url || '')
}

async function handleMediaRequest(event) {
  const rangeHeader = event.request.headers && event.request.headers.get && event.request.headers.get('range')
  if (rangeHeader || isHydrusFileRequest(event.request.url)) {
    return fetch(event.request)
  }

  const mediaCache = await caches.open(MEDIA_CACHE_NAME)
  const cacheKey = event.request.url
  const cached = await mediaCache.match(cacheKey).catch(() => null)
  if (cached) return cached

  const networkResponse = await fetch(event.request)

  if (networkResponse.ok && networkResponse.status === 200 && !isThumbnailRequest(event.request.url)) {
    event.waitUntil(
      mediaCache.put(cacheKey, networkResponse.clone()).then(() => trimMediaCache(mediaCache)).catch(() => undefined)
    )
  }

  return networkResponse
}

async function updateShellCache(cache, response) {
  if (!response || !response.ok || response.status !== 200) return

  await Promise.allSettled([
    cache.put('/index.html', response.clone()),
    cache.put('/', response.clone()),
  ])
}

async function handleShellRequest(event) {
  const appCache = await caches.open(CACHE_NAME)

  try {
    const networkResponse = await fetch(event.request)
    event.waitUntil(updateShellCache(appCache, networkResponse.clone()))
    return networkResponse
  } catch {
    const cachedIndex = await appCache.match('/index.html').catch(() => null)
    if (cachedIndex) return cachedIndex

    const cachedRoot = await appCache.match('/').catch(() => null)
    if (cachedRoot) return cachedRoot

    return new Response('Network error', { status: 502, statusText: 'Bad Gateway' })
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => (k !== CACHE_NAME && k !== MEDIA_CACHE_NAME ? caches.delete(k) : Promise.resolve())))).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return

  const url = event.request.url || ''
  const acceptHeader = (event.request.headers && event.request.headers.get && event.request.headers.get('accept')) || ''
  const destination = event.request.destination || ''
  const hasRangeHeader = event.request.headers && event.request.headers.get && event.request.headers.get('range')
  const isNativeVideoBypass = /(?:\?|&)_native_video=1(?:&|$)/i.test(url)
  const isVideoRequest = destination === 'video' || /video\//i.test(acceptHeader)
  const isAudioRequest = destination === 'audio' || /audio\//i.test(acceptHeader)
  const isMediaRequest = isVideoRequest
    || isAudioRequest
    || /\.(m3u8|mp4|webm|ogg|mov)(\?|$)/i.test(url)

  if (isNativeVideoBypass || isVideoRequest) {
    event.respondWith(fetch(event.request))
    return
  }

  if (isMediaRequest || hasRangeHeader) {
    event.respondWith(handleMediaRequest(event))
    return
  }

  if (isNavigationRequest(event.request, acceptHeader)) {
    event.respondWith(handleShellRequest(event))
    return
  }

  event.respondWith((async () => {
    try {
      const cached = await caches.match(event.request).catch(() => null)
      if (cached) return cached

      try {
        const response = await fetch(event.request)
        return response
      } catch (networkErr) {
        // On network failure, provide a graceful fallback for images and navigation
        try {
          const dest = event.request.destination || ''
          const url = event.request.url || ''

          // Image fallback
          if (dest === 'image' || /\.(png|jpe?g|gif|svg|webp)(\?|$)/i.test(url)) {
            const fallback = await caches.match('/no-image.svg').catch(() => null)
            if (fallback) return fallback
            return new Response("<svg xmlns='http://www.w3.org/2000/svg' width='300' height='140'><rect fill='%23eee' width='100%' height='100%'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='%23666' font-family='Arial, sans-serif' font-size='20'>No Image</text></svg>", { headers: { 'Content-Type': 'image/svg+xml' } })
          }

          // Navigation fallback (HTML)
          if (event.request.mode === 'navigate' || (event.request.headers && event.request.headers.get && event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html'))) {
            const index = await caches.match('/index.html').catch(() => null)
            if (index) return index
          }
        } catch (e) {
          console.error('SW network error fallback failed', e)
        }

        return new Response('Network error', { status: 502, statusText: 'Bad Gateway' })
      }
    } catch (e) {
      console.error('SW fetch handler error', e)
      return new Response('SW internal error', { status: 500 })
    }
  })())
})

// Support skip waiting via message
self.addEventListener('message', (event) => {
  if (event && event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
