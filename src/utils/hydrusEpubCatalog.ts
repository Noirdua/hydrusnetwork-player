import { extractTitleFromTags, getHydrusClient, type ServerConfig } from '../api/hydrusClient'
import { addDevLog } from '../debugLog'
import { loadLibraryCache } from '../libraryCache'
import type { Track } from '../types'
import { extractNamespaceValue } from './extractNamespaceValue'
import { encodeUrlSafeBase64, registerThoriumSource } from './thoriumReader'

const CATALOG_LIMIT = 200

export type HydrusCatalogPublication = {
  title: string
  author: string
  cover: string
  url: string
  rendition: string
  source: string
}

function isEpubTrack(track: Pick<Track, 'mimeType' | 'tags' | 'url'>) {
  const mime = (track.mimeType || '').toLowerCase()
  if (mime.includes('epub')) return true
  const tags = track.tags || []
  if (tags.some((tag) => /(^|:)epub$/i.test(tag) || tag.toLowerCase() === 'ext:epub')) return true
  return /\.epub(?:[?#]|$)/i.test(track.url || '')
}

async function trackToPublication(track: Track, origin: string): Promise<HydrusCatalogPublication | null> {
  if (!track.url || !isEpubTrack(track)) return null
  const tags = track.tags || []
  let encodedSource = encodeUrlSafeBase64(track.url)
  try {
    encodedSource = await registerThoriumSource(track.url, origin)
  } catch {
    // Keep the encoded URL fallback if registration is unavailable.
  }
  const manifestUrl = `${origin}/readium/webpub/${encodedSource}/manifest.json`
  return {
    title: extractTitleFromTags(tags) || track.title || `EPUB ${track.fileId ?? ''}`.trim(),
    author: track.artist || extractNamespaceValue(tags, 'author') || extractNamespaceValue(tags, 'creator') || 'Unknown',
    cover: track.thumbnail || '',
    url: `/read/manifest/${encodeURIComponent(manifestUrl)}`,
    rendition: 'EPUB',
    source: track.serverName || track.serverId || 'Hydrus',
  }
}

async function postCatalog(publications: HydrusCatalogPublication[]) {
  const origin = window.location.origin.replace(/\/+$/, '')
  const unique = new Map<string, HydrusCatalogPublication>()
  for (const publication of publications) {
    if (!unique.has(publication.url)) unique.set(publication.url, publication)
  }
  const payload = [...unique.values()]
  const response = await fetch(`${origin}/readium/catalog`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publications: payload }),
  })
  if (!response.ok) {
    throw new Error(`Catalog publish failed (${response.status})`)
  }
  addDevLog({
    kind: 'debug',
    category: 'thorium',
    message: `Published ${payload.length} Hydrus EPUBs to Thorium catalog`,
  })
  return payload.length
}

export async function publishHydrusEpubCatalogFromTracks(tracks: Track[]) {
  const origin = window.location.origin.replace(/\/+$/, '')
  const publications = (await Promise.all(tracks.map((track) => trackToPublication(track, origin))))
    .filter((publication): publication is HydrusCatalogPublication => Boolean(publication))
  return postCatalog(publications)
}

export async function publishHydrusEpubCatalogFromCache(cacheKey: string) {
  const snapshot = await loadLibraryCache(cacheKey)
  return publishHydrusEpubCatalogFromTracks((snapshot?.tracks || []) as Track[])
}

export async function publishHydrusEpubCatalog(servers: ServerConfig[]) {
  const origin = window.location.origin.replace(/\/+$/, '')
  const publications: HydrusCatalogPublication[] = []

  for (const server of servers) {
    try {
      const client = getHydrusClient(server)
      const fileIds = await client.searchFiles('ext:epub', CATALOG_LIMIT)
      if (!fileIds.length) continue

      const metadataMap = await client.getFilesMetadata(fileIds)
      for (const fileId of fileIds) {
        const metadata = metadataMap[fileId] || { tags: [] }
        const tags = metadata.tags || []
        const fileUrl = client.getFileUrl(fileId)
        let encodedSource = encodeUrlSafeBase64(fileUrl)
        try {
          encodedSource = await registerThoriumSource(fileUrl, origin)
        } catch {
          // Keep the encoded URL fallback if registration is unavailable.
        }
        publications.push({
          title: extractTitleFromTags(tags) || `EPUB ${fileId}`,
          author: extractNamespaceValue(tags, 'author') || extractNamespaceValue(tags, 'creator') || 'Unknown',
          cover: client.getThumbnailUrl(fileId),
          url: `/read/manifest/${encodeURIComponent(`${origin}/readium/webpub/${encodedSource}/manifest.json`)}`,
          rendition: 'EPUB',
          source: server.name || server.host || 'Hydrus',
        })
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      addDevLog({ kind: 'error', category: 'thorium', message: `Hydrus EPUB catalog failed for ${server.name || server.host}: ${message}` })
    }
  }

  return postCatalog(publications)
}
