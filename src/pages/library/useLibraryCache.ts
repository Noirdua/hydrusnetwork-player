import { useCallback, useEffect, useRef, useState } from 'react'
import { getHydrusClient } from '../../api/hydrusClient'
import { buildLibraryCacheKey, getLibraryCacheRevision, loadLibraryCache, saveLibraryCache } from '../../libraryCache'
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
  const syncHoldRef = useRef(false)
  const restoreGenerationRef = useRef(0)
  const releaseGenerationRef = useRef(0)
  const serversRef = useRef(servers)
  serversRef.current = servers
  const hasServers = servers.length > 0
  const onlineServerIdsKey = [...onlineServerIds].sort().join(',')
  const serverCacheKey = buildLibraryCacheKey(servers)
  const boundCacheKeyRef = useRef(serverCacheKey)
  const serversUrlSignature = servers
    .map((server) => `${server.id}:${server.host}:${server.port ?? ''}:${server.ssl ? '1' : '0'}:${server.apiKey || ''}:${server.forceApiKeyInQuery ? '1' : '0'}`)
    .join('|')

  const persistAllTracks = useCallback((revision = getLibraryCacheRevision(serverCacheKey)) => {
    if (!serverCacheKey || typeof window === 'undefined' || syncHoldRef.current) return
    void saveLibraryCache(serverCacheKey, Object.values(allTracksRef.current), revision)
  }, [serverCacheKey])

  const schedulePersist = useCallback(() => {
    if (!serverCacheKey || typeof window === 'undefined' || syncHoldRef.current) return
    const revision = getLibraryCacheRevision(serverCacheKey)
    if (persistTimeoutRef.current) window.clearTimeout(persistTimeoutRef.current)
    persistTimeoutRef.current = window.setTimeout(() => {
      persistTimeoutRef.current = null
      if (syncHoldRef.current) return
      void saveLibraryCache(serverCacheKey, Object.values(allTracksRef.current), revision)
    }, 250)
  }, [serverCacheKey])

  const applyVisibleResults = useCallback(() => {
    setResults(filterVisibleTracks(Object.values(allTracksRef.current), onlineServerIds, activeServerId))
  }, [activeServerId, onlineServerIds])
  const applyVisibleResultsRef = useRef(applyVisibleResults)
  applyVisibleResultsRef.current = applyVisibleResults

  const cacheTracks = useCallback((tracks: Array<Partial<Track> & Pick<Track, 'serverId' | 'fileId'>>) => {
    for (const track of tracks) {
      const cacheKey = getTrackCacheKey(track.serverId, track.fileId)
      if (!cacheKey) continue
      const existing = allTracksRef.current[cacheKey]
      if (!existing) {
        if (!track.url) continue
        allTracksRef.current[cacheKey] = { ...track } as Track
        continue
      }
      const next = { ...existing }
      for (const [key, value] of Object.entries(track)) {
        if (value !== undefined) (next as Record<string, unknown>)[key] = value
      }
      allTracksRef.current[cacheKey] = next
    }

    applyVisibleResults()
    schedulePersist()
  }, [applyVisibleResults, schedulePersist])

  useEffect(() => {
    let cancelled = false

    const releaseHold = (generation: number) => {
      if (releaseGenerationRef.current === generation) syncHoldRef.current = false
    }

    const restoreCachedLibrary = async (releaseSyncHold = false) => {
      const generation = ++restoreGenerationRef.current
      if (releaseSyncHold) releaseGenerationRef.current = generation
      if (!hasServers || !serverCacheKey) {
        allTracksRef.current = {}
        setResults([])
        setError(null)
        setLoading(false)
        if (releaseSyncHold) releaseHold(generation)
        return
      }

      if (!healthChecksComplete) {
        setLoading(true)
        if (releaseSyncHold) releaseHold(generation)
        return
      }

      setLoading(true)

      try {
        const snapshot = await loadLibraryCache(serverCacheKey)
        if (cancelled || generation !== restoreGenerationRef.current) return

        const serversById = new Map(serversRef.current.map((server) => [server.id, server]))
        allTracksRef.current = {}
        for (const track of snapshot?.tracks || []) {
          const cacheKey = getTrackCacheKey(track.serverId, track.fileId)
          if (!cacheKey) continue
          const hydrated = rebuildTrackUrls({ ...track, id: track.fileId || 0 }, serversById)
          allTracksRef.current[cacheKey] = hydrated
        }

        applyVisibleResultsRef.current()
        setError(null)
      } catch {
        if (cancelled || generation !== restoreGenerationRef.current) return
        allTracksRef.current = {}
        setResults([])
      } finally {
        if (releaseSyncHold) releaseHold(generation)
        if (!cancelled && generation === restoreGenerationRef.current) setLoading(false)
      }
    }

    const handleCacheSyncEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ cacheKey?: string; phase?: string; error?: string }>).detail
      if (!detail || detail.cacheKey !== serverCacheKey) return

      if (detail.phase === 'started') {
        syncHoldRef.current = true
        releaseGenerationRef.current = 0
        if (persistTimeoutRef.current) {
          window.clearTimeout(persistTimeoutRef.current)
          persistTimeoutRef.current = null
        }
        setLoading(true)
        return
      }

      if (detail.phase === 'failed') {
        syncHoldRef.current = false
        if (detail.error) setError(detail.error)
        setLoading(false)
        persistAllTracks()
        return
      }

      void restoreCachedLibrary(true)
    }

    if (boundCacheKeyRef.current !== serverCacheKey) {
      syncHoldRef.current = false
      boundCacheKeyRef.current = serverCacheKey
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
        if (!syncHoldRef.current) persistAllTracks()
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
