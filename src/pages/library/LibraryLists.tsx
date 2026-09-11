import React from 'react'
import { Box, Card, CardActionArea, CardContent, CardMedia, Chip, Grid, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, Typography } from '@mui/material'
import type { Track } from '../../types'
import { isVideoMediaTrack } from '../../utils/externalPlayers'
import { getTrackCacheKey } from '../../utils/trackMetadata'
import {
  type AlbumEntry,
  type DisplayMode,
  type EntrySortField,
  getTrackArtworkSrc,
  getTrackDisplayTitle,
  getTrackFallbackArtwork,
  getTrackKindLabel,
  type SortDirection,
  type SortField,
  type TrackNamespacePresentation,
  type TrackSortField,
} from './libraryHelpers'

export type TrackInteractionProps = {
  onClick: () => void
  onContextMenu: (event: React.MouseEvent) => void
  onTouchStart: () => void
  onTouchEnd: () => void
  onTouchCancel: () => void
  onTouchMove: () => void
}

type SortHeaderOptions = { width?: string; align?: 'left' | 'right'; sx?: Record<string, unknown> }

function handleImageError(event: React.SyntheticEvent<HTMLImageElement>, track?: Track) {
  const fallbackSrc = getTrackFallbackArtwork(track)
  if (event.currentTarget.src === fallbackSrc) return
  event.currentTarget.src = fallbackSrc
}

function SortHeaderCell({
  label,
  field,
  sortBy,
  sortDirection,
  onSort,
  options,
}: {
  label: string
  field: SortField
  sortBy: SortField
  sortDirection: SortDirection
  onSort: (field: SortField) => void
  options?: SortHeaderOptions
}) {
  return (
    <TableCell align={options?.align} sx={{ width: options?.width, ...(options?.sx || {}) }}>
      <TableSortLabel
        active={sortBy === field}
        direction={sortBy === field ? sortDirection : 'asc'}
        onClick={() => onSort(field)}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  )
}

