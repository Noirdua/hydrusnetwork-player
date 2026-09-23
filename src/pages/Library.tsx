import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Chip, FormControl, InputLabel, MenuItem, Select, Tab, Tabs, Typography, useMediaQuery } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import { useServers } from '../context/ServersContext'
import { extractTitleFromTags, getHydrusClient, type HydrusFileDetails } from '../api/hydrusClient'
import { type LibraryPrimaryAction, loadUiPreferences, saveUiPreferences } from '../appPreferences'
import type { MediaSection, Track } from '../types'
import {
  type DisplayMode,
  ENTRY_SORT_OPTIONS,
  type EntrySortField,
  type LibraryView,
  LONG_PRESS_DELAY_MS,
  RESULTS_PAGE_SIZE,
  SECTION_CONFIG,
  type SortDirection,
  type SortField,
  type TrackSortField,
  buildNamespaceEntriesFromTracks,
  buildTrackGroupsFromTracks,
  compareText,
  deriveTrackPrimaryValue,
  deriveTrackSecondaryValue,
  filterTracksForSection,
  filterTracksForView,
  getDefaultSortField,
  getStoredSectionView,
  getTrackCacheKey,
  getTrackExtension,
  getTrackNamespacePresentation,
  getTrackSortOptions,
  getVisibleTrackGroups,
  type LibraryLayoutId,
  needsVisibleMediaInfoBackfill,
  sortEntries,
  sortTracks,
} from './library/libraryHelpers'
import { applyLibraryQueryFilters, getNamespacedQueryValue, matchesTrackSearch } from './library/librarySearch'
import { useOverlayZoomLock } from '../hooks/useOverlayZoomLock'
import { isPdfTrack, isThoriumReadableTrack, openExternalHref } from '../utils/thoriumReader'
import NestedCatalogLayout from './library/NestedCatalogLayout'
import { buildNestedCatalog, resolveViewLayout, sliceNestedCatalog, viewLayoutKey } from './library/libraryLayouts'
import { EntryList, handleLibraryImageError, TrackGrid, TrackTable, type TrackInteractionProps } from './library/LibraryLists'
import TrackDetailsDialog from './library/TrackDetailsDialog'
import { useLibraryCache } from './library/useLibraryCache'

type Props = {
  mediaSection: MediaSection
  onPlayNow: (track: Track) => void | Promise<void>
  onOpenInAppPlayer: (track: Track) => void
  onDownloadTrack: (track: Track, details?: HydrusFileDetails | null) => void
  isTrackDownloading: (track: Track) => boolean
  primaryTapAction: LibraryPrimaryAction
  query: string
  onQueryChange: (value: string) => void
  displayModePreference: 'grid' | 'table'
  onItemCountChange?: (count: number | null) => void
  viewLayouts?: Partial<Record<string, LibraryLayoutId>>
}

