import { clearHydrusMetadataCache, getHydrusClient, extractTitleFromTags, type ServerConfig } from './api/hydrusClient'
import { buildLibraryCacheKey, bumpLibraryCacheRevision, loadLibraryCache, pruneLibraryCache, saveLibraryCache } from './libraryCache'
import { SECTION_CONFIG } from './pages/library/libraryConfig'
import { getTrackCacheKey } from './utils/trackMetadata'
import { extractNamespaceValue } from './utils/extractNamespaceValue'
import { isBookMimeType } from './utils/bookDetection'
import { publishHydrusEpubCatalogFromTracks } from './utils/hydrusEpubCatalog'
import type { MediaSection, ServerSyncSummary, Track } from './types'

const SYNC_SECTION_LIMIT = 2000
const SYNC_SECTIONS = (Object.entries(SECTION_CONFIG) as Array<[MediaSection, (typeof SECTION_CONFIG)[MediaSection]]>)
  .filter((entry): entry is [Exclude<MediaSection, 'all' | 'books'>, (typeof SECTION_CONFIG)[MediaSection] & { systemPredicate: string }] => Boolean(entry[1].systemPredicate))
  .map(([id, config]) => ({ id, predicate: config.systemPredicate }))

export type LibrarySyncEvent = {
  cacheKey: string
  phase: 'started' | 'completed' | 'failed'
  serverIds: string[]
  error?: string
  tracks?: Track[]
}

const syncListeners = new Set<(detail: LibrarySyncEvent) => void>()

export function subscribeLibrarySync(listener: (detail: LibrarySyncEvent) => void) {
  syncListeners.add(listener)
  return () => {
    syncListeners.delete(listener)
  }
}

export type LibrarySyncServer = ServerConfig

export type LibraryCacheSyncResult = {
  cacheKey: string
  summaries: Record<string, ServerSyncSummary>
  addedCounts: Record<string, number>
  removedCounts: Record<string, number>
}

function dispatchSyncEvent(detail: LibrarySyncEvent) {
  for (const listener of syncListeners) listener(detail)
}

let syncTail: Promise<void> = Promise.resolve()

export function syncLibraryCache(servers: LibrarySyncServer[], options: { targetServerIds?: string[] } = {}): Promise<LibraryCacheSyncResult> {
  const run = syncTail.then(() => syncLibraryCacheNow(servers, options))
  syncTail = run.then(() => undefined, () => undefined)
  return run
}

