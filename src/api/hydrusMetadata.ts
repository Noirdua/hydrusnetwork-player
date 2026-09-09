export type HydrusMediaInfo = {
  mimeType?: string
  isVideo?: boolean
  hasThumbnail?: boolean
}

export type HydrusFileMetadata = HydrusMediaInfo & {
  tags: string[]
}

export type HydrusFileDetails = HydrusMediaInfo & {
  fileId: number
  extension?: string
  sizeBytes?: number
  width?: number
  height?: number
  durationMs?: number
  tags: string[]
}

export function getFileMetadataEntry(data: unknown, fileId: number) {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>

  if (record.file_metadata && typeof record.file_metadata === 'object' && !Array.isArray(record.file_metadata)) {
    const direct = (record.file_metadata as Record<string, unknown>)[String(fileId)]
    if (direct && typeof direct === 'object') return direct
  }

  if (Array.isArray(record.file_metadata)) {
    const found = record.file_metadata.find((item) => String((item as { file_id?: unknown })?.file_id) === String(fileId))
    if (found && typeof found === 'object') return found
  }

  if (Array.isArray(record.metadata)) {
    const found = record.metadata.find((item) => String((item as { file_id?: unknown })?.file_id) === String(fileId))
    if (found && typeof found === 'object') return found
  }

  if (String(record.file_id) === String(fileId)) return data
  return null
}

function normalizeMimeType(value: string): string | undefined {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return undefined

  if (normalized.includes('mpegurl') || normalized.includes('m3u8')) return 'application/vnd.apple.mpegurl'

  const directMimeMatch = normalized.match(/(?:video|audio|application|image|text)\/[a-z0-9.+-]+/)
  if (directMimeMatch) return directMimeMatch[0]

  const knownMimeMap: Array<[string, string]> = [
    ['quicktime', 'video/quicktime'],
    ['matroska', 'video/x-matroska'],
    ['mkv', 'video/x-matroska'],
    ['mp4', normalized.includes('audio') ? 'audio/mp4' : 'video/mp4'],
    ['webm', normalized.includes('audio') ? 'audio/webm' : 'video/webm'],
    ['mpeg', normalized.includes('audio') ? 'audio/mpeg' : 'video/mpeg'],
    ['avi', 'video/x-msvideo'],
    ['wmv', 'video/x-ms-wmv'],
    ['mov', 'video/quicktime'],
    ['ogg', normalized.includes('video') ? 'video/ogg' : 'audio/ogg'],
    ['mp3', 'audio/mpeg'],
    ['m4a', 'audio/mp4'],
    ['aac', 'audio/aac'],
    ['flac', 'audio/flac'],
    ['wav', 'audio/wav'],
  ]

  const match = knownMimeMap.find(([token]) => normalized.includes(token))
  return match ? match[1] : undefined
}

type WalkedFileFields = {
  mimeCandidates: string[]
  width: number
  height: number
  frameCount: number
  hasDuration: boolean
  hasThumbnail: boolean
  extension?: string
  sizeBytes?: number
  durationMs?: number
}

