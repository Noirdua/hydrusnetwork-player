import type { HydrusFileDetails } from '../../api/hydrusClient'
import { extractNamespaceValue } from '../../utils/extractNamespaceValue'
import { isBookMimeType } from '../../utils/bookDetection'
import { getTrackCacheKey, getTrackExtension } from '../../utils/trackMetadata'
import type { MediaSection, Track } from '../../types'
import { SECTION_CONFIG, type LibraryLayoutId, type LibraryView } from './libraryConfig'

export const RESULTS_PAGE_SIZE = 36
export const LONG_PRESS_DELAY_MS = 420

export { SECTION_CONFIG, type LibraryLayoutId, type LibraryView }
export type TrackArtworkKind = 'audio' | 'video' | 'image' | 'application' | 'book' | 'file'
export type DisplayMode = 'grid' | 'table'
export type SortDirection = 'asc' | 'desc'
export type TrackSortField = 'title' | 'artist' | 'album' | 'server' | 'fileId'
export type EntrySortField = 'name' | 'count'
export type SortField = TrackSortField | EntrySortField

export type SortOption = {
  id: SortField
  label: string
}

export type TrackNamespacePresentation = {
  trackLabel: string
  primaryLabel: string
  secondaryLabel: string
  primaryNamespace: string
  secondaryNamespace: string
}

export type AlbumEntry = {
  name: string
  servers: { serverId: string; count: number; thumbnail?: string }[]
  totalCount: number
}

function createFallbackArtworkDataUrl(label: string, accent: string, iconPath: string) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" role="img" aria-label="${label}"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#121826"/><stop offset="100%" stop-color="#1f2937"/></linearGradient></defs><rect width="160" height="160" rx="24" fill="url(#bg)"/><circle cx="80" cy="66" r="28" fill="${accent}" fill-opacity="0.18" stroke="${accent}" stroke-width="3"/><path d="${iconPath}" fill="${accent}"/><text x="80" y="128" text-anchor="middle" fill="#d1d5db" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="1.2">${label}</text></svg>` )}`
}

export const FALLBACK_ARTWORK: Record<TrackArtworkKind, string> = {
  audio: createFallbackArtworkDataUrl('AUDIO', '#22c55e', 'M90 44v41.85A12 12 0 1 0 98 97V60h18V44Z'),
  video: createFallbackArtworkDataUrl('VIDEO', '#f97316', 'M64 48v36l32-18-32-18Z'),
  image: createFallbackArtworkDataUrl('IMAGE', '#38bdf8', 'M50 86h60L94 64 78 83 68 74Zm18-28a7 7 0 1 0 0-.01Z'),
  application: createFallbackArtworkDataUrl('FILE', '#a78bfa', 'M60 40h30l18 18v52H60Zm28 4v20h20'),
  book: createFallbackArtworkDataUrl('BOOK', '#f59e0b', 'M78 52c-8 0-15-4-22-6v56c7 2 14 6 22 6s15-4 22-6V46c-7 2-14 6-22 6Zm0 0c-4-2-9-3-13-3v56c4 0 9 1 13 3m0-56c4 2 9 3 13 3v56c-4 0-9-1-13-3m-6-42h12m-12 8h12'),
  file: createFallbackArtworkDataUrl('MEDIA', '#94a3b8', 'M60 40h30l18 18v52H60Zm28 4v20h20'),
}

export const STREAMABLE_FILE_EXTENSIONS = new Set([
  'm3u8',
  'mp3',
  'm4a',
  'aac',
  'flac',
  'wav',
  'ogg',
  'oga',
  'opus',
  'mp4',
  'm4v',
  'webm',
  'mkv',
  'mov',
  'avi',
  'wmv',
  'ogv',
  'mpeg',
  'mpg',
  'ts',
  'm2ts',
  'flv',
])

export { getTrackCacheKey, getTrackExtension }

export const ENTRY_SORT_OPTIONS: SortOption[] = [
  { id: 'name', label: 'Name' },
  { id: 'count', label: 'Items' },
]

export function compareText(left?: string | null, right?: string | null) {
  return (left || '').localeCompare((right || ''), undefined, { numeric: true, sensitivity: 'base' })
}

