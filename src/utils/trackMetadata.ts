import { extractTitleFromTags, type HydrusFileDetails } from '../api/hydrusClient'
import { extractNamespaceValue } from './extractNamespaceValue'
import type { Track } from '../types'

const MIME_EXTENSION_FALLBACKS: Array<[string, string]> = [
  ['audio/flac', 'flac'],
  ['audio/x-flac', 'flac'],
  ['audio/mpeg', 'mp3'],
  ['audio/mp3', 'mp3'],
  ['audio/mp4', 'm4a'],
  ['audio/aac', 'aac'],
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/ogg', 'ogg'],
  ['audio/opus', 'opus'],
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
  ['video/x-matroska', 'mkv'],
  ['video/quicktime', 'mov'],
  ['application/vnd.apple.mpegurl', 'm3u8'],
  ['application/epub+zip', 'epub'],
  ['application/pdf', 'pdf'],
]

export function getTrackCacheKey(serverId?: string, fileId?: number) {
  return serverId && fileId != null ? `${serverId}:${fileId}` : ''
}

export function getTrackExtension(track: Track, details?: HydrusFileDetails | null) {
  const detailsExtension = (details?.extension || '').trim().replace(/^\./, '').toLowerCase()
  if (detailsExtension) return detailsExtension

  const match = track.url.match(/\.([a-z0-9]{1,10})(?:[?#]|$)/i)
  if (match) return match[1].toLowerCase()

  const normalizedMimeType = (track.mimeType || '').trim().toLowerCase()
  if (!normalizedMimeType) return undefined

  for (const [mime, extension] of MIME_EXTENSION_FALLBACKS) {
    if (normalizedMimeType.startsWith(mime)) return extension
  }

  const mimeSuffix = normalizedMimeType.match(/^[a-z0-9.+-]+\/([a-z0-9.+-]+)/)
  if (!mimeSuffix?.[1]) return undefined
  return mimeSuffix[1].replace(/^x-/, '').split('+')[0]
}

export type ExternalPlayerMetadata = {
  title: string
  artist?: string
  album?: string
}

export type DownloadMetadata = {
  title?: string
  artist?: string
  album?: string
  trackNumber?: string
}

export function isTrackTitleUsable(title?: string) {
  const trimmed = (title || '').trim()
  if (!trimmed) return false
  if (/^(?:file|hydrus(?:[\s-]+file)?)\s*[-:#]*\s*\d+$/i.test(trimmed)) return false

  try {
    const parsed = new URL(trimmed)
    return !/^https?:$/i.test(parsed.protocol)
  } catch {
    return true
  }
}

export function resolveTrackMetadata(track: Track, details?: HydrusFileDetails | null) {
  const tags = details?.tags || track.tags || []
  const derivedTitle = extractTitleFromTags(tags) || undefined
  const derivedArtist = extractNamespaceValue(tags, 'artist') ?? undefined
  const derivedAlbum = extractNamespaceValue(tags, 'album') ?? undefined

  const title = isTrackTitleUsable(track.title) ? track.title.trim() : derivedTitle
  const artist = (track.artist || '').trim() || derivedArtist
  const album = (track.album || '').trim() || derivedAlbum

  return { title, artist, album }
}

export function buildHydrusDownloadMetadata(track: Track, details?: HydrusFileDetails | null): DownloadMetadata {
  const tags = details?.tags || track.tags || []

  return {
    title: extractTitleFromTags(tags) || undefined,
    artist: extractNamespaceValue(tags, 'artist') ?? undefined,
    album: extractNamespaceValue(tags, 'album') ?? undefined,
    trackNumber: extractNamespaceValue(tags, 'track') ?? undefined,
  }
}

export function extractFallbackMediaLabel(url: string, fileId?: number) {
  if (fileId != null) return `Hydrus File ${fileId}`

  try {
    const parsed = new URL(url)
    const hydrusFileId = parsed.searchParams.get('file_id')
    if (hydrusFileId) return `Hydrus File ${hydrusFileId}`

    const segments = parsed.pathname.split('/').filter(Boolean)
    const lastSegment = segments[segments.length - 1]
    if (!lastSegment) return 'Media'
    return decodeURIComponent(lastSegment)
  } catch {
    return 'Media'
  }
}

export function buildHydrusDownloadDisplayTitle(track: Track, details?: HydrusFileDetails | null) {
  const metadata = buildHydrusDownloadMetadata(track, details)
  if (metadata.artist && metadata.title) return `${metadata.artist} - ${metadata.title}`
  return metadata.title || metadata.artist || metadata.album || extractFallbackMediaLabel(track.url, track.fileId)
}

export function buildExternalPlayerMetadata(track: Track, details?: HydrusFileDetails | null): ExternalPlayerMetadata {
  const resolvedMetadata = resolveTrackMetadata(track, details)
  const artist = resolvedMetadata.artist
  const album = resolvedMetadata.album
  const title = resolvedMetadata.title || ''
  const displayTitle = artist && title
    ? `${artist} - ${title}`
    : title
      ? title
      : artist && album
        ? `${artist} - ${album}`
        : artist || album || extractFallbackMediaLabel(track.url, track.fileId)

  return {
    title: displayTitle,
    artist: artist ?? undefined,
    album: album ?? undefined,
  }
}
