import React, { useMemo } from 'react'
import { Box, Button, Chip, Divider, LinearProgress, Paper, Typography } from '@mui/material'
import type { DownloadOverlayItem } from '../components/DownloadsOverlay'
import { formatBytes } from '../utils/formatBytes'

type DownloadsPageProps = {
  downloads: DownloadOverlayItem[]
  onCancel: (id: string) => void
  onSaveAgain: (id: string) => void
  onDismiss: (id: string) => void
  onClearFinished: () => void
}

function getProgressPercent(download: DownloadOverlayItem) {
  if (!download.totalBytes || download.totalBytes <= 0) return null
  return Math.max(0, Math.min(100, (download.receivedBytes / download.totalBytes) * 100))
}

function getStatusTone(download: DownloadOverlayItem): 'primary' | 'success' | 'warning' | 'error' | 'default' {
  if (download.status === 'completed') return 'success'
  if (download.status === 'cancelled') return 'warning'
  if (download.status === 'error') return 'error'
  if (download.status === 'downloading') return 'primary'
  return 'default'
}

function renderProgressText(download: DownloadOverlayItem) {
  const received = formatBytes(download.receivedBytes)
  const total = formatBytes(download.totalBytes)

  if (download.status === 'downloading') {
    if (download.note) return download.note
    if (received && total) return `${received} of ${total}`
    if (received) return `${received} received`
    return 'Preparing download...'
  }

  if (download.status === 'completed') {
    const parts = ['Saved in browser storage']
    if (total || received) parts.push(total || received || '')
    if (download.note) parts.push(download.note)
    return parts.join(' • ')
  }

  if (download.status === 'cancelled') return 'Cancelled before completion'
  return download.error || 'Download failed'
}

function DownloadRow({ download, onCancel, onSaveAgain, onDismiss }: {
  download: DownloadOverlayItem
  onCancel: (id: string) => void
  onSaveAgain: (id: string) => void
  onDismiss: (id: string) => void
}) {
  const progressPercent = getProgressPercent(download)

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'background.paper' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>
            {download.title}
          </Typography>
          {download.fileName && (
            <Typography variant="body2" color="text.secondary" noWrap>
              {download.fileName}
            </Typography>
          )}
        </Box>
        <Chip size="small" color={getStatusTone(download)} label={download.status === 'downloading' ? 'Downloading' : download.status === 'completed' ? 'Ready' : download.status === 'cancelled' ? 'Cancelled' : 'Error'} />
      </Box>

      {download.status === 'downloading' && (
        <LinearProgress
          sx={{ mt: 1.5 }}
          variant={progressPercent != null ? 'determinate' : 'indeterminate'}
          value={progressPercent ?? undefined}
        />
      )}

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {download.status === 'downloading' && progressPercent != null
          ? `Downloading ${progressPercent.toFixed(0)}% • ${renderProgressText(download)}`
          : renderProgressText(download)}
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
        {download.status === 'downloading' ? (
          <Button variant="outlined" color="warning" onClick={() => onCancel(download.id)}>
            Cancel
          </Button>
        ) : null}
        {download.status === 'completed' && download.saveHref ? (
          <Button variant="contained" onClick={() => onSaveAgain(download.id)}>
            Download Again
          </Button>
        ) : null}
        <Button variant="text" color="inherit" onClick={() => onDismiss(download.id)}>
          Remove
        </Button>
      </Box>
    </Paper>
  )
}

export default function DownloadsPage({ downloads, onCancel, onSaveAgain, onDismiss, onClearFinished }: DownloadsPageProps) {
  const activeDownloads = useMemo(() => downloads.filter((download) => download.status === 'downloading'), [downloads])
  const finishedDownloads = useMemo(() => downloads.filter((download) => download.status !== 'downloading'), [downloads])

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1100, mx: 'auto', width: '100%' }}>
      <Typography variant="h4" sx={{ fontSize: { xs: '1.6rem', md: '2rem' }, fontWeight: 700, mb: 1 }}>
        Downloads
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
        Finished downloads stay available across refreshes until you remove them from this page.
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2.5 }}>
        <Chip color="primary" variant="outlined" label={activeDownloads.length === 1 ? '1 active download' : `${activeDownloads.length} active downloads`} />
        <Chip color="success" variant="outlined" label={finishedDownloads.length === 1 ? '1 stored item' : `${finishedDownloads.length} stored items`} />
        {finishedDownloads.length > 0 && (
          <Button variant="text" onClick={onClearFinished}>
            Clear Finished
          </Button>
        )}
      </Box>

      <Box sx={{ display: 'grid', gap: 3 }}>
        <Box>
          <Typography variant="h6" sx={{ mb: 1.5 }}>
            Active
          </Typography>
          {activeDownloads.length > 0 ? (
            <Box sx={{ display: 'grid', gap: 1.5 }}>
              {activeDownloads.map((download) => (
                <DownloadRow
                  key={download.id}
                  download={download}
                  onCancel={onCancel}
                  onSaveAgain={onSaveAgain}
                  onDismiss={onDismiss}
                />
              ))}
            </Box>
          ) : (
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Typography variant="body2" color="text.secondary">
                No active downloads.
              </Typography>
            </Paper>
          )}
        </Box>

        <Divider flexItem />

        <Box>
          <Typography variant="h6" sx={{ mb: 1.5 }}>
            Stored
          </Typography>
          {finishedDownloads.length > 0 ? (
            <Box sx={{ display: 'grid', gap: 1.5 }}>
              {finishedDownloads.map((download) => (
                <DownloadRow
                  key={download.id}
                  download={download}
                  onCancel={onCancel}
                  onSaveAgain={onSaveAgain}
                  onDismiss={onDismiss}
                />
              ))}
            </Box>
          ) : (
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Typography variant="body2" color="text.secondary">
                Completed and failed downloads will appear here for later download or cleanup.
              </Typography>
            </Paper>
          )}
        </Box>
      </Box>
    </Box>
  )
}