export function getTrackNamespacePresentation(section: MediaSection): TrackNamespacePresentation {
  if (section === 'video') {
    return {
      trackLabel: 'Episode',
      primaryLabel: 'Series',
      secondaryLabel: 'Season',
      primaryNamespace: 'series',
      secondaryNamespace: 'season',
    }
  }

  if (section === 'books') {
    return {
      trackLabel: 'Title',
      primaryLabel: 'Author',
      secondaryLabel: 'Series',
      primaryNamespace: 'author',
      secondaryNamespace: 'series',
    }
  }

  return {
    trackLabel: 'Track',
    primaryLabel: 'Artist',
    secondaryLabel: 'Album',
    primaryNamespace: 'artist',
    secondaryNamespace: 'album',
  }
}

export function deriveTrackPrimaryValue(track: Track, section: MediaSection) {
  if (section === 'video') return extractNamespaceValue(track.tags, 'series') || track.artist || null
  if (section === 'books') return track.artist || extractNamespaceValue(track.tags, 'author') || extractNamespaceValue(track.tags, 'creator') || null
  return track.artist || null
}

export function deriveTrackSecondaryValue(track: Track, section: MediaSection) {
  if (section === 'video') return extractNamespaceValue(track.tags, 'season') || track.album || null
  if (section === 'books') return track.album || extractNamespaceValue(track.tags, 'series') || extractNamespaceValue(track.tags, 'collection') || null
  return track.album || null
}

export function getTrackSortOptions(section: MediaSection): SortOption[] {
  const namespacePresentation = getTrackNamespacePresentation(section)

  return [
    { id: 'artist', label: namespacePresentation.primaryLabel },
    { id: 'album', label: namespacePresentation.secondaryLabel },
    { id: 'title', label: namespacePresentation.trackLabel },
    { id: 'server', label: 'Server' },
    { id: 'fileId', label: 'File ID' },
  ]
}

export function getTrackDisplayTitle(track: Track) {
  return track.title?.trim() || (track.fileId != null ? `File ${track.fileId}` : 'Untitled')
}

export function sortTracks(
  tracks: Track[],
  sortBy: TrackSortField,
  sortDirection: SortDirection,
  options?: {
    getPrimaryValue?: (track: Track) => string | null | undefined
    getSecondaryValue?: (track: Track) => string | null | undefined
  }
) {
  const direction = sortDirection === 'asc' ? 1 : -1
  const getPrimaryValue = options?.getPrimaryValue || ((track: Track) => track.artist)
  const getSecondaryValue = options?.getSecondaryValue || ((track: Track) => track.album)

  return [...tracks].sort((left, right) => {
    let comparison = 0

    switch (sortBy) {
      case 'artist':
        comparison = compareText(getPrimaryValue(left), getPrimaryValue(right))
        if (comparison === 0) comparison = compareText(getSecondaryValue(left), getSecondaryValue(right))
        if (comparison === 0) comparison = compareText(getTrackDisplayTitle(left), getTrackDisplayTitle(right))
        break
      case 'album':
        comparison = compareText(getSecondaryValue(left), getSecondaryValue(right))
        if (comparison === 0) comparison = compareText(getPrimaryValue(left), getPrimaryValue(right))
        if (comparison === 0) comparison = compareText(getTrackDisplayTitle(left), getTrackDisplayTitle(right))
        break
      case 'server':
        comparison = compareText(left.serverName, right.serverName)
        if (comparison === 0) comparison = compareText(getTrackDisplayTitle(left), getTrackDisplayTitle(right))
        break
      case 'fileId':
        comparison = (left.fileId || 0) - (right.fileId || 0)
        if (comparison === 0) comparison = compareText(getTrackDisplayTitle(left), getTrackDisplayTitle(right))
        break
      case 'title':
      default:
        comparison = compareText(getTrackDisplayTitle(left), getTrackDisplayTitle(right))
        if (comparison === 0) comparison = compareText(getPrimaryValue(left), getPrimaryValue(right))
        break
    }

    return comparison * direction
  })
}

