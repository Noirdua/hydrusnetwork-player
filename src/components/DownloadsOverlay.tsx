import React, { useEffect, useMemo, useState } from 'react'
import { Box, Chip, IconButton, LinearProgress, Paper, Typography } from '@mui/material'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import CloseIcon from '@mui/icons-material/Close'
import DownloadIcon from '@mui/icons-material/Download'
import ClearAllIcon from '@mui/icons-material/ClearAll'
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined'
import { formatBytes } from '../utils/formatBytes'

export type DownloadOverlayItem = {
  id: string
  trackKey: string
  title: string
  fileName?: string
  status: 'downloading' | 'completed' | 'cancelled' | 'error'
  receivedBytes: number
  totalBytes: number | null
  saveHref?: string
  error?: string
  note?: string
}

type DownloadsOverlayProps = {
  downloads: DownloadOverlayItem[]
  onCancel: (id: string) => void
  onSaveAgain: (id: string) => void
  onDismiss: (id: string) => void
  onClearFinished: () => void
}

function buildProgressText(download: DownloadOverlayItem) {
  const receivedText = formatBytes(download.receivedBytes)
  const totalText = formatBytes(download.totalBytes)

  if (download.status === 'downloading') {
    if (download.note) return download.note
    if (receivedText && totalText) return `${receivedText} of ${totalText}`
    if (receivedText) return `${receivedText} received`
    return 'Preparing download...'
  }

  if (download.status === 'completed') {
    const parts = ['Ready to save again']
    if (totalText || receivedText) parts.push(totalText || receivedText || '')
    if (download.note) parts.push(download.note)
    return parts.join(' • ')
  }
  if (download.status === 'cancelled') return 'Cancelled'
  return download.error || 'Download failed'
}

function getProgressPercent(download: DownloadOverlayItem) {
  if (!download.totalBytes || download.totalBytes <= 0) return null
  return Math.max(0, Math.min(100, (download.receivedBytes / download.totalBytes) * 100))
}

export default function DownloadsOverlay({ downloads, onCancel, onSaveAgain, onDismiss, onClearFinished }: DownloadsOverlayProps) {
  const [expanded, setExpanded] = useState(true)
  const activeCount = useMemo(() => downloads.filter((download) => download.status === 'downloading').length, [downloads])
  const finishedCount = useMemo(() => downloads.filter((download) => download.status !== 'downloading').length, [downloads])

  useEffect(() => {
    if (activeCount > 0) setExpanded(true)
  }, [activeCount])

  if (downloads.length === 0) return null

  return (
    <Paper
      elevation={10}
      className="downloads-overlay"
      sx={{
        position: 'fixed',
        left: { xs: 12, sm: 'auto' },
        right: 12,
        bottom: 'max(12px, env(safe-area-inset-bottom, 0px))',
        width: { xs: 'auto', sm: 360 },
        maxWidth: 'calc(100vw - 24px)',
        borderRadius: 3,
        border: '1px solid rgba(255,255,255,0.08)',
        bgcolor: 'background.paper',
        zIndex: (theme) => theme.zIndex.modal - 1,
        overflow: 'hidden',
        touchAction: 'pan-y',
        overscrollBehavior: 'contain',
        backdropFilter: 'blur(18px)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.25, py: 0.75, borderBottom: expanded ? '1px solid rgba(255,255,255,0.08)' : 'none' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1, minWidth: 0 }} noWrap>
          Downloads
        </Typography>
        {activeCount > 0 && <Chip size="small" color="primary" label={activeCount === 1 ? '1 active' : `${activeCount} active`} />}
        {finishedCount > 0 && <Chip size="small" variant="outlined" label={finishedCount === 1 ? '1 done' : `${finishedCount} done`} />}
        {finishedCount > 0 && (
          <IconButton size="small" onClick={onClearFinished} aria-label="clear finished downloads" sx={{ width: 40, height: 40 }}>
            <ClearAllIcon fontSize="small" />
          </IconButton>
        )}
        <IconButton size="small" onClick={() => setExpanded((current) => !current)} aria-label={expanded ? 'collapse downloads' : 'expand downloads'} sx={{ width: 40, height: 40 }}>
          {expanded ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
        </IconButton>
      </Box>

      {expanded && (
        <Box sx={{ maxHeight: { xs: '40dvh', sm: 280 }, overflowY: 'auto', WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
          {downloads.map((download) => {
            const progressPercent = getProgressPercent(download)
            const progressText = buildProgressText(download)

            return (
              <Box key={download.id} sx={{ px: 1.25, py: 1, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                      {download.title}
                    </Typography>
                    {download.fileName && download.status !== 'downloading' && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} noWrap>
                        {download.fileName}
                      </Typography>
                    )}
                  </Box>
                  {download.status === 'downloading'
                    ? (
                      <IconButton size="small" onClick={() => onCancel(download.id)} aria-label="cancel download" sx={{ width: 40, height: 40, flexShrink: 0 }}>
                        <StopCircleOutlinedIcon fontSize="small" />
                      </IconButton>
                    )
                    : (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
                        {download.status === 'completed' && (
                          <IconButton size="small" onClick={() => onSaveAgain(download.id)} aria-label="save download again" sx={{ width: 40, height: 40 }}>
                            <DownloadIcon fontSize="small" />
                          </IconButton>
                        )}
                        <IconButton size="small" onClick={() => onDismiss(download.id)} aria-label="dismiss download" sx={{ width: 40, height: 40 }}>
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    )}
                </Box>

                {download.status === 'downloading' && (
                  <LinearProgress
                    sx={{ mt: 0.75, borderRadius: 999 }}
                    variant={progressPercent != null ? 'determinate' : 'indeterminate'}
                    value={progressPercent ?? undefined}
                  />
                )}

                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                  {download.status === 'downloading' && progressPercent != null
                    ? `Downloading ${progressPercent.toFixed(0)}% • ${progressText}`
                    : progressText}
                </Typography>
              </Box>
            )
          })}
        </Box>
      )}
    </Paper>
  )
}
