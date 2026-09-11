import { useCallback, useEffect, useRef, useState } from 'react'
import { getHydrusClient } from '../../api/hydrusClient'
import { buildLibraryCacheKey, loadLibraryCache, saveLibraryCache } from '../../libraryCache'
import { LIBRARY_CACHE_SYNC_EVENT } from '../../librarySync'
import { getTrackCacheKey } from '../../utils/trackMetadata'
import type { Track } from '../../types'

type CacheServer = {
  id: string
  host: string
  port?: string | number
  ssl?: boolean
  apiKey?: string
  name?: string
  forceApiKeyInQuery?: boolean
}

type UseLibraryCacheOptions = {
  servers: CacheServer[]
  onlineServerIds: string[]
  healthChecksComplete: boolean
  activeServerId: string | null
}

function filterVisibleTracks(tracks: Track[], onlineServerIds: string[], activeServerId: string | null) {
  const onlineServerIdSet = new Set(onlineServerIds)
  return tracks.filter((track) => (
    track.serverId
    && onlineServerIdSet.has(track.serverId)
    && (!activeServerId || track.serverId === activeServerId)
  ))
}

function rebuildTrackUrls(track: Track, serversById: Map<string, CacheServer>): Track {
  if (!track.serverId || track.fileId == null) return track
  const server = serversById.get(track.serverId)
  if (!server?.host) return track

  try {
    const client = getHydrusClient(server)
    return {
      ...track,
      url: client.getFileUrl(track.fileId),
      thumbnail: client.getThumbnailUrl(track.fileId),
    }
  } catch {
    return track
  }
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
  const allTracksRef = useRef<Record<string, Track>>({})
  const persistTimeoutRef = useRef<number | null>(null)
  const serversRef = useRef(servers)
  serversRef.current = servers
  const hasServers = servers.length > 0
  const onlineServerIdsKey = [...onlineServerIds].sort().join(',')
  const serverCacheKey = buildLibraryCacheKey(servers)
  const serversUrlSignature = servers
    .map((server) => `${server.id}:${server.host}:${server.port ?? ''}:${server.ssl ? '1' : '0'}:${server.apiKey || ''}:${server.forceApiKeyInQuery ? '1' : '0'}`)
    .join('|')

  const persistAllTracks = useCallback(() => {
    if (!serverCacheKey || typeof window === 'undefined') return
    void saveLibraryCache(serverCacheKey, Object.values(allTracksRef.current))
  }, [serverCacheKey])

  const applyVisibleResults = useCallback(() => {
    setResults(filterVisibleTracks(Object.values(allTracksRef.current), onlineServerIds, activeServerId))
  }, [activeServerId, onlineServerIds])
  const applyVisibleResultsRef = useRef(applyVisibleResults)
  applyVisibleResultsRef.current = applyVisibleResults

  const cacheTracks = useCallback((tracks: Track[]) => {
    for (const track of tracks) {
      const cacheKey = getTrackCacheKey(track.serverId, track.fileId)
      if (!cacheKey) continue
      const existing = allTracksRef.current[cacheKey]
      allTracksRef.current[cacheKey] = existing ? { ...existing, ...track } : { ...track }
    }

    applyVisibleResults()

    if (!serverCacheKey || typeof window === 'undefined') return

    if (persistTimeoutRef.current) {
      window.clearTimeout(persistTimeoutRef.current)
    }

    persistTimeoutRef.current = window.setTimeout(() => {
      persistTimeoutRef.current = null
      persistAllTracks()
    }, 250)
  }, [applyVisibleResults, persistAllTracks, serverCacheKey])

  useEffect(() => {
    let cancelled = false

    const restoreCachedLibrary = async () => {
      if (!hasServers || !serverCacheKey) {
        allTracksRef.current = {}
        setResults([])
        setError(null)
        setLoading(false)
        return
      }

      if (!healthChecksComplete) {
        setLoading(true)
        return
      }

      setLoading(true)

      try {
        const snapshot = await loadLibraryCache(serverCacheKey)
        if (cancelled) return

        const serversById = new Map(serversRef.current.map((server) => [server.id, server]))
        allTracksRef.current = {}
        for (const track of snapshot?.tracks || []) {
          const cacheKey = getTrackCacheKey(track.serverId, track.fileId)
          if (!cacheKey) continue
          const hydrated = rebuildTrackUrls({ ...track, id: track.fileId || 0 }, serversById)
          allTracksRef.current[cacheKey] = hydrated
        }

        if (!cancelled) {
          applyVisibleResultsRef.current()
          setError(null)
        }
      } catch {
        if (cancelled) return
        allTracksRef.current = {}
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

      if (detail.phase === 'failed') {
        if (detail.error) setError(detail.error)
        setLoading(false)
        return
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
  }, [hasServers, healthChecksComplete, serverCacheKey, serversUrlSignature])

  useEffect(() => {
    if (!healthChecksComplete) return
    applyVisibleResults()
  }, [applyVisibleResults, healthChecksComplete, onlineServerIdsKey])

  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current && typeof window !== 'undefined') {
        window.clearTimeout(persistTimeoutRef.current)
        persistTimeoutRef.current = null
        persistAllTracks()
      }
    }
  }, [persistAllTracks])

  return {
    results,
    loading,
    error,
    hasServers,
    cacheTracks,
  }
}