function walkFileFields(metadata: unknown): WalkedFileFields {
  let width = 0
  let height = 0
  let frameCount = 0
  let hasDuration = false
  let hasThumbnail = false
  let extension: string | undefined
  let sizeBytes: number | undefined
  let durationMs: number | undefined
  const mimeCandidates: string[] = []

  const visit = (value: unknown, keyHint = '') => {
    if (value == null) return
    const lowerKey = keyHint.toLowerCase()

    if (typeof value === 'string') {
      if (lowerKey.includes('mime') || lowerKey.includes('filetype') || lowerKey.includes('container') || lowerKey.includes('format')) {
        mimeCandidates.push(value)
      }
      if (!extension && (lowerKey === 'ext' || lowerKey === 'extension')) {
        extension = value.replace(/^\./, '').trim().toLowerCase() || undefined
      }
      if (!extension && (lowerKey.includes('filename') || lowerKey === 'name')) {
        const match = value.match(/\.([a-z0-9]{1,10})$/i)
        if (match) extension = match[1].toLowerCase()
      }
      return
    }

    if (typeof value === 'number') {
      if (lowerKey === 'width') width = Math.max(width, value)
      else if (lowerKey === 'height') height = Math.max(height, value)
      else if ((lowerKey === 'thumbnail_width' || lowerKey === 'thumbnail_height') && value > 0) hasThumbnail = true
      else if (lowerKey.includes('frame')) frameCount = Math.max(frameCount, value)
      else if (lowerKey.includes('duration') || lowerKey === 'ms') {
        hasDuration = hasDuration || value > 0
        if (value > 0) durationMs = Math.max(durationMs || 0, value)
      } else if ((lowerKey === 'size' || lowerKey === 'file_size' || lowerKey === 'num_bytes' || lowerKey === 'bytes') && value > 0) {
        sizeBytes = Math.max(sizeBytes || 0, value)
      }
      return
    }

    if (typeof value === 'boolean') {
      if (lowerKey === 'has_thumbnail' || lowerKey === 'hasthumbnail') hasThumbnail = value
      else if (lowerKey.includes('video') && value) mimeCandidates.push('video')
      else if (lowerKey.includes('audio') && value) mimeCandidates.push('audio')
      return
    }

    if (Array.isArray(value)) {
      for (const item of value) visit(item, keyHint)
      return
    }

    if (typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
        visit(childValue, childKey)
      }
    }
  }

  visit(metadata)
  return { mimeCandidates, width, height, frameCount, hasDuration, hasThumbnail, extension, sizeBytes, durationMs }
}

function mediaInfoFromFields(fields: WalkedFileFields): HydrusMediaInfo {
  const withThumbnail = (info: HydrusMediaInfo): HydrusMediaInfo => ({ ...info, hasThumbnail: fields.hasThumbnail })

  for (const candidate of fields.mimeCandidates) {
    const mimeType = normalizeMimeType(candidate)
    if (mimeType) {
      return withThumbnail({
        mimeType,
        isVideo: mimeType.startsWith('video/') || mimeType === 'application/vnd.apple.mpegurl',
      })
    }
    const lower = candidate.toLowerCase()
    if (lower.includes('video')) return withThumbnail({ isVideo: true })
    if (lower.includes('audio')) return withThumbnail({ isVideo: false })
  }

  if ((fields.width > 0 || fields.height > 0) && (fields.frameCount > 1 || fields.hasDuration)) return withThumbnail({ isVideo: true })
  if (fields.hasDuration) return withThumbnail({ isVideo: false })
  return withThumbnail({})
}

export function extractMediaInfoFromMetadata(data: unknown, fileId: number): HydrusMediaInfo {
  const metadata = getFileMetadataEntry(data, fileId) || data
  if (!metadata || typeof metadata !== 'object') return {}
  return mediaInfoFromFields(walkFileFields(metadata))
}

function collectStringTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
}

function isCurrentTagStatus(status: string) {
  return status === '0' || status === 'current' || Number(status) === 0
}

function isTagStatusKey(status: string) {
  if (status === 'current' || status === 'pending' || status === 'deleted' || status === 'petitioned') return true
  const numeric = Number(status)
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 3
}

function collectTagsFromStatusMap(statusMap: unknown): string[] {
  if (!statusMap || typeof statusMap !== 'object' || Array.isArray(statusMap)) return []
  const tags: string[] = []
  for (const [status, value] of Object.entries(statusMap as Record<string, unknown>)) {
    if (!isCurrentTagStatus(status)) continue
    tags.push(...collectStringTags(value))
  }
  return tags
}

