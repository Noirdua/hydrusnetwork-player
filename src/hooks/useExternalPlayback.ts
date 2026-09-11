import { useCallback, useEffect, useRef } from 'react'
import { addDevLog } from '../debugLog'
import type { Track } from '../types'
import {
  VIDEO_URL_PATTERN,
  getPreferredExternalPlayer,
  isPlayableMediaTrack,
} from '../utils/externalPlayers'
import { isPdfTrack, isThoriumReadableTrack, openInBrowserReader, openInThoriumReader } from '../utils/thoriumReader'

type MediaInfo = {
  mimeType?: string
  isVideo?: boolean
}

export function useExternalPlayback({
  isAppleMobileOrTablet,
  isAndroidMobileOrTablet,
}: {
  isAppleMobileOrTablet: boolean
  isAndroidMobileOrTablet: boolean
}) {
  const mimeCacheRef = useRef<Record<string, MediaInfo>>({})
  const mimeRequestCacheRef = useRef<Record<string, Promise<MediaInfo>>>({})
  const playRequestAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      try { playRequestAbortRef.current?.abort() } catch {}
    }
  }, [])

  const openInPreferredExternalPlayer = useCallback((track: Track) => {
    if (isThoriumReadableTrack(track)) {
      addDevLog({
        kind: 'debug',
        category: 'playback',
        message: 'Opening book in Thorium Web',
        details: {
          trackId: track.id,
          fileId: track.fileId,
          mimeType: track.mimeType,
          href: track.url,
        }
      })
      void openInThoriumReader(track)
      return
    }

    if (isPdfTrack(track)) {
      addDevLog({
        kind: 'debug',
        category: 'playback',
        message: 'Opening PDF in browser reader',
        details: {
          trackId: track.id,
          fileId: track.fileId,
          mimeType: track.mimeType,
          href: track.url,
        }
      })
      openInBrowserReader(track)
      return
    }

    if (!isPlayableMediaTrack(track)) {
      addDevLog({
        kind: 'debug',
        category: 'playback',
        message: 'Opening non-media file in browser tab',
        details: {
          trackId: track.id,
          fileId: track.fileId,
          mimeType: track.mimeType,
          href: track.url,
        }
      })
      const openedWindow = window.open(track.url, '_blank', 'noopener,noreferrer')
      if (!openedWindow) {
        window.location.href = track.url
      }
      return
    }

    const target = getPreferredExternalPlayer(track, { isAppleMobileOrTablet, isAndroidMobileOrTablet })
    addDevLog({
      kind: 'debug',
      category: 'playback',
      message: `Opening track in ${target.appName}`,
      details: {
        trackId: track.id,
        fileId: track.fileId,
        mimeType: track.mimeType,
        href: target.href,
        appName: target.appName,
      }
    })
    window.location.href = target.href
  }, [isAndroidMobileOrTablet, isAppleMobileOrTablet])

  const fetchMediaInfo = useCallback(async (track: Track, signal?: AbortSignal): Promise<MediaInfo> => {
    try {
      let res = await fetch(track.url, { method: 'HEAD', mode: 'cors', signal })
      if (!res.ok) {
        res = await fetch(track.url, { method: 'GET', mode: 'cors', headers: { Range: 'bytes=0-0' }, signal })
        try { await res.body?.cancel() } catch {}
      }

      const mimeType = res.headers.get('content-type') || undefined
      const isVideo = !!mimeType && (mimeType.startsWith('video/') || mimeType.includes('mpegurl'))
      const mediaInfo = { mimeType, isVideo: isVideo || undefined }
      mimeCacheRef.current[track.url] = mediaInfo
      return mediaInfo
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      return {}
    }
  }, [])

  const resolveMediaInfo = useCallback(async (track: Track, signal?: AbortSignal): Promise<MediaInfo> => {
    if (track.mimeType || track.isVideo !== undefined) {
      return { mimeType: track.mimeType, isVideo: track.isVideo }
    }

    const cachedInfo = mimeCacheRef.current[track.url]
    if (cachedInfo) return cachedInfo

    if (VIDEO_URL_PATTERN.test(track.url)) {
      const inferredInfo = { isVideo: true }
      mimeCacheRef.current[track.url] = inferredInfo
      return inferredInfo
    }

    if (signal) {
      return fetchMediaInfo(track, signal)
    }

    const pendingRequest = mimeRequestCacheRef.current[track.url]
    if (pendingRequest) return pendingRequest

    const request = (async () => {
      try {
        return await fetchMediaInfo(track)
      } finally {
        delete mimeRequestCacheRef.current[track.url]
      }
    })()

    mimeRequestCacheRef.current[track.url] = request
    return request
  }, [fetchMediaInfo])

  const playNow = useCallback(async (track: Track) => {
    try { playRequestAbortRef.current?.abort() } catch {}
    const controller = new AbortController()
    playRequestAbortRef.current = controller

    const cachedInfo = track.mimeType || track.isVideo !== undefined
      ? { mimeType: track.mimeType, isVideo: track.isVideo }
      : mimeCacheRef.current[track.url] || (VIDEO_URL_PATTERN.test(track.url) ? { isVideo: true } : undefined)

    let resolved = cachedInfo ? { ...track, ...cachedInfo } : track

    if (!cachedInfo) {
      try {
        const mediaInfo = await resolveMediaInfo(track, controller.signal)
        if (controller.signal.aborted) return
        resolved = { ...track, ...mediaInfo }
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') return
        addDevLog({
          kind: 'debug',
          category: 'playback',
          message: 'Media info resolution failed',
          details: {
            trackId: track.id,
            fileId: track.fileId,
            name: error instanceof Error ? error.name : undefined,
            message: error instanceof Error ? error.message : String(error),
          }
        })
      }
    }

    openInPreferredExternalPlayer(resolved)
  }, [openInPreferredExternalPlayer, resolveMediaInfo])

  return { playNow }
}