async function syncLibraryCacheNow(servers: LibrarySyncServer[], options: { targetServerIds?: string[] } = {}): Promise<LibraryCacheSyncResult> {
  const cacheKey = buildLibraryCacheKey(servers)
  const targetServerIds = new Set(options.targetServerIds && options.targetServerIds.length > 0
    ? options.targetServerIds
    : servers.map((server) => server.id))
  const targetServers = servers.filter((server) => targetServerIds.has(server.id))

  if (!cacheKey || targetServers.length === 0) {
    return {
      cacheKey,
      summaries: {},
      addedCounts: {},
      removedCounts: {},
    }
  }

  const revision = bumpLibraryCacheRevision(cacheKey)
  dispatchSyncEvent({ cacheKey, phase: 'started', serverIds: targetServers.map((server) => server.id) })

  try {
    const snapshot = await loadLibraryCache(cacheKey)
    const snapshotTracks = snapshot?.tracks ?? []
    const mergedTrackMap: Record<string, Track> = {}
    const snapshotTracksByServer: Record<string, Track[]> = {}
    let localCounter = Date.now()

    for (const track of snapshotTracks) {
      const hydratedTrack: Track = { ...track, id: ++localCounter }
      const key = getTrackCacheKey(hydratedTrack.serverId, hydratedTrack.fileId)
      if (!key || !hydratedTrack.serverId) continue

      if (!snapshotTracksByServer[hydratedTrack.serverId]) {
        snapshotTracksByServer[hydratedTrack.serverId] = []
      }
      snapshotTracksByServer[hydratedTrack.serverId].push(hydratedTrack)

      if (!targetServerIds.has(hydratedTrack.serverId)) {
        mergedTrackMap[key] = hydratedTrack
      }
    }

    const summaries: Record<string, ServerSyncSummary> = {}
    const addedCounts: Record<string, number> = {}
    const removedCounts: Record<string, number> = {}

    for (const server of targetServers) {
      const previousTracks = snapshotTracksByServer[server.id] ?? []
      const previousServerTrackKeys = new Set(previousTracks.map((track) => getTrackCacheKey(track.serverId, track.fileId)).filter(Boolean))
      const currentServerTrackKeys = new Set<string>()
      const counts: ServerSyncSummary['counts'] = {}
      const truncationWarnings: string[] = []

      try {
        const client = getHydrusClient(server)
        clearHydrusMetadataCache(server.id)

        for (const section of SYNC_SECTIONS) {
          const searchTags = [section.predicate]
          const ids = await client.searchFiles(searchTags, SYNC_SECTION_LIMIT)

          if (ids.length >= SYNC_SECTION_LIMIT) {
            truncationWarnings.push(`${section.id} capped at ${SYNC_SECTION_LIMIT}`)
          }

          if (ids.length === 0) {
            counts[section.id] = counts[section.id] ?? 0
            continue
          }

          const metadataMap = await client.getFilesMetadata(ids, 6)
          let sectionCount = 0
          let bookCount = 0

          for (const fileId of ids) {
            const metadata = metadataMap[fileId]
            if (!metadata) continue
            const tags = metadata.tags || []
            const key = getTrackCacheKey(server.id, fileId)
            if (!key) continue

            const isBook = isBookMimeType(metadata.mimeType)
            const mediaKind: MediaSection = isBook ? 'books' : section.id
            if (isBook) bookCount += 1
            else sectionCount += 1

            currentServerTrackKeys.add(key)
            mergedTrackMap[key] = {
              id: ++localCounter,
              fileId,
              serverId: server.id,
              serverName: server.name || server.host,
              title: extractTitleFromTags(tags) || '',
              artist: isBook
                ? (extractNamespaceValue(tags, 'author') || extractNamespaceValue(tags, 'creator') || undefined)
                : (extractNamespaceValue(tags, 'artist') || undefined),
              album: isBook
                ? (extractNamespaceValue(tags, 'series') || extractNamespaceValue(tags, 'collection') || undefined)
                : (extractNamespaceValue(tags, 'album') || undefined),
              tags: tags.length ? tags : undefined,
              url: client.getFileUrl(fileId),
              thumbnail: client.getThumbnailUrl(fileId),
              hasThumbnail: metadata.hasThumbnail,
              mimeType: metadata.mimeType,
              isVideo: metadata.isVideo ?? (section.id === 'video' ? true : undefined),
              duration: metadata.durationMs,
              mediaKind,
            }
          }

          counts[section.id] = (counts[section.id] ?? 0) + sectionCount
          if (bookCount > 0) counts.books = (counts.books ?? 0) + bookCount
        }

        if (truncationWarnings.length) {
          for (const track of previousTracks) {
            const key = getTrackCacheKey(track.serverId, track.fileId)
            if (!key || currentServerTrackKeys.has(key)) continue
            currentServerTrackKeys.add(key)
            mergedTrackMap[key] = track
          }
        }

        const total = Object.values(counts).reduce((sum, value) => sum + (value || 0), 0)
        addedCounts[server.id] = Array.from(currentServerTrackKeys).filter((key) => !previousServerTrackKeys.has(key)).length
        removedCounts[server.id] = truncationWarnings.length
          ? 0
          : Array.from(previousServerTrackKeys).filter((key) => !currentServerTrackKeys.has(key)).length
        summaries[server.id] = {
          updatedAt: Date.now(),
          total,
          counts,
          ...(truncationWarnings.length ? { message: `Sync truncated: ${truncationWarnings.join(', ')}.` } : {}),
        }
      } catch (error: unknown) {
        for (const track of previousTracks) {
          const key = getTrackCacheKey(track.serverId, track.fileId)
          if (!key) continue
          mergedTrackMap[key] = track
        }

        addedCounts[server.id] = 0
        removedCounts[server.id] = 0
        const message = error instanceof Error ? error.message : String(error)
        summaries[server.id] = {
          updatedAt: Date.now(),
          total: previousTracks.length,
          counts: {},
          message: `Sync failed: ${message}`,
        }
      }
    }

    const mergedTracks = Object.values(mergedTrackMap)
    await saveLibraryCache(cacheKey, mergedTracks, revision)
    await pruneLibraryCache(cacheKey).catch(() => undefined)
    void publishHydrusEpubCatalogFromTracks(mergedTracks).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn('[librarySync] Thorium EPUB catalog publish failed:', message)
    })
    dispatchSyncEvent({
      cacheKey,
      phase: 'completed',
      serverIds: targetServers.map((server) => server.id),
      tracks: mergedTracks,
    })

    return {
      cacheKey,
      summaries,
      addedCounts,
      removedCounts,
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    dispatchSyncEvent({ cacheKey, phase: 'failed', serverIds: targetServers.map((server) => server.id), error: message })
    throw error
  }
}
