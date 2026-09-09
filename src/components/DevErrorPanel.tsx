import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button, Paper, Typography, List, ListItem, ListItemText, IconButton, Chip } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import { addDevLog, clearDevLogs, getDevLogs, subscribeDevLogs, type DevLogItem } from '../debugLog'

function formatLogItem(log: DevLogItem) {
  return [
    `${log.kind} - ${new Date(log.time).toLocaleString()}`,
    log.category ? `category: ${log.category}` : null,
    `message: ${log.message}`,
    log.source ? `source: ${log.source}` : null,
    log.stack ? `stack:\n${log.stack}` : null,
    log.details ? `details:\n${log.details}` : null,
  ].filter(Boolean).join('\n')
}

export default function DevErrorPanel() {
  const [logs, setLogs] = useState<DevLogItem[]>(() => getDevLogs())
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const errorCount = useMemo(() => logs.filter((item) => item.kind !== 'debug').length, [logs])
  const previousErrorCountRef = useRef(errorCount)

  const copyLog = async (log: DevLogItem) => {
    const payload = formatLogItem(log)
    try {
      await navigator.clipboard.writeText(payload)
      addDevLog({ kind: 'debug', category: 'dev-log-panel', message: 'Copied log entry', details: { copiedId: log.id } })
    } catch (error: any) {
      addDevLog({ kind: 'error', category: 'dev-log-panel', message: 'Clipboard copy failed', details: { copiedId: log.id, name: error?.name, message: error?.message ?? String(error) } })
    }
  }

  useEffect(() => {
    return subscribeDevLogs((items) => {
      setLogs(items)
      const nextErrorCount = items.filter((item) => item.kind !== 'debug').length
      const hasNewError = nextErrorCount > previousErrorCountRef.current
      previousErrorCountRef.current = nextErrorCount

      if (hasNewError) {
        setDismissed(false)
        setOpen(true)
      }
    })
  }, [])

  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      try {
        const item = { kind: 'error' as const, category: 'window', message: e.message || 'Error', stack: (e.error && (e.error.stack || e.error.message)) || undefined, source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined }
        addDevLog(item)
        // also log to console for developer convenience
        // eslint-disable-next-line no-console
        console.error('[DevErrorPanel] window.error', item)
      } catch (_) {}
    }

    const onRejection = (e: PromiseRejectionEvent) => {
      try {
        const reason: any = e.reason
        const item = { kind: 'unhandledrejection' as const, category: 'window', message: (reason && (reason.message || String(reason))) || 'Unhandled rejection', stack: reason && reason.stack ? String(reason.stack) : undefined }
        addDevLog(item)
        // eslint-disable-next-line no-console
        console.error('[DevErrorPanel] unhandledrejection', item)
      } catch (_) {}
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  if (!import.meta.env.DEV) return null

  if (dismissed) {
    return (
      <Box sx={{ position: 'fixed', top: 12, right: 12, zIndex: 9999 }}>
        <Chip
          label={`Dev Logs${errorCount ? ` (${errorCount})` : ''}`}
          color={errorCount ? 'error' : 'default'}
          clickable
          onClick={() => {
            setDismissed(false)
            setOpen(true)
          }}
        />
      </Box>
    )
  }

  return (
    <Box sx={{ position: 'fixed', top: 12, right: 12, zIndex: 9999 }}>
      <Paper elevation={6} sx={{ minWidth: { xs: 0, sm: 320 }, width: { xs: 'calc(100vw - 24px)', sm: 'auto' }, maxWidth: { xs: 'calc(100vw - 24px)', sm: 640 }, p: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip label={`Logs: ${logs.length}`} color={logs.length ? 'info' : 'default'} size="small" clickable onClick={() => setOpen((v) => !v)} />
            <Chip label={`Errors: ${errorCount}`} color={errorCount ? 'error' : 'default'} size="small" clickable onClick={() => setOpen((v) => !v)} />
            <Typography variant="subtitle2">Dev Log Panel</Typography>
          </Box>
          <Box>
            <Button size="small" onClick={() => { clearDevLogs() }} sx={{ mr: 1 }}>Clear</Button>
            <IconButton size="small" onClick={() => { setDismissed(true); setOpen(false) }} aria-label="dismiss dev log panel" sx={{ width: 32, height: 32 }}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        </Box>

        {open && (
          <List sx={{ maxHeight: 300, overflow: 'auto', p: 0 }}>
            {logs.map((l) => (
              <ListItem key={l.id} divider alignItems="flex-start">
                <ListItemText primary={`${l.kind} — ${new Date(l.time).toLocaleTimeString()}`} secondary={<>
                  <Typography component="div" variant="body2">{l.message}</Typography>
                  {l.category && <Typography component="div" variant="caption" sx={{ color: 'text.secondary' }}>{l.category}</Typography>}
                  {l.source && <Typography component="div" variant="caption" sx={{ color: 'text.secondary' }}>{l.source}</Typography>}
                  {l.stack && <Typography component="pre" variant="caption" sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }}>{l.stack}</Typography>}
                  {l.details && <Typography component="pre" variant="caption" sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }}>{l.details}</Typography>}
                </>} />
                <IconButton edge="end" size="small" aria-label="copy log entry" onClick={() => { void copyLog(l) }} sx={{ ml: 1, alignSelf: 'flex-start' }}>
                  <ContentCopyIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
    </Box>
  )
}
