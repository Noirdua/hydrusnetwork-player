import { useCallback, useEffect, useRef, useState } from 'react'
import { getHydrusClient } from '../../api/hydrusClient'
import { buildLibraryCacheKey, getLibraryCacheRevision, loadLibraryCache, saveLibraryCache } from '../../libraryCache'
import { subscribeLibrarySync, type LibrarySyncEvent } from '../../librarySync'
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

    const replaceTracks = (tracks: Array<Partial<Track> & Pick<Track, 'serverId' | 'fileId'>>) => {
      const serversById = new Map(serversRef.current.map((server) => [server.id, server]))
      const next: Record<string, Track> = {}
      for (const track of tracks) {
        const cacheKey = getTrackCacheKey(track.serverId, track.fileId)
        if (!cacheKey) continue
        next[cacheKey] = rebuildTrackUrls({ ...track, id: track.fileId || 0 } as Track, serversById)
      }
      allTracksRef.current = next
      applyVisibleResultsRef.current()
    }

    const restoreCachedLibrary = async () => {
      const generation = ++restoreGenerationRef.current
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
        if (cancelled || generation !== restoreGenerationRef.current) return
        replaceTracks(snapshot?.tracks || [])
        setError(null)
      } catch {
        if (cancelled || generation !== restoreGenerationRef.current) return
        allTracksRef.current = {}
        setResults([])
      } finally {
        if (!cancelled && generation === restoreGenerationRef.current) setLoading(false)
      }
    }

    const handleCacheSyncEvent = (detail: LibrarySyncEvent) => {
      if (detail.cacheKey !== serverCacheKey) return

      if (detail.phase === 'started') {
        syncHoldRef.current = true
        restoreGenerationRef.current += 1
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
        schedulePersist()
        return
      }

      restoreGenerationRef.current += 1
      replaceTracks(detail.tracks || [])
      syncHoldRef.current = false
      setError(null)
      setLoading(false)
    }

    if (boundCacheKeyRef.current !== serverCacheKey) {
      syncHoldRef.current = false
      boundCacheKeyRef.current = serverCacheKey
    }
    void restoreCachedLibrary()
    const unsubscribe = subscribeLibrarySync(handleCacheSyncEvent)
    return () => {
      cancelled = true
      unsubscribe()
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
