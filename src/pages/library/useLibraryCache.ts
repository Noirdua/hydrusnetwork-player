import { useCallback, useEffect, useRef, useState } from 'react'
import { buildLibraryCacheKey, loadLibraryCache, saveLibraryCache } from '../../libraryCache'
import { LIBRARY_CACHE_SYNC_EVENT } from '../../librarySync'
import { getTrackCacheKey } from '../../utils/trackMetadata'
import type { Track } from '../../types'

type UseLibraryCacheOptions = {
  servers: Array<{ id: string; host: string; port?: string | number; ssl?: boolean }>
  onlineServerIds: string[]
  healthChecksComplete: boolean
  activeServerId: string | null
}

export function useLibraryCache({
  servers,
  onlineServerIds,
  healthChecksComplete,
  activeServerId,
}: UseLibraryCacheOptions) {
  const [results, setResults] = useState<Track[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trackCacheRef = useRef<Record<string, Track>>({})
  const persistTimeoutRef = useRef<number | null>(null)
  const hasServers = servers.length > 0
  const onlineServerIdsKey = [...onlineServerIds].sort().join(',')
  const serverCacheKey = buildLibraryCacheKey(servers)

  const cacheTracks = useCallback((tracks: Track[]) => {
    for (const track of tracks) {
      const cacheKey = getTrackCacheKey(track.serverId, track.fileId)
      if (!cacheKey) continue
      const existing = trackCacheRef.current[cacheKey]
      trackCacheRef.current[cacheKey] = existing ? { ...existing, ...track } : { ...track }
    }

    setResults(Object.values(trackCacheRef.current))

    if (!serverCacheKey || typeof window === 'undefined') return

    if (persistTimeoutRef.current) {
      window.clearTimeout(persistTimeoutRef.current)
    }

    persistTimeoutRef.current = window.setTimeout(() => {
      persistTimeoutRef.current = null
      void saveLibraryCache(serverCacheKey, Object.values(trackCacheRef.current))
    }, 250)
  }, [serverCacheKey])

  useEffect(() => {
    let cancelled = false

    const restoreCachedLibrary = async () => {
      setLoading(hasServers)

      if (!hasServers || !serverCacheKey) {
        trackCacheRef.current = {}
        setResults([])
        setError(null)
        setLoading(false)
        return
      }

      if (!healthChecksComplete) {
        trackCacheRef.current = {}
        setResults([])
        setError(null)
        setLoading(true)
        return
      }

      if (onlineServerIds.length === 0) {
        trackCacheRef.current = {}
        setResults([])
        setError(null)
        setLoading(false)
        return
      }

      try {
        const snapshot = await loadLibraryCache(serverCacheKey)
        if (cancelled) return

        trackCacheRef.current = {}
        const onlineServerIdSet = new Set(onlineServerIds)

        let localCounter = Date.now()
        const hydratedTracks = (snapshot?.tracks || [])
          .filter((track) => track.serverId && onlineServerIdSet.has(track.serverId) && (!activeServerId || track.serverId === activeServerId))
          .map((track) => ({ ...track, id: ++localCounter }))
        for (const track of hydratedTracks) {
          const cacheKey = getTrackCacheKey(track.serverId, track.fileId)
          if (cacheKey) trackCacheRef.current[cacheKey] = track
        }

        if (!cancelled) {
          setResults(hydratedTracks)
          setError(null)
        }
      } catch {
        if (cancelled) return
        trackCacheRef.current = {}
        setResults([])
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    const handleCacheSyncEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ cacheKey?: string; phase?: string; error?: string }>).detail
      if (!detail || detail.cacheKey !== serverCacheKey) return

      if (detail.phase === 'started') {
        setLoading(true)
        return
      }

      if (detail.phase === 'failed' && detail.error) {
        setError(detail.error)
      }

      void restoreCachedLibrary()
    }

    void restoreCachedLibrary()
    if (typeof window !== 'undefined') {
      window.addEventListener(LIBRARY_CACHE_SYNC_EVENT, handleCacheSyncEvent as EventListener)
    }

    return () => {
      cancelled = true
      if (typeof window !== 'undefined') {
        window.removeEventListener(LIBRARY_CACHE_SYNC_EVENT, handleCacheSyncEvent as EventListener)
      }
    }
  }, [activeServerId, hasServers, healthChecksComplete, onlineServerIdsKey, serverCacheKey])

  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current && typeof window !== 'undefined') {
        window.clearTimeout(persistTimeoutRef.current)
      }
    }
  }, [])

  return {
    results,
    loading,
    error,
    hasServers,
    cacheTracks,
  }
}