function collectTagsFromServiceMap(serviceMap: unknown): string[] {
  if (!serviceMap || typeof serviceMap !== 'object') return []
  const keys = Object.keys(serviceMap as Record<string, unknown>)
  if (keys.length > 0 && keys.every((key) => isTagStatusKey(key))) {
    return collectTagsFromStatusMap(serviceMap)
  }

  const tags: string[] = []
  for (const value of Object.values(serviceMap as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      tags.push(...collectStringTags(value))
      continue
    }
    if (!value || typeof value !== 'object') continue
    if (Array.isArray((value as { tags?: unknown }).tags)) {
      tags.push(...collectStringTags((value as { tags: unknown }).tags))
      continue
    }
    tags.push(...collectTagsFromStatusMap(value))
  }
  return tags
}

function extractTagsFromHydrusService(service: unknown): string[] {
  if (!service || typeof service !== 'object' || Array.isArray(service)) return []
  const record = service as { display_tags?: unknown; storage_tags?: unknown }
  const display = collectTagsFromStatusMap(record.display_tags)
  if (display.length) return display
  return collectTagsFromStatusMap(record.storage_tags)
}

export function extractTagsFromFileObject(meta: unknown): string[] {
  if (!meta || typeof meta !== 'object') return []
  const record = meta as Record<string, unknown>

  const tagsNode = record.tags && typeof record.tags === 'object' && !Array.isArray(record.tags) ? record.tags as Record<string, unknown> : null
  if (tagsNode) {
    const services = Object.values(tagsNode)
    const combined = services.find((service) => {
      if (!service || typeof service !== 'object') return false
      const item = service as { type?: unknown; type_pretty?: unknown }
      return item.type === 10 || String(item.type_pretty || '').includes('combined tag')
    })
    const combinedTags = extractTagsFromHydrusService(combined)
    if (combinedTags.length) return Array.from(new Set(combinedTags))

    const merged: string[] = []
    for (const service of services) {
      merged.push(...extractTagsFromHydrusService(service))
    }
    if (merged.length) return Array.from(new Set(merged))
  }

  const sources = [
    tagsNode?.service_keys_to_statuses_to_display_tags,
    tagsNode?.service_names_to_statuses_to_display_tags,
    record.service_keys_to_statuses_to_display_tags,
    record.service_names_to_statuses_to_display_tags,
    tagsNode?.service_keys_to_statuses_to_storage_tags,
    record.service_keys_to_statuses_to_storage_tags,
    tagsNode?.service_keys_to_tags,
    record.service_keys_to_tags,
  ]

  for (const source of sources) {
    const collected = collectTagsFromServiceMap(source)
    if (collected.length) return Array.from(new Set(collected))
  }

  if (Array.isArray(record.tags)) return Array.from(new Set(collectStringTags(record.tags)))
  if (Array.isArray(record.file_tags)) return Array.from(new Set(collectStringTags(record.file_tags)))
  return []
}

export function extractTagsFromMetadata(data: unknown, fileId: number): string[] {
  const entry = getFileMetadataEntry(data, fileId)
  if (entry) return extractTagsFromFileObject(entry)
  return extractTagsFromFileObject(data)
}

export function extractFileDetailsFromMetadata(data: unknown, fileId: number): HydrusFileDetails {
  const metadata = getFileMetadataEntry(data, fileId) || data || {}
  const fields = walkFileFields(metadata)
  const mediaInfo = mediaInfoFromFields(fields)
  const tags = extractTagsFromMetadata(data, fileId)

  return {
    fileId,
    ...mediaInfo,
    extension: fields.extension,
    sizeBytes: fields.sizeBytes,
    width: fields.width || undefined,
    height: fields.height || undefined,
    durationMs: fields.durationMs,
    tags,
  }
}

export function extractTitleFromTags(tags: string[] | null | undefined): string | null {
  if (!tags || tags.length === 0) return null
  const candidates = tags.filter((tag) => /^title:/i.test(tag))
  if (candidates.length === 0) return null
  const values = candidates
    .map((tag) => {
      const match = tag.match(/^title:(.*)$/i)
      return match ? match[1].replace(/_/g, ' ').trim() : ''
    })
    .filter(Boolean)
  if (values.length === 0) return null
  values.sort((a, b) => b.length - a.length)
  return values[0]
}
