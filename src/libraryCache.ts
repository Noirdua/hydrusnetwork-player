import type { Track } from './types'
import { withStore } from './utils/indexedDb'

type CacheServerDescriptor = {
  id: string
  host: string
  port?: string | number
  ssl?: boolean
}

type PersistedTrack = Omit<Track, 'id'>

type LibraryCacheRecord = {
  cacheKey: string
  updatedAt: number
  tracks: PersistedTrack[]
}

export type LibraryCacheSnapshot = {
  tracks: PersistedTrack[]
}

export type LibraryCacheStats = {
  snapshotCount: number
  staleSnapshotCount: number
  totalBytes: number
  activeBytes: number
  trackCount: number
  updatedAt: number | null
}

const DB_CONFIG = {
  name: 'api-mediaplayer-library-cache',
  version: 1,
  storeName: 'snapshots',
  keyPath: 'cacheKey',
}
const MAX_TRACKS_PER_KIND = 2500
const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null

export function buildLibraryCacheKey(servers: CacheServerDescriptor[]) {
  return servers.map((server) => `${server.id}:${server.host}:${server.port ?? ''}:${server.ssl ? 'https' : 'http'}`).join('|')
}

function estimateRecordBytes(record: LibraryCacheRecord) {
  const payload = JSON.stringify(record)
  if (!textEncoder) return payload.length
  return textEncoder.encode(payload).length
}

async function listLibraryCacheRecords(): Promise<LibraryCacheRecord[]> {
  if (typeof indexedDB === 'undefined') return []
  const records = await withStore<LibraryCacheRecord[]>(DB_CONFIG, 'readonly', (store) => store.getAll())
  return Array.isArray(records) ? records : []
}

export async function loadLibraryCache(cacheKey: string): Promise<LibraryCacheSnapshot | null> {
  if (!cacheKey || typeof indexedDB === 'undefined') return null

  const record = await withStore<LibraryCacheRecord | undefined>(DB_CONFIG, 'readonly', (store) => store.get(cacheKey))
  if (!record) return null

  return {
    tracks: Array.isArray(record.tracks) ? record.tracks : [],
  }
}

export async function pruneLibraryCache(activeCacheKey: string) {
  if (!activeCacheKey || typeof indexedDB === 'undefined') return 0

  const records = await listLibraryCacheRecords()
  const staleKeys = records
    .map((record) => record.cacheKey)
    .filter((cacheKey) => cacheKey !== activeCacheKey)

  if (staleKeys.length === 0) return 0

  await Promise.all(staleKeys.map((cacheKey) => withStore(DB_CONFIG, 'readwrite', (store) => store.delete(cacheKey))))
  return staleKeys.length
}

export async function getLibraryCacheStats(activeCacheKey: string): Promise<LibraryCacheStats> {
  if (!activeCacheKey || typeof indexedDB === 'undefined') {
    return {
      snapshotCount: 0,
      staleSnapshotCount: 0,
      totalBytes: 0,
      activeBytes: 0,
      trackCount: 0,
      updatedAt: null,
    }
  }

  const records = await listLibraryCacheRecords()
  const activeRecord = records.find((record) => record.cacheKey === activeCacheKey)

  return {
    snapshotCount: records.length,
    staleSnapshotCount: records.filter((record) => record.cacheKey !== activeCacheKey).length,
    totalBytes: records.reduce((sum, record) => sum + estimateRecordBytes(record), 0),
    activeBytes: activeRecord ? estimateRecordBytes(activeRecord) : 0,
    trackCount: activeRecord?.tracks.length ?? 0,
    updatedAt: activeRecord?.updatedAt ?? null,
  }
}

export async function saveLibraryCache(cacheKey: string, tracks: Track[]) {
  if (!cacheKey || typeof indexedDB === 'undefined') return

  const validTracks = tracks.filter((track) => track.serverId && track.fileId != null && track.url)
  const tracksByKind = new Map<string, Track[]>()
  for (const track of validTracks) {
    const kind = track.mediaKind || 'all'
    const bucket = tracksByKind.get(kind) || []
    bucket.push(track)
    tracksByKind.set(kind, bucket)
  }

  const trimmedTracks = Array.from(tracksByKind.values())
    .flatMap((bucket) => bucket.slice(-MAX_TRACKS_PER_KIND))
    .map(({ id: _id, ...track }) => track)

  const record: LibraryCacheRecord = {
    cacheKey,
    updatedAt: Date.now(),
    tracks: trimmedTracks,
  }

  await withStore(DB_CONFIG, 'readwrite', (store) => store.put(record))
  await pruneLibraryCache(cacheKey)
}