export function TrackGrid({
  tracks,
  getInteractionProps,
  getSecondaryValue,
  options,
}: {
  tracks: Array<Track | undefined>
  getInteractionProps: (track: Track) => TrackInteractionProps
  getSecondaryValue: (track: Track) => string | null
  options?: { showAlbum?: boolean; showFileIdFallback?: boolean }
}) {
  return (
    <Box className="library-grid">
      {tracks.map((track, idx) => {
        const isVideoTrack = track ? isVideoMediaTrack(track) : false

        return (
          <Box key={track ? (getTrackCacheKey(track.serverId, track.fileId) || track.id) : idx} sx={{ cursor: track?.url ? 'pointer' : 'default' }} {...(track?.url ? getInteractionProps(track) : {})}>
            <Box className="card-media">
              <Box component="img" src={getTrackArtworkSrc(track)} onError={(event: React.SyntheticEvent<HTMLImageElement>) => handleImageError(event, track)} alt={track?.title || '...'} loading="lazy" decoding="async" />

              <Box className="card-overlay">
                <Box className="play-button" title={isVideoTrack ? 'Play video' : 'Play'}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 5v14l11-7-11-7z" fill="currentColor"/></svg>
                </Box>
              </Box>

              {track?.isVideo && <div className="card-badge">Video</div>}
              {track?.serverName && <div className="card-badge server-badge">{track.serverName}</div>}
            </Box>

            <Box sx={{ mt: 1 }}>
              {track && getTrackDisplayTitle(track) ? <Typography variant="body2" sx={{ fontSize: 13 }}>{getTrackDisplayTitle(track)}</Typography> : null}
              {options?.showAlbum && track && getSecondaryValue(track) && <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>{getSecondaryValue(track)}</Typography>}
              {options?.showFileIdFallback && track && !getTrackDisplayTitle(track) && <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>File {track.fileId}</Typography>}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

export function TrackTable({
  tracks,
  compact,
  namespacePresentation,
  sectionLabel,
  sortBy,
  sortDirection,
  onSort,
  getInteractionProps,
  getPrimaryValue,
  getSecondaryValue,
  options,
}: {
  tracks: Track[]
  compact: boolean
  namespacePresentation: TrackNamespacePresentation
  sectionLabel: string
  sortBy: SortField
  sortDirection: SortDirection
  onSort: (field: SortField) => void
  getInteractionProps: (track: Track) => TrackInteractionProps
  getPrimaryValue: (track: Track) => string | null
  getSecondaryValue: (track: Track) => string | null
  options?: { showAlbum?: boolean; showFileIdFallback?: boolean }
}) {
  if (compact) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        {tracks.map((track) => (
          <Paper key={`${track.serverId || 'local'}:${track.fileId || track.id}`} elevation={0} sx={{ border: '1px solid rgba(255,255,255,0.08)', bgcolor: 'background.paper', backgroundImage: 'none', borderRadius: 2, px: 1.25, py: 1.1, cursor: 'pointer' }} {...getInteractionProps(track)}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
              <Box component="img" src={getTrackArtworkSrc(track)} onError={(event: React.SyntheticEvent<HTMLImageElement>) => handleImageError(event, track)} alt={track.title || 'track'} sx={{ width: 48, height: 48, borderRadius: 1.25, objectFit: 'cover', flexShrink: 0, bgcolor: '#0b0b0b' }} loading="lazy" decoding="async" />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>{getTrackDisplayTitle(track)}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                  {getPrimaryValue(track) || getSecondaryValue(track) || track.serverName || getTrackKindLabel(track, sectionLabel)}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }} noWrap>
                  {[options?.showAlbum || getSecondaryValue(track) ? (getSecondaryValue(track) || null) : null, track.serverName || null, track.fileId != null ? `#${track.fileId}` : null].filter(Boolean).join(' • ')}
                </Typography>
              </Box>
            </Box>
          </Paper>
        ))}
      </Box>
    )
  }

  return (
    <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid rgba(255,255,255,0.08)', bgcolor: 'background.paper', backgroundImage: 'none', borderRadius: 2 }}>
      <Table size="small" sx={{ width: '100%', tableLayout: 'fixed' }}>
        <TableHead>
          <TableRow>
            <SortHeaderCell label={namespacePresentation.trackLabel} field={'title' as TrackSortField} sortBy={sortBy} sortDirection={sortDirection} onSort={onSort} options={{ width: '38%' }} />
            <SortHeaderCell label={namespacePresentation.primaryLabel} field={'artist' as TrackSortField} sortBy={sortBy} sortDirection={sortDirection} onSort={onSort} options={{ width: '22%', sx: { display: { xs: 'none', md: 'table-cell' } } }} />
            <SortHeaderCell label={namespacePresentation.secondaryLabel} field={'album' as TrackSortField} sortBy={sortBy} sortDirection={sortDirection} onSort={onSort} options={{ width: '22%', sx: { display: { xs: 'none', sm: 'table-cell' } } }} />
            <SortHeaderCell label="Server" field={'server' as TrackSortField} sortBy={sortBy} sortDirection={sortDirection} onSort={onSort} options={{ width: '12%', sx: { display: { xs: 'none', lg: 'table-cell' } } }} />
            <SortHeaderCell label="ID" field={'fileId' as TrackSortField} sortBy={sortBy} sortDirection={sortDirection} onSort={onSort} options={{ width: '6%', align: 'right' }} />
          </TableRow>
        </TableHead>
        <TableBody>
          {tracks.map((track) => (
            <TableRow key={`${track.serverId || 'local'}:${track.fileId || track.id}`} hover sx={{ cursor: 'pointer', '& .MuiTableCell-root': { borderColor: 'rgba(255,255,255,0.08)' } }} {...getInteractionProps(track)}>
              <TableCell>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                  <Box component="img" src={getTrackArtworkSrc(track)} onError={(event: React.SyntheticEvent<HTMLImageElement>) => handleImageError(event, track)} alt={track.title || 'track'} sx={{ width: 44, height: 44, borderRadius: 1, objectFit: 'cover', flexShrink: 0, bgcolor: '#0b0b0b' }} loading="lazy" decoding="async" />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap>{getTrackDisplayTitle(track)}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {getTrackKindLabel(track, sectionLabel)}
                      {options?.showFileIdFallback && !track.title?.trim() && track.fileId != null ? ` • File ${track.fileId}` : ''}
                    </Typography>
                  </Box>
                </Box>
              </TableCell>
              <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}><Typography variant="body2" noWrap>{getPrimaryValue(track) || '—'}</Typography></TableCell>
              <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}><Typography variant="body2" noWrap>{options?.showAlbum || getSecondaryValue(track) ? (getSecondaryValue(track) || '—') : '—'}</Typography></TableCell>
              <TableCell sx={{ display: { xs: 'none', lg: 'table-cell' } }}><Typography variant="body2" noWrap>{track.serverName || '—'}</Typography></TableCell>
              <TableCell align="right">{track.fileId ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

export function EntryList({
  entries,
  kind,
  compact,
  displayMode,
  namespacePresentation,
  sortBy,
  sortDirection,
  onSort,
  onOpen,
}: {
  entries: AlbumEntry[]
  kind: 'album' | 'artist'
  compact: boolean
  displayMode: DisplayMode
  namespacePresentation: TrackNamespacePresentation
  sortBy: SortField
  sortDirection: SortDirection
  onSort: (field: SortField) => void
  onOpen: (name: string) => void
}) {
  const label = kind === 'album' ? namespacePresentation.secondaryLabel : namespacePresentation.primaryLabel

  if (displayMode !== 'table') {
    return (
      <Grid container spacing={2}>
        {entries.map((entry) => (
          <Grid item xs={6} sm={4} md={3} key={entry.name}>
            <Card>
              <CardActionArea onClick={() => onOpen(entry.name)}>
                {entry.servers[0]?.thumbnail ? (
                  <CardMedia component="img" height="140" image={entry.servers[0].thumbnail} alt={entry.name} loading="lazy" decoding="async" />
                ) : (
                  <Box sx={{ height: 140, background: '#0b0b0b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{entry.name}</Box>
                )}
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="body2">{entry.name}</Typography>
                    <Chip label={`${entry.totalCount}`} size="small" />
                  </Box>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    )
  }

  if (compact) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        {entries.map((entry) => (
          <Paper key={`${kind}:${entry.name}`} elevation={0} onClick={() => onOpen(entry.name)} sx={{ border: '1px solid rgba(255,255,255,0.08)', bgcolor: 'background.paper', backgroundImage: 'none', borderRadius: 2, px: 1.25, py: 1.1, cursor: 'pointer' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
              {entry.servers[0]?.thumbnail ? (
                <Box component="img" src={entry.servers[0].thumbnail} alt={entry.name} sx={{ width: 48, height: 48, borderRadius: 1.25, objectFit: 'cover', flexShrink: 0, bgcolor: '#0b0b0b' }} loading="lazy" decoding="async" />
              ) : (
                <Box sx={{ width: 48, height: 48, borderRadius: 1.25, flexShrink: 0, bgcolor: '#0b0b0b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary', fontSize: 12 }}>
                  {label.slice(0, 2).toUpperCase()}
                </Box>
              )}
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>{entry.name}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                  {`${entry.totalCount} items • ${entry.servers.length} server${entry.servers.length === 1 ? '' : 's'}`}
                </Typography>
              </Box>
            </Box>
          </Paper>
        ))}
      </Box>
    )
  }

  return (
    <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid rgba(255,255,255,0.08)', bgcolor: 'background.paper', backgroundImage: 'none', borderRadius: 2 }}>
      <Table size="small" sx={{ width: '100%', tableLayout: 'fixed' }}>
        <TableHead>
          <TableRow>
            <SortHeaderCell label={label} field={'name' as EntrySortField} sortBy={sortBy} sortDirection={sortDirection} onSort={onSort} options={{ width: '70%' }} />
            <SortHeaderCell label="Items" field={'count' as EntrySortField} sortBy={sortBy} sortDirection={sortDirection} onSort={onSort} options={{ width: '15%', align: 'right' }} />
            <TableCell align="right" sx={{ width: '15%', display: { xs: 'none', sm: 'table-cell' } }}>Servers</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={`${kind}:${entry.name}`} hover onClick={() => onOpen(entry.name)} sx={{ cursor: 'pointer', '& .MuiTableCell-root': { borderColor: 'rgba(255,255,255,0.08)' } }}>
              <TableCell>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                  {entry.servers[0]?.thumbnail ? (
                    <Box component="img" src={entry.servers[0].thumbnail} alt={entry.name} sx={{ width: 44, height: 44, borderRadius: 1, objectFit: 'cover', flexShrink: 0, bgcolor: '#0b0b0b' }} loading="lazy" decoding="async" />
                  ) : (
                    <Box sx={{ width: 44, height: 44, borderRadius: 1, flexShrink: 0, bgcolor: '#0b0b0b', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary', fontSize: 12 }}>
                      {label.slice(0, 2).toUpperCase()}
                    </Box>
                  )}
                  <Typography variant="body2" noWrap>{entry.name}</Typography>
                </Box>
              </TableCell>
              <TableCell align="right">{entry.totalCount}</TableCell>
              <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>{entry.servers.length}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

export { handleImageError as handleLibraryImageError }