export function sortEntries(entries: AlbumEntry[], sortBy: EntrySortField, sortDirection: SortDirection) {
  const direction = sortDirection === 'asc' ? 1 : -1

  return [...entries].sort((left, right) => {
    let comparison = 0

    if (sortBy === 'count') {
      comparison = left.totalCount - right.totalCount
      if (comparison === 0) comparison = compareText(left.name, right.name)
    } else {
      comparison = compareText(left.name, right.name)
      if (comparison === 0) comparison = left.totalCount - right.totalCount
    }

    return comparison * direction
  })
}

export function getDefaultSortField(view: LibraryView, hasArtistsView: boolean): SortField {
  if (view === 'albums' || view === 'artists') return 'name'
  return hasArtistsView ? 'artist' : 'title'
}

export function getStoredSectionView(section: MediaSection, views: Partial<Record<MediaSection, string>>) {
  const candidate = views[section]
  return SECTION_CONFIG[section].views.some((item) => item.id === candidate) ? candidate as LibraryView : 'tracks'
}

export function formatDuration(value?: number) {
  if (!value || value <= 0) return null
  const totalSeconds = Math.round(value >= 1000 ? value / 1000 : value)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function getTrackKindLabel(track: Track, fallbackLabel: string) {
  if (track.mediaKind && track.mediaKind !== 'all') {
    return SECTION_CONFIG[track.mediaKind]?.label || fallbackLabel
  }

  const mimeType = (track.mimeType || '').toLowerCase()
  if (track.isVideo || mimeType.startsWith('video/')) return 'Video'
  if (mimeType.startsWith('audio/')) return 'Audio'
  if (mimeType.startsWith('image/')) return 'Image'
  if (mimeType.startsWith('text/')) return 'Text'
  if (mimeType.startsWith('application/')) return 'Application'
  return fallbackLabel
}

export function getTrackArtworkKind(track?: Track): TrackArtworkKind {
  if (!track) return 'file'
  if (track.mediaKind && track.mediaKind !== 'all') {
    if (track.mediaKind === 'audio' || track.mediaKind === 'video' || track.mediaKind === 'image') return track.mediaKind
    if (track.mediaKind === 'books') return 'book'
    if (track.mediaKind === 'application') return 'application'
  }

  const mimeType = (track.mimeType || '').toLowerCase()
  if (track.isVideo || mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  if (mimeType.startsWith('image/')) return 'image'
  if (isBookMimeType(mimeType)) return 'book'
  if (mimeType.startsWith('text/') || mimeType.startsWith('application/')) return 'application'
  return 'file'
}

export function getTrackFallbackArtwork(track?: Track) {
  return FALLBACK_ARTWORK[getTrackArtworkKind(track)]
}

export function getTrackArtworkSrc(track?: Track) {
  if (!track) return getTrackFallbackArtwork(track)
  if (getTrackArtworkKind(track) === 'audio' && track.hasThumbnail !== true) return getTrackFallbackArtwork(track)
  if (track.thumbnail && track.hasThumbnail !== false) return track.thumbnail
  return getTrackFallbackArtwork(track)
}

export function getEntryThumbnail(track?: Track) {
  if (!track?.thumbnail) return undefined
  return track.hasThumbnail === false ? undefined : track.thumbnail
}

export function needsVisibleMediaInfoBackfill(track?: Track) {
  if (!track?.serverId || track.fileId == null) return false
  if (track.hasThumbnail === undefined) return true
  if (!track.mimeType) return true
  const kind = getTrackArtworkKind(track)
  if (track.isVideo === undefined && kind !== 'image' && kind !== 'book' && kind !== 'application') return true
  if (track.duration == null && (kind === 'audio' || kind === 'video')) return true
  return false
}

export function matchesMediaSection(track: Track, section: MediaSection) {
  if (section === 'all') return true
  if (track.mediaKind) return track.mediaKind === section

  const mimeType = (track.mimeType || '').toLowerCase()
  if (section === 'books') return isBookMimeType(mimeType)
  if (section === 'video') return !!track.isVideo || mimeType.startsWith('video/')
  if (section === 'audio') return (!track.isVideo && mimeType.startsWith('audio/')) || mimeType.includes('mpegurl')
  if (section === 'image') return mimeType.startsWith('image/')
  if (section === 'application') return (mimeType.startsWith('application/') || mimeType.startsWith('text/')) && !isBookMimeType(mimeType)
  return false
}

export function getApplicationSubtype(track: Track) {
  const mimeType = (track.mimeType || '').toLowerCase()
  if (!mimeType) return 'application' as const

  if (
    mimeType.startsWith('text/') ||
    mimeType.includes('pdf') ||
    mimeType.includes('rtf') ||
    mimeType.includes('epub') ||
    mimeType.includes('msword') ||
    mimeType.includes('wordprocessingml') ||
    mimeType.includes('presentation')
  ) {
    return 'text' as const
  }

  if (
    mimeType.includes('json') ||
    mimeType.includes('xml') ||
    mimeType.includes('yaml') ||
    mimeType.includes('csv') ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    mimeType.includes('sqlite')
  ) {
    return 'data' as const
  }

  return 'application' as const
}

export function filterTracksForSection(tracks: Track[], section: MediaSection) {
  return tracks.filter((track) => matchesMediaSection(track, section))
}

export function filterTracksForView(tracks: Track[], currentView: LibraryView, section: MediaSection) {
  if (section !== 'application') return tracks
  if (currentView === 'text') return tracks.filter((track) => getApplicationSubtype(track) === 'text')
  if (currentView === 'data') return tracks.filter((track) => getApplicationSubtype(track) === 'data')
  return tracks
}

export function canStreamTrack(track: Track, details?: HydrusFileDetails | null) {
  const extension = getTrackExtension(track, details)
  if (!extension) return false
  return STREAMABLE_FILE_EXTENSIONS.has(extension)
}

export function buildNamespaceEntriesFromTracks(tracks: Track[], getName: (track: Track) => string | null | undefined) {
  const entries: Record<string, AlbumEntry> = {}

  for (const track of tracks) {
    const name = getName(track)
    if (!name) continue

    if (!entries[name]) {
      entries[name] = { name, servers: [], totalCount: 0 }
    }

    const entry = entries[name]
    entry.totalCount += 1

    const serverId = track.serverId || 'unknown'
    let serverEntry = entry.servers.find((server) => server.serverId === serverId)
    if (!serverEntry) {
      serverEntry = { serverId, count: 0, thumbnail: getEntryThumbnail(track) }
      entry.servers.push(serverEntry)
    }

    serverEntry.count += 1
    if (!serverEntry.thumbnail) serverEntry.thumbnail = getEntryThumbnail(track)
  }

  return Object.values(entries).sort((a, b) => a.name.localeCompare(b.name))
}

export function buildTrackGroupsFromTracks(
  tracks: Track[],
  getGroupName: (track: Track) => string | null | undefined,
  getSubgroupName: (track: Track) => string | null | undefined,
) {
  const groupsMap: Record<string, Track[]> = {}
  const seen = new Set<string>()

  for (const track of tracks) {
    const trackKey = getTrackCacheKey(track.serverId, track.fileId) || `${track.serverName || 'local'}:${track.url}`
    if (seen.has(trackKey)) continue
    seen.add(trackKey)

    const groupName = getGroupName(track) || 'Unknown'
    if (!groupsMap[groupName]) groupsMap[groupName] = []
    groupsMap[groupName].push(track)
  }

  const groups = Object.entries(groupsMap).map(([name, groupTracks]) => ({ name, tracks: [...groupTracks] }))
  for (const group of groups) {
    group.tracks.sort((a, b) => {
      const aSubgroup = (getSubgroupName(a) || '').toLowerCase()
      const bSubgroup = (getSubgroupName(b) || '').toLowerCase()
      if (aSubgroup && bSubgroup && aSubgroup !== bSubgroup) return aSubgroup.localeCompare(bSubgroup)
      return (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase())
    })
  }

  return groups.sort((a, b) => a.name.localeCompare(b.name))
}

export function getVisibleTrackGroups(groups: Array<{ name: string; tracks: Track[] }>, limit: number) {
  const visibleGroups: Array<{ name: string; tracks: Track[] }> = []
  let remaining = limit

  for (const group of groups) {
    if (remaining <= 0) break

    const visibleTracks = group.tracks.slice(0, remaining)
    if (visibleTracks.length) {
      visibleGroups.push({ name: group.name, tracks: visibleTracks })
      remaining -= visibleTracks.length
    }
  }

  return visibleGroups
}
