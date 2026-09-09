import React from 'react'
import { Alert, Box, Button, Chip, Dialog, DialogActions, IconButton, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DownloadIcon from '@mui/icons-material/Download'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import type { HydrusFileDetails } from '../../api/hydrusClient'
import type { Track } from '../../types'
import { formatBytes } from '../../utils/formatBytes'
import { isPlayableMediaTrack } from '../../utils/externalPlayers'
import { isPdfTrack, isThoriumReadableTrack } from '../../utils/thoriumReader'
import {
  canStreamTrack,
  formatDuration,
  getTrackArtworkSrc,
  getTrackDisplayTitle,
  getTrackExtension,
  getTrackKindLabel,
} from './libraryHelpers'
import { handleLibraryImageError } from './LibraryLists'

function groupDetailTags(tags: string[]) {
  const byNamespace = new Map<string, { tag: string; label: string }[]>()

  for (const tag of tags) {
    const separator = tag.indexOf(':')
    const namespace = separator > 0 ? tag.slice(0, separator) : 'tag'
    const label = (separator > 0 ? tag.slice(separator + 1) : tag).replace(/_/g, ' ')
    const group = byNamespace.get(namespace) || []
    group.push({ tag, label })
    byNamespace.set(namespace, group)
  }

  const preferred = ['creator', 'artist', 'author', 'series', 'season', 'album', 'title', 'character', 'copyright']
  const groups: { namespace: string; values: { tag: string; label: string }[] }[] = []

  for (const namespace of preferred) {
    const values = byNamespace.get(namespace)
    if (!values?.length) continue
    groups.push({ namespace, values })
    byNamespace.delete(namespace)
  }

  for (const [namespace, values] of byNamespace) {
    groups.push({ namespace, values })
  }

  return groups
}

type TrackDetailsDialogProps = {
  open: boolean
  track: Track | null
  details: HydrusFileDetails | null
  loading: boolean
  error: string | null
  downloading: boolean
  sectionLabel: string
  primaryValue: string | null
  secondaryValue: string | null
  onClose: () => void
  onPlay: () => void
  onStream: () => void
  onOpenWeb: () => void
  onDownload: () => void
  onTagSearch: (tag: string) => void
}

export default function TrackDetailsDialog({
  open,
  track,
  details,
  loading,
  error,
  downloading,
  sectionLabel,
  primaryValue,
  secondaryValue,
  onClose,
  onPlay,
  onStream,
  onOpenWeb,
  onDownload,
  onTagSearch,
}: TrackDetailsDialogProps) {
  const mergedTrack = track ? (details ? { ...track, ...details } : track) : null
  const canReadInThorium = mergedTrack ? isThoriumReadableTrack(mergedTrack) : false
  const canReadPdf = mergedTrack ? isPdfTrack(mergedTrack) : false

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      sx={{ '& .MuiBackdrop-root': { touchAction: 'none' } }}
      PaperProps={{
        sx: {
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          backgroundImage: 'none',
          bgcolor: 'background.default',
          m: 0,
          width: '100%',
          maxWidth: '100%',
          height: '100dvh',
          maxHeight: '100dvh',
          borderRadius: 0,
          touchAction: 'pan-y',
        },
      }}
    >
      <Box sx={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {track && (
          <Box
            component="img"
            src={getTrackArtworkSrc(track)}
            alt=""
            aria-hidden
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(48px) saturate(1.25)', opacity: 0.28, transform: 'scale(1.12)', pointerEvents: 'none' }}
          />
        )}
        <Box sx={{ position: 'absolute', inset: 0, bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(8,8,10,0.72)' : 'rgba(255,255,255,0.72)', pointerEvents: 'none' }} />

        <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'flex-end', px: 1, pt: { xs: 1, sm: 1.25 }, flexShrink: 0 }}>
          <IconButton onClick={onClose} aria-label="close details" sx={{ width: 44, height: 44, bgcolor: 'rgba(0,0,0,0.28)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,0.42)' } }}>
            <CloseIcon />
          </IconButton>
        </Box>

        <Box
          className="themed-scroll"
          sx={{
            position: 'relative',
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
            touchAction: 'pan-y',
            px: { xs: 2, sm: 4, md: 6 },
            pb: 2,
          }}
        >
          {loading && <Alert severity="info">Loading item details...</Alert>}
          {!loading && error && <Alert severity="error">{error}</Alert>}
          {!loading && !error && track && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 2.5, md: 3.5 }, maxWidth: 1180, mx: 'auto', width: '100%' }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(280px, 0.42fr) minmax(0, 1fr)' }, gap: { xs: 2.5, md: 5 }, alignItems: 'start' }}>
                <Box
                  component="img"
                  src={getTrackArtworkSrc(track)}
                  onError={(event: React.SyntheticEvent<HTMLImageElement>) => handleLibraryImageError(event, track)}
                  alt={getTrackDisplayTitle(track)}
                  sx={{ width: '100%', maxHeight: { xs: 380, md: '46vh' }, objectFit: 'contain', borderRadius: 3, bgcolor: 'rgba(0,0,0,0.35)', boxShadow: '0 24px 64px rgba(0,0,0,0.45)' }}
                />

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip size="small" color="primary" label={getTrackKindLabel(track, sectionLabel)} />
                    {track.serverName && <Chip size="small" label={track.serverName} />}
                    {details?.mimeType && <Chip size="small" label={details.mimeType} />}
                    {getTrackExtension(track, details) && <Chip size="small" label={`.${getTrackExtension(track, details)}`} />}
                  </Box>

                  <Box>
                    <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.15, fontSize: { xs: 28, sm: 34, md: 40 } }}>
                      {getTrackDisplayTitle(track)}
                    </Typography>
                    {primaryValue && (
                      <Typography variant="h6" sx={{ mt: 0.75, color: 'text.secondary', fontWeight: 500 }}>
                        {primaryValue}
                      </Typography>
                    )}
                    {secondaryValue && (
                      <Typography variant="body1" sx={{ mt: 0.25, color: 'text.secondary' }}>
                        {secondaryValue}
                      </Typography>
                    )}
                  </Box>

                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, minmax(0, 1fr))' }, gap: 1.5 }}>
                    {[
                      ['File ID', track.fileId ?? 'Unknown'],
                      ['Size', formatBytes(details?.sizeBytes) || 'Unknown'],
                      ['Resolution', details?.width && details?.height ? `${details.width} × ${details.height}` : 'Unknown'],
                      ['Duration', formatDuration(details?.durationMs) || 'Unknown'],
                    ].map(([label, value]) => (
                      <Box key={label} sx={{ p: 1.25, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                        <Typography variant="caption" color="text.secondary">{label}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.25 }}>{value}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              </Box>

              <Box sx={{ width: '100%' }}>
                <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 700 }}>Tags</Typography>
                {(details?.tags || track.tags || []).length > 0
                  ? (
                    <Box sx={{ columnCount: { xs: 1, sm: 2, md: 3 }, columnGap: 2 }}>
                      {groupDetailTags(details?.tags || track.tags || []).map((group) => (
                        <Box key={group.namespace} sx={{ breakInside: 'avoid', mb: 1.75 }}>
                          <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            {group.namespace}
                          </Typography>
                          <Box sx={{ mt: 0.75, display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                            {group.values.map((item) => (
                              <Chip key={item.tag} label={item.label} size="small" variant="outlined" clickable onClick={() => onTagSearch(item.tag)} />
                            ))}
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  )
                  : <Typography variant="body2">No tags available.</Typography>}
              </Box>
            </Box>
          )}
        </Box>
      </Box>
      <DialogActions
        className="overlay-action-bar"
        sx={{
          flexShrink: 0,
          position: 'relative',
          zIndex: 1,
          gap: 1,
          flexWrap: 'wrap',
          justifyContent: { xs: 'stretch', sm: 'flex-end' },
          bgcolor: 'background.paper',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          px: 2,
          pt: 1.25,
          pb: { xs: 'calc(12px + env(safe-area-inset-bottom, 0px))', sm: 1.5 },
          '& > .MuiButton-root': {
            flex: { xs: '1 1 calc(50% - 8px)', sm: '0 0 auto' },
            minHeight: 44,
          },
        }}
      >
        {mergedTrack?.url && isPlayableMediaTrack(mergedTrack) && (
          <Button variant="contained" onClick={onPlay} startIcon={<PlayArrowIcon />}>
            Play
          </Button>
        )}
        {track?.url && canStreamTrack(track, details) && (
          <Button variant="outlined" onClick={onStream} startIcon={<OpenInNewIcon />}>
            Stream
          </Button>
        )}
        {(canReadInThorium || canReadPdf) && (
          <Button variant="contained" onClick={onOpenWeb} startIcon={<MenuBookIcon />}>
            Read
          </Button>
        )}
        {track?.url && !(mergedTrack && isPlayableMediaTrack(mergedTrack)) && !canReadInThorium && !canReadPdf && (
          <Button onClick={onOpenWeb} startIcon={<OpenInNewIcon />}>
            Open
          </Button>
        )}
        <Button onClick={onDownload} startIcon={<DownloadIcon />} disabled={!track?.url || loading || downloading}>
          {downloading ? 'Downloading...' : 'Download'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