export default function Library({ mediaSection, onPlayNow, onOpenInAppPlayer, onDownloadTrack, isTrackDownloading, primaryTapAction, query, onQueryChange, displayModePreference, onItemCountChange, viewLayouts = {} }: Props) {
  const initialUiPreferences = useMemo(() => loadUiPreferences(), [])
  const initialSectionViews = useMemo(() => initialUiPreferences.librarySectionViews as Partial<Record<MediaSection, string>>, [initialUiPreferences])
  const [sectionViews, setSectionViews] = useState<Partial<Record<MediaSection, string>>>(initialSectionViews)
  const [view, setView] = useState<LibraryView>(() => getStoredSectionView(mediaSection, initialSectionViews))
  const [sortBy, setSortBy] = useState<SortField>(initialUiPreferences.librarySortBy as SortField)
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialUiPreferences.librarySortDirection)
  const [visibleCount, setVisibleCount] = useState(RESULTS_PAGE_SIZE)
  const theme = useTheme()
  const isCompactTableLayout = useMediaQuery(theme.breakpoints.down('sm'))

  const { servers, onlineServerIds, healthChecksComplete, activeServerId } = useServers()
  const { results, loading, error, hasServers, cacheTracks } = useLibraryCache({
    servers,
    onlineServerIds,
    healthChecksComplete,
    activeServerId,
  })

  const playMetadataAbortRef = useRef<AbortController | null>(null)
  const visibleMediaInfoAbortRef = useRef<AbortController | null>(null)
  const detailsAbortRef = useRef<AbortController | null>(null)
  const attemptedMediaInfoKeysRef = useRef(new Set<string>())
  const mediaInfoOwnersRef = useRef(new Map<string, number>())
  const mediaInfoRunRef = useRef(0)
  const serversRef = useRef(servers)
  serversRef.current = servers
  const longPressTimerRef = useRef<number | null>(null)
  const longPressTriggeredRef = useRef(false)
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null)
  const [detailsTrack, setDetailsTrack] = useState<Track | null>(null)
  const [detailsData, setDetailsData] = useState<HydrusFileDetails | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const syncingSectionViewRef = useRef(false)
  const sectionConfig = SECTION_CONFIG[mediaSection]
  const namespacePresentation = getTrackNamespacePresentation(mediaSection)
  const isAllSection = mediaSection === 'all'
  const isTrackLikeView = view === 'tracks' || view === 'text' || view === 'data'
  const hasAlbumsView = sectionConfig.views.some((item) => item.id === 'albums')
  const hasArtistsView = sectionConfig.views.some((item) => item.id === 'artists')
  const effectiveDisplayMode: DisplayMode = isAllSection ? 'table' : displayModePreference
  const viewLayout = resolveViewLayout(
    sectionConfig.views.find((item) => item.id === view)?.layout,
    viewLayouts[viewLayoutKey(mediaSection, view)],
    effectiveDisplayMode,
  )
  const sortOptions = useMemo(() => isTrackLikeView ? getTrackSortOptions(mediaSection) : ENTRY_SORT_OPTIONS, [isTrackLikeView, mediaSection])
  const detailsTrackDownloading = !!detailsTrack && isTrackDownloading(detailsTrack)
  const mergedDetailsTrack = useMemo(() => {
    if (!detailsTrack) return null
    return detailsData ? { ...detailsTrack, ...detailsData } : detailsTrack
  }, [detailsTrack, detailsData])
  const trackNamespaceValues = useMemo(() => {
    const values = new Map<string, { primary: string | null; secondary: string | null }>()

    for (const track of results) {
      const cacheKey = getTrackCacheKey(track.serverId, track.fileId) || `${track.serverId || 'local'}:${track.id}`
      values.set(cacheKey, {
        primary: deriveTrackPrimaryValue(track, mediaSection),
        secondary: deriveTrackSecondaryValue(track, mediaSection),
      })
    }

    return values
  }, [mediaSection, results])

  function getTrackNamespaceCacheKey(track: Track) {
    return getTrackCacheKey(track.serverId, track.fileId) || `${track.serverId || 'local'}:${track.id}`
  }

  function getTrackPrimaryValue(track: Track) {
    return trackNamespaceValues.get(getTrackNamespaceCacheKey(track))?.primary || null
  }

  function getTrackSecondaryValue(track: Track) {
    return trackNamespaceValues.get(getTrackNamespaceCacheKey(track))?.secondary || null
  }

  function applyQueryFilterUpdates(updates: Record<string, string | null | undefined>) {
    onQueryChange(applyLibraryQueryFilters(query, updates))
  }

  useEffect(() => {
    syncingSectionViewRef.current = true
    setView(getStoredSectionView(mediaSection, sectionViews))
  }, [mediaSection])

  useEffect(() => {
    if (syncingSectionViewRef.current) {
      syncingSectionViewRef.current = false
      return
    }

    setSectionViews((prev) => {
      if (prev[mediaSection] === view) return prev
      const next = { ...prev, [mediaSection]: view }
      saveUiPreferences({ librarySectionViews: next })
      return next
    })
  }, [mediaSection, view])

  useEffect(() => {
    if (!sectionConfig.views.some((item) => item.id === view)) {
      setView('tracks')
    }
  }, [sectionConfig.views, view])

  useEffect(() => {
    if (!sortOptions.some((option) => option.id === sortBy)) {
      setSortBy(getDefaultSortField(view, hasArtistsView))
    }
  }, [hasArtistsView, sortBy, sortOptions, view])

  useEffect(() => {
    saveUiPreferences({
      librarySortBy: sortBy,
      librarySortDirection: sortDirection,
    })
  }, [sortBy, sortDirection])

  useEffect(() => {
    setVisibleCount(RESULTS_PAGE_SIZE)
  }, [mediaSection, view, query])

  useEffect(() => {
    return () => {
      try { playMetadataAbortRef.current?.abort() } catch {}
      try { visibleMediaInfoAbortRef.current?.abort() } catch {}
      try { detailsAbortRef.current?.abort() } catch {}
      if (longPressTimerRef.current && typeof window !== 'undefined') {
        window.clearTimeout(longPressTimerRef.current)
      }
    }
  }, [])

  const handlePlayNow = async (track: Track) => {
    if (!track?.url) return

    try { playMetadataAbortRef.current?.abort() } catch {}
    const metadataController = new AbortController()
    playMetadataAbortRef.current = metadataController

    const needsTitle = /^File\s+\d+$/i.test(track.title)
    const needsMediaInfo = track.isVideo === undefined || !track.mimeType

    if (needsTitle || needsMediaInfo) {
      try {
        const server = servers.find((s) => s.id === track.serverId)
        if (server && track.fileId != null) {
          const details = await getHydrusClient(server).getFileDetails(track.fileId, metadataController.signal)
          let nextTrack = track

          if (needsTitle) {
            const title = extractTitleFromTags(details.tags)
            if (title) nextTrack = { ...nextTrack, title }
          }

          if (needsMediaInfo && (details.mimeType || details.isVideo !== undefined)) {
            nextTrack = {
              ...nextTrack,
              mimeType: details.mimeType ?? nextTrack.mimeType,
              isVideo: details.isVideo ?? nextTrack.isVideo,
              hasThumbnail: details.hasThumbnail ?? nextTrack.hasThumbnail,
            }
          }

          if (details.tags?.length && !nextTrack.tags?.length) {
            nextTrack = { ...nextTrack, tags: details.tags }
          }

          if (nextTrack !== track) {
            cacheTracks([nextTrack])
            track = nextTrack
          }
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') return
      }
    }

    await onPlayNow(track)
  }

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current && typeof window !== 'undefined') {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const closeDetails = () => {
    clearLongPressTimer()
    try { detailsAbortRef.current?.abort() } catch {}
    setDetailsOpen(false)
    setDetailsLoading(false)
    setDetailsError(null)
  }

  const handleDetailsTagSearch = (tag: string) => {
    setView('tracks')
    onQueryChange(tag)
    closeDetails()
  }

  const openTrackDetails = async (track: Track) => {
    setDetailsTrack(track)
    setDetailsOpen(true)
    setDetailsLoading(true)
    setDetailsError(null)
    setDetailsData(null)

    try { detailsAbortRef.current?.abort() } catch {}
    const controller = new AbortController()
    detailsAbortRef.current = controller

    try {
      const server = servers.find((candidate) => candidate.id === track.serverId)
      if (!server || track.fileId == null) {
        setDetailsData({
          fileId: track.fileId ?? 0,
          mimeType: track.mimeType,
          isVideo: track.isVideo,
          extension: getTrackExtension(track),
          tags: track.tags || [],
        })
        setDetailsLoading(false)
        return
      }

      const details = await getHydrusClient(server).getFileDetails(track.fileId, controller.signal)
      if (controller.signal.aborted) return
      setDetailsData(details)
      setDetailsLoading(false)
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') return
      setDetailsError(error instanceof Error ? error.message : String(error))
      setDetailsLoading(false)
    }
  }

  const handleTrackActivate = async (track: Track) => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false
      return
    }

    if (primaryTapAction === 'details') {
      await openTrackDetails(track)
      return
    }

    await handlePlayNow(track)
  }

  const handleStreamTrack = async () => {
    if (!detailsTrack?.url) return
    const streamTrack = detailsData ? { ...detailsTrack, ...detailsData } : detailsTrack
    closeDetails()
    await onPlayNow(streamTrack)
  }

  const handleOpenWeb = () => {
    if (!detailsTrack?.url || typeof window === 'undefined') return
    const track = detailsData ? { ...detailsTrack, ...detailsData } : detailsTrack
    if (isThoriumReadableTrack(track) || isPdfTrack(track)) {
      closeDetails()
      void onPlayNow(track)
      return
    }
    openExternalHref(detailsTrack.url)
  }

  const handleOpenInApp = () => {
    if (!mergedDetailsTrack?.url) return
    closeDetails()
    onOpenInAppPlayer(mergedDetailsTrack)
  }

  const handleDownloadTrack = () => {
    if (!detailsTrack?.url || detailsTrackDownloading) return
    closeDetails()
    onDownloadTrack(detailsTrack, detailsData)
  }

  const getTrackInteractionProps = (track: Track): TrackInteractionProps => ({
    onClick: () => { void handleTrackActivate(track) },
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault()
      longPressTriggeredRef.current = true
      void openTrackDetails(track)
      window.setTimeout(() => {
        longPressTriggeredRef.current = false
      }, 500)
    },
    onTouchStart: () => {
      if (!isCompactTableLayout || typeof window === 'undefined') return
      clearLongPressTimer()
      longPressTriggeredRef.current = false
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTriggeredRef.current = true
        void openTrackDetails(track)
      }, LONG_PRESS_DELAY_MS)
    },
    onTouchEnd: clearLongPressTimer,
    onTouchCancel: clearLongPressTimer,
    onTouchMove: clearLongPressTimer,
  })

  const sectionTracks = useMemo(() => filterTracksForSection(results, mediaSection), [mediaSection, results])
  const activeSecondaryQuery = useMemo(() => getNamespacedQueryValue(query, namespacePresentation.secondaryNamespace), [namespacePresentation.secondaryNamespace, query])
  const activePrimaryQuery = useMemo(() => getNamespacedQueryValue(query, namespacePresentation.primaryNamespace), [namespacePresentation.primaryNamespace, query])
  const queryMatchedSectionTracks = useMemo(() => sectionTracks.filter((track) => matchesTrackSearch(track, query, mediaSection)), [mediaSection, query, sectionTracks])
  const currentTrackResults = useMemo(() => filterTracksForView(queryMatchedSectionTracks, view, mediaSection), [mediaSection, queryMatchedSectionTracks, view])
  const albums = useMemo(() => buildNamespaceEntriesFromTracks(queryMatchedSectionTracks, (track) => getTrackSecondaryValue(track)), [queryMatchedSectionTracks, trackNamespaceValues])
  const artists = useMemo(() => buildNamespaceEntriesFromTracks(queryMatchedSectionTracks, (track) => getTrackPrimaryValue(track)), [queryMatchedSectionTracks, trackNamespaceValues])
  const baseTrackGroups = useMemo(() => {
    if (!hasArtistsView || activeSecondaryQuery || activePrimaryQuery) return []
    return buildTrackGroupsFromTracks(
      currentTrackResults,
      (track) => getTrackPrimaryValue(track),
      (track) => getTrackSecondaryValue(track),
    )
  }, [activePrimaryQuery, activeSecondaryQuery, currentTrackResults, hasArtistsView, trackNamespaceValues])
  const sortedCurrentTrackResults = useMemo(() => sortTracks(currentTrackResults, sortBy as TrackSortField, sortDirection, {
    getPrimaryValue: (track) => getTrackPrimaryValue(track),
    getSecondaryValue: (track) => getTrackSecondaryValue(track),
  }), [currentTrackResults, sortBy, sortDirection, trackNamespaceValues])
  const sortedTrackGroups = useMemo(() => {
    if (!hasArtistsView) return []

    return [...baseTrackGroups]
      .map((group) => ({
        name: group.name,
        tracks: sortTracks(group.tracks, 'title', sortDirection, {
          getPrimaryValue: (track) => getTrackPrimaryValue(track),
          getSecondaryValue: (track) => getTrackSecondaryValue(track),
        }),
      }))
      .sort((left, right) => compareText(left.name, right.name) * (sortDirection === 'asc' ? 1 : -1))
  }, [baseTrackGroups, hasArtistsView, sortDirection, trackNamespaceValues])
  const sortedAlbums = useMemo(() => sortEntries(albums, sortBy as EntrySortField, sortDirection), [albums, sortBy, sortDirection])
  const sortedArtists = useMemo(() => sortEntries(artists, sortBy as EntrySortField, sortDirection), [artists, sortBy, sortDirection])
  const nestedCatalog = useMemo(() => {
    if (viewLayout !== 'nested-catalog') return []
    return buildNestedCatalog(
      sortedCurrentTrackResults,
      (track) => getTrackPrimaryValue(track),
      (track) => getTrackSecondaryValue(track),
      `Unknown ${namespacePresentation.primaryLabel.toLowerCase()}`,
      namespacePresentation.secondaryLabel,
    )
  }, [namespacePresentation.primaryLabel, namespacePresentation.secondaryLabel, sortedCurrentTrackResults, trackNamespaceValues, viewLayout])
  const visibleNestedCatalog = useMemo(() => sliceNestedCatalog(nestedCatalog, visibleCount), [nestedCatalog, visibleCount])
  const shouldShowGroupedTracks = viewLayout !== 'nested-catalog' && effectiveDisplayMode === 'grid' && !activeSecondaryQuery && !activePrimaryQuery && hasArtistsView && sortedTrackGroups.length > 0 && sortBy === 'artist'
  const totalGroupedTrackCount = useMemo(() => sortedTrackGroups.reduce((count, group) => count + group.tracks.length, 0), [sortedTrackGroups])
  const visibleTrackGroups = useMemo(() => getVisibleTrackGroups(sortedTrackGroups, visibleCount), [sortedTrackGroups, visibleCount])
  const visibleResults = useMemo(() => sortedCurrentTrackResults.slice(0, visibleCount), [sortedCurrentTrackResults, visibleCount])
  const visibleAlbums = useMemo(() => sortedAlbums.slice(0, visibleCount), [sortedAlbums, visibleCount])
  const visibleArtists = useMemo(() => sortedArtists.slice(0, visibleCount), [sortedArtists, visibleCount])
  const showToolbarSortControls = viewLayout === 'nested-catalog' || isCompactTableLayout
  const currentViewLabel = sectionConfig.views.find((item) => item.id === view)?.label || sectionConfig.label
  const itemCount = isTrackLikeView
    ? sortedCurrentTrackResults.length
    : (view === 'albums' ? sortedAlbums.length : sortedArtists.length)

  useEffect(() => {
    onItemCountChange?.(itemCount)
  }, [itemCount, onItemCountChange])

  useEffect(() => {
    return () => onItemCountChange?.(null)
  }, [onItemCountChange])

  const visibleRenderedTracks = useMemo(() => {
    if (viewLayout === 'nested-catalog') return visibleNestedCatalog.flatMap((group) => group.tracks)
    if (shouldShowGroupedTracks) return visibleTrackGroups.flatMap((group) => group.tracks)
    return visibleResults
  }, [shouldShowGroupedTracks, viewLayout, visibleNestedCatalog, visibleResults, visibleTrackGroups])

  useOverlayZoomLock(detailsOpen)

  const serverCredentialsKey = servers
    .map((server) => `${server.id}:${server.host}:${server.port ?? ''}:${server.apiKey || ''}:${server.ssl ? '1' : '0'}:${server.forceApiKeyInQuery ? '1' : '0'}`)
    .join('|')

  useEffect(() => {
    try { visibleMediaInfoAbortRef.current?.abort() } catch {}
    const controller = new AbortController()
    visibleMediaInfoAbortRef.current = controller
    mediaInfoOwnersRef.current.clear()
    attemptedMediaInfoKeysRef.current.clear()
    return () => {
      controller.abort()
    }
  }, [serverCredentialsKey])

  useEffect(() => {
    const controller = visibleMediaInfoAbortRef.current
    if (!controller || controller.signal.aborted) return

    const candidates = visibleRenderedTracks.filter((track) => {
      const cacheKey = getTrackCacheKey(track.serverId, track.fileId)
      if (!cacheKey || attemptedMediaInfoKeysRef.current.has(cacheKey) || mediaInfoOwnersRef.current.has(cacheKey)) return false
      return needsVisibleMediaInfoBackfill(track)
    })
    if (candidates.length === 0) return

    const runId = ++mediaInfoRunRef.current
    const ownedKeys: string[] = []
    for (const track of candidates) {
      const cacheKey = getTrackCacheKey(track.serverId, track.fileId)
      if (!cacheKey) continue
      mediaInfoOwnersRef.current.set(cacheKey, runId)
      ownedKeys.push(cacheKey)
    }

    void (async () => {
      const updatedTracks: Array<Partial<Track> & Pick<Track, 'serverId' | 'fileId'>> = []
      try {
        const byServer = new Map<string, Track[]>()
        for (const track of candidates) {
          if (!track.serverId || track.fileId == null) continue
          const list = byServer.get(track.serverId) || []
          list.push(track)
          byServer.set(track.serverId, list)
        }

        for (const [serverId, tracks] of byServer) {
          if (controller.signal.aborted) return
          const server = serversRef.current.find((candidate) => candidate.id === serverId)
          if (!server) continue

          const metadataMap = await getHydrusClient(server).getFilesMetadata(
            tracks.map((track) => track.fileId!).filter((fileId) => Number.isFinite(fileId)),
            6,
            controller.signal,
          )
          if (controller.signal.aborted) return

          for (const track of tracks) {
            if (track.fileId == null || !track.serverId) continue
            const mediaInfo = metadataMap[track.fileId]
            if (!mediaInfo) continue
            const cacheKey = getTrackCacheKey(track.serverId, track.fileId)
            if (!cacheKey) continue
            attemptedMediaInfoKeysRef.current.add(cacheKey)

            const nextTrack: Partial<Track> & Pick<Track, 'serverId' | 'fileId'> = {
              serverId: track.serverId,
              fileId: track.fileId,
              mimeType: mediaInfo.mimeType ?? track.mimeType,
              isVideo: mediaInfo.isVideo ?? track.isVideo,
              hasThumbnail: mediaInfo.hasThumbnail ?? track.hasThumbnail ?? false,
              duration: mediaInfo.durationMs ?? track.duration,
              tags: track.tags?.length ? track.tags : (mediaInfo.tags?.length ? mediaInfo.tags : track.tags),
            }
            if (
              nextTrack.mimeType === track.mimeType
              && nextTrack.isVideo === track.isVideo
              && nextTrack.hasThumbnail === track.hasThumbnail
              && nextTrack.duration === track.duration
              && nextTrack.tags === track.tags
            ) continue

            updatedTracks.push(nextTrack)
          }
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') return
      } finally {
        for (const key of ownedKeys) {
          if (mediaInfoOwnersRef.current.get(key) === runId) mediaInfoOwnersRef.current.delete(key)
        }
      }

      if (controller.signal.aborted || updatedTracks.length === 0) return
      cacheTracks(updatedTracks)
    })()
  }, [cacheTracks, serverCredentialsKey, visibleRenderedTracks])

  const canLoadMore = isTrackLikeView
    ? shouldShowGroupedTracks
      ? visibleCount < totalGroupedTrackCount
      : visibleCount < sortedCurrentTrackResults.length
    : view === 'albums'
      ? visibleCount < sortedAlbums.length
      : visibleCount < sortedArtists.length

  useEffect(() => {
    if (!canLoadMore || loading) return

    if (typeof IntersectionObserver === 'undefined') {
      setVisibleCount(Number.MAX_SAFE_INTEGER)
      return
    }

    const sentinel = loadMoreSentinelRef.current
    if (!sentinel) return
    let frame = 0

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        setVisibleCount((count) => count + RESULTS_PAGE_SIZE)
      })
    }, { rootMargin: '600px 0px' })

    observer.observe(sentinel)
    return () => {
      observer.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [canLoadMore, loading, visibleCount])

  const openAlbumEntry = (name: string, options?: { primaryName?: string | null }) => {
    setView('tracks')
    const primaryName = options?.primaryName?.trim() || activePrimaryQuery

    applyQueryFilterUpdates({
      [namespacePresentation.secondaryNamespace]: name,
      ...(primaryName ? { [namespacePresentation.primaryNamespace]: primaryName } : {}),
    })
  }

  const openArtistEntry = (name: string) => {
    setView('tracks')
    applyQueryFilterUpdates({
      [namespacePresentation.primaryNamespace]: name,
      [namespacePresentation.secondaryNamespace]: null,
    })
  }

  const handleSortRequest = (field: SortField) => {
    if (sortBy === field) {
      setSortDirection((prev) => prev === 'asc' ? 'desc' : 'asc')
      return
    }

    setSortBy(field)
    setSortDirection('asc')
  }

  return (
    <Box sx={{ p: { xs: 1, sm: 2 }, pb: { xs: 10, sm: 2 } }}>
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: (theme) => theme.zIndex.appBar - 1,
          backgroundColor: (theme) => alpha(theme.palette.background.paper, 0.88),
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          py: 0,
          mb: 1,
          mx: { xs: -1, sm: -2 },
          px: { xs: 1, sm: 2 },
        }}
      >
        {sectionConfig.views.length > 1 ? (
          <Tabs value={view} onChange={(_, v) => setView(v)} variant="scrollable" allowScrollButtonsMobile>
            {sectionConfig.views.map((item) => <Tab key={item.id} label={item.label} value={item.id} />)}
          </Tabs>
        ) : (
          <Box sx={{ px: 1, py: 0.5 }}>
            <Typography variant="h6">{sectionConfig.label}</Typography>
          </Box>
        )}
      </Box>

      {!hasServers && (
        <Alert severity="info" sx={{ mt: 2 }}>
          No Hydrus server selected. Add one in Settings.
        </Alert>
      )}

      {hasServers && healthChecksComplete && onlineServerIds.length === 0 && (
        <Alert severity="info" sx={{ mt: 2 }}>
          No Hydrus servers are currently online. Cached libraries stay on this device and will reappear after a successful connection test.
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}

      {showToolbarSortControls && (
        <Box sx={{ mt: 1, mb: 1, display: 'flex', gap: 1, flexWrap: 'nowrap', alignItems: 'center', overflowX: 'auto', pb: 0.5 }}>
          <FormControl size="small" sx={{ minWidth: 132, flexShrink: 0 }}>
            <InputLabel id="library-sort-by-label">Sort</InputLabel>
            <Select labelId="library-sort-by-label" value={sortBy} label="Sort by" onChange={(event) => setSortBy(event.target.value as SortField)}>
              {sortOptions.map((option) => (
                <MenuItem key={option.id} value={option.id}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 104, flexShrink: 0 }}>
            <InputLabel id="library-sort-direction-label">Order</InputLabel>
            <Select labelId="library-sort-direction-label" value={sortDirection} label="Order" onChange={(event) => setSortDirection(event.target.value as SortDirection)}>
              <MenuItem value="asc">Asc</MenuItem>
              <MenuItem value="desc">Desc</MenuItem>
            </Select>
          </FormControl>
        </Box>
      )}

      <Box>
        {(view === 'tracks' || view === 'text' || view === 'data') && (
          <>
            {viewLayout === 'nested-catalog' ? (
              <NestedCatalogLayout
                groups={visibleNestedCatalog}
                labels={{
                  group: namespacePresentation.primaryLabel,
                  subgroup: namespacePresentation.secondaryLabel,
                  item: namespacePresentation.trackLabel,
                }}
                getInteractionProps={getTrackInteractionProps}
                onImageError={handleLibraryImageError}
              />
            ) : shouldShowGroupedTracks ? (
              visibleTrackGroups.map((g) => {
                const albumChips = Array.from(new Set(g.tracks.map((track) => (getTrackSecondaryValue(track) || '').trim()).filter(Boolean)))
                return (
                  <Box key={g.name} sx={{ mb: 4 }}>
                    <Typography variant="h6" sx={{ mb: 1 }}>{g.name}</Typography>
                    {albumChips.length > 0 && (
                      <Box sx={{ mb: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {albumChips.map((a) => {
                          const count = g.tracks.filter((track) => getTrackSecondaryValue(track) === a).length
                          return <Chip key={a} label={`${a} (${count})`} clickable onClick={() => openAlbumEntry(a, { primaryName: g.name })} />
                        })}
                      </Box>
                    )}
                    <TrackGrid tracks={g.tracks} getInteractionProps={getTrackInteractionProps} getSecondaryValue={getTrackSecondaryValue} options={{ showAlbum: true }} />
                  </Box>
                )
              })
            ) : (
              effectiveDisplayMode === 'table'
                ? (
                  <TrackTable
                    tracks={visibleResults}
                    compact={isCompactTableLayout}
                    namespacePresentation={namespacePresentation}
                    sectionLabel={sectionConfig.label}
                    sortBy={sortBy}
                    sortDirection={sortDirection}
                    onSort={handleSortRequest}
                    getInteractionProps={getTrackInteractionProps}
                    getPrimaryValue={getTrackPrimaryValue}
                    getSecondaryValue={getTrackSecondaryValue}
                    options={{ showFileIdFallback: true }}
                  />
                )
                : (
                  <TrackGrid
                    tracks={visibleResults}
                    getInteractionProps={getTrackInteractionProps}
                    getSecondaryValue={getTrackSecondaryValue}
                    options={{ showFileIdFallback: true }}
                  />
                )
            )}
          </>
        )}

        {view === 'albums' && hasAlbumsView && (
          <EntryList
            entries={visibleAlbums}
            kind="album"
            compact={isCompactTableLayout}
            displayMode={effectiveDisplayMode}
            namespacePresentation={namespacePresentation}
            sortBy={sortBy}
            sortDirection={sortDirection}
            onSort={handleSortRequest}
            onOpen={openAlbumEntry}
          />
        )}

        {view === 'artists' && hasArtistsView && (
          <EntryList
            entries={visibleArtists}
            kind="artist"
            compact={isCompactTableLayout}
            displayMode={effectiveDisplayMode}
            namespacePresentation={namespacePresentation}
            sortBy={sortBy}
            sortDirection={sortDirection}
            onSort={handleSortRequest}
            onOpen={openArtistEntry}
          />
        )}
      </Box>

      {canLoadMore && !loading && (
        <Box ref={loadMoreSentinelRef} sx={{ height: 1 }} aria-hidden="true" />
      )}

      {((isTrackLikeView && currentTrackResults.length === 0) || (view === 'albums' && hasAlbumsView && albums.length === 0) || (view === 'artists' && hasArtistsView && artists.length === 0)) && (
        <Alert severity="info" sx={{ mt: 2 }}>
          {loading ? `Loading ${currentViewLabel.toLowerCase()}...` : 'No results found.'}
        </Alert>
      )}

      <TrackDetailsDialog
        open={detailsOpen}
        track={detailsTrack}
        details={detailsData}
        loading={detailsLoading}
        error={detailsError}
        downloading={detailsTrackDownloading}
        sectionLabel={sectionConfig.label}
        primaryValue={detailsTrack ? getTrackPrimaryValue(detailsTrack) : null}
        secondaryValue={detailsTrack ? getTrackSecondaryValue(detailsTrack) : null}
        onClose={closeDetails}
        onPlay={handleOpenInApp}
        onStream={() => { void handleStreamTrack() }}
        onOpenWeb={handleOpenWeb}
        onDownload={handleDownloadTrack}
        onTagSearch={handleDetailsTagSearch}
      />
    </Box>
  )
}
