import { ID3Writer } from 'browser-id3-writer'
import { embedContainerAudioMetadata, supportsContainerMetadataEmbedding } from '../audioMetadata'
import type { HydrusFileDetails } from '../api/hydrusClient'
import type { Track } from '../types'
import { buildHydrusDownloadMetadata, getTrackCacheKey, getTrackExtension } from './trackMetadata'

export function buildTrackDownloadKey(track: Track) {
  return getTrackCacheKey(track.serverId, track.fileId) || (track.fileId != null ? `file:${track.fileId}` : `url:${track.url}`)
}

export function sanitizeFileNameSegment(value: string) {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseContentDispositionFilename(headerValue: string | null | undefined) {
  if (!headerValue) return null

  const patterns = [
    /filename\*=UTF-8''([^;]+)/i,
    /filename="([^"]+)"/i,
    /filename=([^;\s]+)/i,
  ]

  for (const pattern of patterns) {
    const match = headerValue.match(pattern)
    if (!match?.[1]) continue

    try {
      return decodeURIComponent(match[1]).trim()
    } catch {
      return match[1].trim()
    }
  }

  return null
}

export function buildTrackDownloadName(track: Track, details?: HydrusFileDetails | null, contentDisposition?: string | null) {
  const suggestedName = sanitizeFileNameSegment(parseContentDispositionFilename(contentDisposition) || '')
  if (suggestedName) return suggestedName

  const resolvedMetadata = buildHydrusDownloadMetadata(track, details)
  const extension = sanitizeFileNameSegment(getTrackExtension(track, details) || '')
  const title = sanitizeFileNameSegment(resolvedMetadata.title || '')
  const artist = sanitizeFileNameSegment(resolvedMetadata.artist || '')
  const album = sanitizeFileNameSegment(resolvedMetadata.album || '')
  const nameBase = artist && title
    ? `${artist} - ${title}`
    : title || album || (track.fileId != null ? `hydrus-file-${track.fileId}` : 'media')

  return extension ? `${nameBase}.${extension}` : nameBase
}

export function isMp3Download(track: Track, details?: HydrusFileDetails | null, contentType?: string | null) {
  const normalizedType = (contentType || track.mimeType || '').toLowerCase()
  if (normalizedType.includes('audio/mpeg') || normalizedType.includes('audio/mp3')) return true
  return getTrackExtension(track, details) === 'mp3'
}

export function isNonMp3AudioDownload(track: Track, details?: HydrusFileDetails | null, contentType?: string | null) {
  return supportsContainerMetadataEmbedding(getTrackExtension(track, details), contentType || track.mimeType || null)
}

export function triggerBrowserDownload(href: string, fileName: string) {
  const link = document.createElement('a')
  link.href = href
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

async function withAsyncTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

export async function embedDownloadMetadata(blob: Blob, track: Track, details?: HydrusFileDetails | null, contentType?: string | null) {
  const metadata = buildHydrusDownloadMetadata(track, details)
  if (isMp3Download(track, details, contentType)) {
    if (!metadata.title && !metadata.artist && !metadata.album && !metadata.trackNumber) return { blob, note: undefined as string | undefined }

    try {
      const writer = new ID3Writer(await blob.arrayBuffer())
      if (metadata.title) writer.setFrame('TIT2', metadata.title)
      if (metadata.artist) writer.setFrame('TPE1', [metadata.artist])
      if (metadata.album) writer.setFrame('TALB', metadata.album)
      if (metadata.trackNumber) writer.setFrame('TRCK', metadata.trackNumber)
      writer.addTag()

      return {
        blob: writer.getBlob(),
        note: 'MP3 tags embedded from Hydrus tags',
      }
    } catch {
      return { blob, note: undefined as string | undefined }
    }
  }

  if (!isNonMp3AudioDownload(track, details, contentType)) return { blob, note: undefined as string | undefined }
  if (!metadata.title && !metadata.artist && !metadata.album && !metadata.trackNumber) return { blob, note: undefined as string | undefined }

  try {
    const taggedBlob = await withAsyncTimeout(
      embedContainerAudioMetadata(blob, getTrackExtension(track, details), metadata),
      15000,
      'Metadata embedding timed out'
    )

    return {
      blob: taggedBlob,
      note: 'Audio tags embedded from Hydrus tags',
    }
  } catch {
    return { blob, note: undefined as string | undefined }
  }
}
