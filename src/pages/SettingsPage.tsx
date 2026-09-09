import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  FormControl,
  InputLabel,
  Grid,
  Typography,
  List,
  ListItem,
  ListItemText,
  Button,
  IconButton,
  TextField,
  Switch,
  FormControlLabel,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Select
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import DeleteIcon from '@mui/icons-material/Delete'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import EditIcon from '@mui/icons-material/Edit'
import AddIcon from '@mui/icons-material/Add'
import CloudDownloadIcon from '@mui/icons-material/CloudDownload'
import type { LibraryPrimaryAction, UiPreferences } from '../appPreferences'
import { getDefaultThoriumWebUrl } from '../utils/thoriumReader'
import { type LibraryLayoutId } from './library/libraryConfig'
import { LIBRARY_LAYOUT_OPTIONS, viewLayoutKey } from './library/libraryLayouts'
import type { Server } from '../context/ServersContext'
import { useServers } from '../context/ServersContext'
import { buildLibraryCacheKey, getLibraryCacheStats, pruneLibraryCache } from '../libraryCache'
import { syncLibraryCache } from '../librarySync'
import { publishHydrusEpubCatalogFromCache } from '../utils/hydrusEpubCatalog'
import { APP_THEME_PRESETS, type AppThemeId } from '../themes'
import { getEnvHydrusDefaults } from '../envDefaults'
import { formatBytes } from '../utils/formatBytes'
type ServerForm = Omit<Server, 'id' | 'lastTest' | 'host' | 'port'> & {
  endpoint: string
}

function createDefaultServerForm(): ServerForm {
  const defaults = getEnvHydrusDefaults()
  return {
    name: defaults.host ? (defaults.proxyEnabled || defaults.host === '/hydrus-proxy' ? 'Hydrus (proxy)' : 'Hydrus') : '',
    endpoint: defaults.host || '',
    apiKey: defaults.apiKey || '',
    ssl: defaults.ssl,
    forceApiKeyInQuery: defaults.forceApiKeyInQuery,
  }
}

const DEFAULT_SERVER_FORM: ServerForm = createDefaultServerForm()

function buildServerEndpointValue(server: Pick<Server, 'host' | 'port' | 'ssl'>) {
  const rawHost = (server.host || '').trim()
  if (!rawHost) return ''
  if (rawHost.startsWith('/')) return rawHost

  let endpoint = rawHost
  if (!/^https?:\/\//i.test(endpoint)) {
    endpoint = `${server.ssl ? 'https' : 'http'}://${endpoint}`
  }

  try {
    const parsed = new URL(endpoint)
    if (server.port && !parsed.port) parsed.port = String(server.port)
    const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/$/, '') : ''
    return `${parsed.origin}${path}`
  } catch {
    return `${rawHost}${server.port ? `:${server.port}` : ''}`
  }
}

function normalizeServerForm(form: ServerForm) {
  return {
    ...form,
    name: (form.name || '').trim(),
    endpoint: (form.endpoint || '').trim(),
    apiKey: (form.apiKey || '').replace(/\s+/g, ''),
  }
}

function resolveFormEndpointUrl(endpoint: string, ssl: boolean) {
  const trimmed = (endpoint || '').trim()
  if (!trimmed || trimmed.startsWith('/')) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `${ssl ? 'https' : 'http'}://${trimmed}`
}

function endpointIsHttpHydrus(endpoint: string, ssl: boolean) {
  const resolved = resolveFormEndpointUrl(endpoint, ssl)
  return !!resolved && /^http:\/\//i.test(resolved)
}

function endpointMatchesConfiguredProxy(endpoint: string, ssl: boolean) {
  const resolved = resolveFormEndpointUrl(endpoint, ssl)
  const proxyTarget = getEnvHydrusDefaults().proxyTarget
  if (!resolved || !proxyTarget) return false
  try {
    return new URL(resolved).origin === new URL(proxyTarget).origin
  } catch {
    return false
  }
}

function validateServerForm(form: ServerForm) {
  const normalized = normalizeServerForm(form)

  if (!normalized.endpoint) {
    return { normalized, config: null, error: 'Server URL is required.' }
  }

  // Same-origin reverse proxy path used when this app is HTTPS and Hydrus is HTTP.
  if (normalized.endpoint.startsWith('/')) {
    if (!/^\/[A-Za-z0-9._~/-]*$/.test(normalized.endpoint)) {
      return { normalized, config: null, error: 'Proxy path is invalid. Example: /hydrus-proxy' }
    }

    if (normalized.apiKey && !/^[a-f0-9]{64}$/i.test(normalized.apiKey)) {
      return { normalized, config: null, error: 'API key should be a 64-character hexadecimal key. Any pasted spaces or line breaks were removed automatically.' }
    }

    const config: Omit<Server, 'id' | 'lastTest'> = {
      name: normalized.name,
      host: normalized.endpoint.replace(/\/+$/, '') || '/',
      port: undefined,
      apiKey: normalized.apiKey,
      ssl: typeof window !== 'undefined' ? window.location.protocol === 'https:' : true,
      forceApiKeyInQuery: normalized.forceApiKeyInQuery,
      syncSummary: form.syncSummary,
    }

    return { normalized: { ...normalized, ssl: config.ssl }, config, error: null }
  }

  try {
    let candidate = normalized.endpoint
    if (!/^https?:\/\//i.test(candidate)) {
      candidate = `${normalized.ssl ? 'https' : 'http'}://${candidate}`
    }

    const parsed = new URL(candidate)
    if (!parsed.hostname) {
      return { normalized, config: null, error: 'Server URL is invalid. Use an IP, hostname, full URL, or /hydrus-proxy.' }
    }

    if (parsed.port) {
      const portNumber = Number(parsed.port)
      if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
        return { normalized, config: null, error: 'Port must be between 1 and 65535.' }
      }
    }

    if (normalized.apiKey && !/^[a-f0-9]{64}$/i.test(normalized.apiKey)) {
      return { normalized, config: null, error: 'API key should be a 64-character hexadecimal key. Any pasted spaces or line breaks were removed automatically.' }
    }

    const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/$/, '') : ''
    const config: Omit<Server, 'id' | 'lastTest'> = {
      name: normalized.name,
      host: `${parsed.protocol}//${parsed.hostname}${path}`,
      port: parsed.port || undefined,
      apiKey: normalized.apiKey,
      ssl: parsed.protocol === 'https:',
      forceApiKeyInQuery: normalized.forceApiKeyInQuery,
      syncSummary: form.syncSummary,
    }

    return { normalized: { ...normalized, ssl: config.ssl }, config, error: null }
  } catch {
    return { normalized, config: null, error: 'Server URL is invalid. Use an IP, hostname, full URL, or /hydrus-proxy.' }
  }
}

type SettingsPageProps = {
  onClose?: () => void
  preferences: UiPreferences
  onSavePreferences: (preferences: Partial<UiPreferences>) => void
}

export default function SettingsPage({ onClose, preferences, onSavePreferences }: SettingsPageProps) {
  const { servers, addServer, updateServer, removeServer, testServerById, testServerConfig, setActiveServerId, activeServerId } = useServers()
  const isFirstServerSetup = servers.length === 0
  const [editing, setEditing] = useState<Server | null>(null)
  const [form, setForm] = useState<ServerForm>(DEFAULT_SERVER_FORM)
  const [testing, setTesting] = useState(false)
  const [syncingServerId, setSyncingServerId] = useState<string | null>(null)
  const [lastTest, setLastTest] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailsText, setDetailsText] = useState<string | null>(null)
  const audioTracksLayoutKey = viewLayoutKey('audio', 'tracks')
  const videoEpisodeLayoutKey = viewLayoutKey('video', 'tracks')
  const [draft, setDraft] = useState<UiPreferences>(preferences)
  const [syncCompletionNotices, setSyncCompletionNotices] = useState<Record<string, string>>({})
  const [cacheStorageText, setCacheStorageText] = useState('0 B')
  const [cacheTrackCount, setCacheTrackCount] = useState(0)
  const [cacheSnapshotCount, setCacheSnapshotCount] = useState(0)
  const [cacheUpdatedAt, setCacheUpdatedAt] = useState<number | null>(null)
  const syncNoticeTimeoutsRef = useRef<Record<string, number>>({})
  const currentCacheKey = useMemo(() => buildLibraryCacheKey(servers), [servers])

  useEffect(() => {
    setDraft(preferences)
  }, [preferences])

  useEffect(() => {
    return () => {
      Object.values(syncNoticeTimeoutsRef.current).forEach((timeoutId) => window.clearTimeout(timeoutId))
    }
  }, [])

  const currentAudioTracksLayout = preferences.libraryViewLayouts[audioTracksLayoutKey] || 'nested-catalog'
  const currentVideoEpisodeLayout = preferences.libraryViewLayouts[videoEpisodeLayoutKey] || 'nested-catalog'
  const draftAudioTracksLayout = draft.libraryViewLayouts[audioTracksLayoutKey] || 'nested-catalog'
  const draftVideoEpisodeLayout = draft.libraryViewLayouts[videoEpisodeLayoutKey] || 'nested-catalog'
  const preferencesDirty = draft.appTheme !== preferences.appTheme
    || draft.libraryDisplayMode !== preferences.libraryDisplayMode
    || draft.libraryPrimaryAction !== preferences.libraryPrimaryAction
    || draft.devOverlayEnabled !== preferences.devOverlayEnabled
    || draft.showSidebarLogo !== preferences.showSidebarLogo
    || (draft.thoriumWebUrl || '') !== (preferences.thoriumWebUrl || '')
    || draftAudioTracksLayout !== currentAudioTracksLayout
    || draftVideoEpisodeLayout !== currentVideoEpisodeLayout

  const refreshCacheStats = async (cacheKey: string) => {
    if (!cacheKey) {
      setCacheStorageText('0 B')
      setCacheTrackCount(0)
      setCacheSnapshotCount(0)
      setCacheUpdatedAt(null)
      return
    }

    await pruneLibraryCache(cacheKey)
    const stats = await getLibraryCacheStats(cacheKey)
      setCacheStorageText(formatBytes(stats.activeBytes) || '0 B')
      setCacheTrackCount(stats.trackCount)
      setCacheSnapshotCount(stats.snapshotCount)
    setCacheUpdatedAt(stats.updatedAt)
  }

  const startAdd = () => {
    setEditing(null)
    setForm(DEFAULT_SERVER_FORM)
    setLastTest(null)
  }

  const startEdit = (s: Server) => {
    setEditing(s)
    setForm({ name: s.name || '', endpoint: buildServerEndpointValue(s), apiKey: s.apiKey || '', ssl: !!s.ssl, forceApiKeyInQuery: !!s.forceApiKeyInQuery, syncSummary: s.syncSummary })
    setLastTest(s.lastTest ? `${s.lastTest.message} (${new Date(s.lastTest.timestamp).toLocaleString()})` : null)
  }

  const handleSave = () => {
    const { normalized, config, error } = validateServerForm(form)
    if (error) {
      setLastTest(error)
      return
    }

    setForm(normalized)
    if (!config) return
    if (editing) {
      updateServer(editing.id, config)
    } else {
      const srv = addServer(config)
      setActiveServerId(srv.id)
    }
    onClose && onClose()
  }

  const handleDelete = (s: Server) => {
    if (confirm(`Delete server ${s.name || s.host}?`)) {
      removeServer(s.id)
    }
  }

  const handleTestExisting = async (s: Server) => {
    setTesting(true)
    try {
      const res = await testServerById(s.id)
      setLastTest(`${res.message}`)
    } catch (error: unknown) {
      setLastTest(`Error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setTesting(false)
    }
  }

  const handleTestForm = async () => {
    const { normalized, config, error } = validateServerForm(form)
    if (error) {
      setLastTest(error)
      return
    }

    setForm(normalized)
    if (!config) return
    setTesting(true)
    try {
      const res = await testServerConfig(config)
      setLastTest(`${res.message}`)
    } catch (error: unknown) {
      setLastTest(`Error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setTesting(false)
    }
  }

  const handleSyncServer = async (server: Server) => {
    setSyncingServerId(server.id)

    try {
      const result = await syncLibraryCache(servers, { targetServerIds: [server.id] })
      const summary = result.summaries[server.id]
      if (!summary) throw new Error('Sync did not return a server summary')

      updateServer(server.id, { syncSummary: summary })

      if (summary.message) {
        setLastTest(summary.message)
        await refreshCacheStats(result.cacheKey)
        return
      }

      const addedCount = result.addedCounts[server.id] ?? 0
      const removedCount = result.removedCounts[server.id] ?? 0
      let catalogCount = 0
      try {
        catalogCount = await publishHydrusEpubCatalogFromCache(result.cacheKey)
      } catch {
        catalogCount = 0
      }
      const completionMessage = addedCount === 0 && removedCount === 0
        ? `Sync complete. No file changes. ${summary.total} cached items. ${catalogCount} EPUBs sent to Thorium.`
        : `Sync complete. Added ${addedCount} files, removed ${removedCount} files. ${catalogCount} EPUBs sent to Thorium.`
      setLastTest(`Sync complete. ${summary.total} cached items. ${catalogCount} EPUBs sent to Thorium.`)
      setSyncCompletionNotices((current) => ({ ...current, [server.id]: completionMessage }))
      await refreshCacheStats(result.cacheKey)
      if (syncNoticeTimeoutsRef.current[server.id]) {
        window.clearTimeout(syncNoticeTimeoutsRef.current[server.id])
      }
      syncNoticeTimeoutsRef.current[server.id] = window.setTimeout(() => {
        setSyncCompletionNotices((current) => {
          const next = { ...current }
          delete next[server.id]
          return next
        })
        delete syncNoticeTimeoutsRef.current[server.id]
      }, 8000)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      updateServer(server.id, {
        syncSummary: {
          updatedAt: Date.now(),
          total: 0,
          counts: {},
          message: `Sync failed: ${message}`,
        },
      })
      setLastTest(`Sync failed: ${message}`)
    } finally {
      setSyncingServerId(null)
    }
  }

  useEffect(() => {
    void refreshCacheStats(currentCacheKey)
  }, [currentCacheKey])

  const handleSavePreferences = () => {
    onSavePreferences({
      appTheme: draft.appTheme,
      libraryDisplayMode: draft.libraryDisplayMode,
      libraryPrimaryAction: draft.libraryPrimaryAction,
      devOverlayEnabled: draft.devOverlayEnabled,
      showSidebarLogo: draft.showSidebarLogo,
      thoriumWebUrl: (draft.thoriumWebUrl || '').trim(),
      libraryViewLayouts: {
        ...preferences.libraryViewLayouts,
        [audioTracksLayoutKey]: draftAudioTracksLayout,
        [videoEpisodeLayoutKey]: draftVideoEpisodeLayout,
      },
    })
  }

  return (
    <Box sx={{ p: { xs: 1, sm: 2, lg: 3 }, minHeight: '100%', bgcolor: 'background.default' }}>
      <Box sx={{ width: '100%', maxWidth: 1280, mx: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            {!isFirstServerSetup && (
              <IconButton onClick={() => onClose && onClose()} aria-label="back" size="large" sx={{ mr: 1 }}>
                <ArrowBackIcon />
              </IconButton>
            )}
            <Box>
              <Typography variant="h6">{isFirstServerSetup ? 'Connect to Hydrus' : 'Hydrus Servers'}</Typography>
              {isFirstServerSetup && (
                <Typography variant="body2" color="text.secondary">
                  Add your Hydrus Client API host, port, and API key before browsing the library.
                </Typography>
              )}
            </Box>
          </Box>
        </Box>

        {!isFirstServerSetup && (
          <>
            <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 2, bgcolor: 'background.paper', p: { xs: 1.5, sm: 2 }, mb: { xs: 2, lg: 3 } }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 1.5, flexWrap: 'wrap' }}>
                <Box>
                  <Typography variant="subtitle1" sx={{ mb: 0.5 }}>Interface preferences</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Personalize the look and default actions without affecting your cached library.
                  </Typography>
                </Box>
                <Button variant="contained" onClick={handleSavePreferences} disabled={!preferencesDirty}>
                  Save preferences
                </Button>
              </Box>

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 240px))' }, gap: 1.5, mb: import.meta.env.DEV ? 2 : 0 }}>
                <FormControl size="small">
                  <InputLabel id="settings-app-theme-label">Theme</InputLabel>
                  <Select
                    labelId="settings-app-theme-label"
                    value={draft.appTheme}
                    label="Theme"
                    onChange={(event) => setDraft((current) => ({ ...current, appTheme: event.target.value as AppThemeId }))}
                  >
                    {APP_THEME_PRESETS.map((theme) => (
                      <MenuItem key={theme.id} value={theme.id}>{theme.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small">
                  <InputLabel id="settings-library-display-mode-label">Display</InputLabel>
                  <Select
                    labelId="settings-library-display-mode-label"
                    value={draft.libraryDisplayMode}
                    label="Display"
                    onChange={(event) => setDraft((current) => ({ ...current, libraryDisplayMode: event.target.value as 'grid' | 'table' }))}
                  >
                    <MenuItem value="grid">Grid</MenuItem>
                    <MenuItem value="table">Table</MenuItem>
                  </Select>
                </FormControl>

                <FormControl size="small">
                  <InputLabel id="settings-library-primary-action-label">Track tap</InputLabel>
                  <Select
                    labelId="settings-library-primary-action-label"
                    value={draft.libraryPrimaryAction}
                    label="Track tap"
                    onChange={(event) => setDraft((current) => ({ ...current, libraryPrimaryAction: event.target.value as LibraryPrimaryAction }))}
                  >
                    <MenuItem value="details">Open details popup</MenuItem>
                    <MenuItem value="stream">Stream immediately</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              <FormControlLabel
                control={<Switch checked={draft.showSidebarLogo} onChange={(event) => setDraft((current) => ({ ...current, showSidebarLogo: event.target.checked }))} />}
                label={draft.showSidebarLogo ? 'Sidebar logo shown' : 'Sidebar logo hidden'}
                sx={{ alignItems: 'center', m: 0, mt: 1.5 }}
              />

              <TextField
                size="small"
                label="Thorium Web URL"
                placeholder={getDefaultThoriumWebUrl()}
                value={draft.thoriumWebUrl}
                onChange={(event) => setDraft((current) => ({ ...current, thoriumWebUrl: event.target.value }))}
                helperText="EPUB files open in Thorium Web. PDFs open in the browser reader. Leave blank to use localhost:3000."
                sx={{ mt: 2, maxWidth: 480 }}
                fullWidth
              />

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 240px))' }, gap: 1.5, mt: 2 }}>
                <FormControl size="small">
                  <InputLabel id="settings-audio-tracks-layout-label">Audio tracks</InputLabel>
                  <Select
                    labelId="settings-audio-tracks-layout-label"
                      value={draftAudioTracksLayout}
                      label="Audio tracks"
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        libraryViewLayouts: { ...current.libraryViewLayouts, [audioTracksLayoutKey]: event.target.value as LibraryLayoutId },
                      }))}
                  >
                    {LIBRARY_LAYOUT_OPTIONS.map((layout) => (
                      <MenuItem key={layout.id} value={layout.id}>{layout.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small">
                  <InputLabel id="settings-video-episode-layout-label">Video episodes</InputLabel>
                  <Select
                    labelId="settings-video-episode-layout-label"
                      value={draftVideoEpisodeLayout}
                      label="Video episodes"
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        libraryViewLayouts: { ...current.libraryViewLayouts, [videoEpisodeLayoutKey]: event.target.value as LibraryLayoutId },
                      }))}
                  >
                    {LIBRARY_LAYOUT_OPTIONS.map((layout) => (
                      <MenuItem key={layout.id} value={layout.id}>{layout.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: import.meta.env.DEV ? 2 : 0.5 }}>
                {APP_THEME_PRESETS.map((theme) => (
                  <Chip key={theme.id} label={theme.label} color={draft.appTheme === theme.id ? 'primary' : 'default'} variant={draft.appTheme === theme.id ? 'filled' : 'outlined'} />
                ))}
              </Box>

              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: import.meta.env.DEV ? 0.5 : 0 }}>
                {APP_THEME_PRESETS.find((theme) => theme.id === draft.appTheme)?.description}
              </Typography>

              {import.meta.env.DEV && (
                <>
                  <Typography variant="subtitle1" sx={{ mb: 0.5 }}>Developer tools</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Control development-only UI that can get in the way on smaller screens.
                  </Typography>
                  <FormControlLabel
                    control={<Switch checked={draft.devOverlayEnabled} onChange={(event) => setDraft((current) => ({ ...current, devOverlayEnabled: event.target.checked }))} />}
                    label={draft.devOverlayEnabled ? 'Floating dev overlay enabled' : 'Floating dev overlay disabled'}
                    sx={{ alignItems: 'flex-start', m: 0 }}
                  />
                </>
              )}
            </Box>

            <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 2, bgcolor: 'background.paper', p: { xs: 1.5, sm: 2 }, mb: { xs: 2, lg: 3 } }}>
              <Typography variant="subtitle1" sx={{ mb: 0.5 }}>Library cache</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                The app keeps one active IndexedDB snapshot and automatically removes older sync cache snapshots.
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip label={`Storage: ${cacheStorageText}`} size="small" color="primary" variant="outlined" />
                <Chip label={`Tracks: ${cacheTrackCount}`} size="small" variant="outlined" />
                <Chip label={`Snapshots kept: ${cacheSnapshotCount}`} size="small" variant="outlined" />
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                {cacheUpdatedAt ? `Cache updated: ${new Date(cacheUpdatedAt).toLocaleString()}` : 'Cache has not been written yet.'}
              </Typography>
            </Box>
          </>
        )}

        <Grid container spacing={{ xs: 2, lg: 3 }} alignItems="flex-start">
          {!isFirstServerSetup && (
          <Grid item xs={12} lg={5}>
            <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 2, bgcolor: 'background.paper', p: { xs: 1.5, sm: 2 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle1">Configured servers</Typography>
                <Button startIcon={<AddIcon />} onClick={startAdd} size="large" className="touch-target">
                  Add
                </Button>
              </Box>

              <FormControl size="small" fullWidth sx={{ mb: 2 }}>
                <InputLabel id="settings-library-source-label">Library source</InputLabel>
                <Select
                  labelId="settings-library-source-label"
                  value={activeServerId || 'all'}
                  label="Library source"
                  onChange={(event) => setActiveServerId(event.target.value === 'all' ? null : event.target.value)}
                >
                  <MenuItem value="all">All servers</MenuItem>
                  {servers.map((server) => (
                    <MenuItem key={server.id} value={server.id}>{server.name || server.host}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <List>
                {servers.length === 0 && <Typography color="text.secondary">No servers configured yet</Typography>}
                {servers.map((s) => (
                  <ListItem key={s.id} sx={{ flexWrap: 'wrap', alignItems: 'flex-start', px: 0, py: 1.25, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <ListItemText primary={s.name || s.host} secondary={s.host} sx={{ mr: 2 }} />
                    <Box sx={{ display: 'flex', gap: 1, mt: { xs: 1, md: 0 }, flexWrap: 'wrap', width: { xs: '100%', md: 'auto' } }}>
                      <Button size="large" onClick={() => setActiveServerId(s.id)} className="touch-target" sx={{ flexGrow: { xs: 1, sm: 0 } }}>
                        {s.id === activeServerId ? 'Active' : 'Set active'}
                      </Button>
                      <Button variant="outlined" size="large" onClick={() => handleTestExisting(s)} startIcon={<PlayArrowIcon />} className="touch-target" sx={{ flexGrow: { xs: 1, sm: 0 } }}>
                        Test
                      </Button>
                      <Button variant="outlined" size="large" onClick={() => handleSyncServer(s)} startIcon={<CloudDownloadIcon />} disabled={syncingServerId === s.id} className="touch-target" sx={{ flexGrow: { xs: 1, sm: 0 } }}>
                        {syncingServerId === s.id ? 'Syncing...' : typeof s.syncSummary?.total === 'number' ? `Sync cache (${s.syncSummary.total})` : 'Sync cache'}
                      </Button>
                      <IconButton size="large" aria-label="edit" onClick={() => startEdit(s)}>
                        <EditIcon />
                      </IconButton>
                      <IconButton size="large" aria-label="delete" onClick={() => handleDelete(s)}>
                        <DeleteIcon />
                      </IconButton>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', width: '100%', mt: 1 }}>
                      {s.lastTest && s.lastTest.message && <Chip label={s.lastTest.message} size="small" />}
                      {typeof s.syncSummary?.total === 'number' && <Chip label={`Cached: ${s.syncSummary.total} items`} size="small" color="primary" variant="outlined" />}
                      {s.syncSummary?.message && <Chip label={s.syncSummary.message} size="small" color="error" variant="outlined" />}
                      {s.syncSummary?.counts && Object.entries(s.syncSummary.counts).map(([section, count]) => (
                        <Chip key={`${s.id}-${section}`} label={`${section}: ${count}`} size="small" variant="outlined" />
                      ))}
                      {s.forceApiKeyInQuery && <Chip label="API key in query" size="small" />}
                    </Box>
                    {syncCompletionNotices[s.id] && (
                      <Alert severity="success" sx={{ width: '100%', mt: 1, py: 0 }}>
                        {syncCompletionNotices[s.id]}
                      </Alert>
                    )}
                    {s.syncSummary?.updatedAt && (
                      <Typography variant="caption" color="text.secondary" sx={{ width: '100%', mt: 1 }}>
                        Last sync: {new Date(s.syncSummary.updatedAt).toLocaleString()}
                      </Typography>
                    )}
                  </ListItem>
                ))}
              </List>
            </Box>
          </Grid>
          )}

          <Grid item xs={12} lg={isFirstServerSetup ? 8 : 7} sx={isFirstServerSetup ? { mx: 'auto' } : undefined}>
            <Box sx={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 2, bgcolor: 'background.paper', p: { xs: 1.5, sm: 2 } }}>
              <Typography variant="subtitle1">{editing ? 'Edit server' : isFirstServerSetup ? 'Add your first server' : 'Add new server'}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Paste the same Hydrus Client API address and API key you use elsewhere.
              </Typography>
              {isFirstServerSetup && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  Nothing is preconfigured. Enter your Hydrus server details below, test the connection, then save the server to unlock the library.
                </Alert>
              )}
              {typeof window !== 'undefined' && window.location.protocol === 'https:' && endpointIsHttpHydrus(form.endpoint, !!form.ssl) && (
                endpointMatchesConfiguredProxy(form.endpoint, !!form.ssl)
                  ? (
                    <Alert severity="info" sx={{ mt: 2 }}>
                      This page is HTTPS. The HTTP Hydrus URL will be reached through this app&apos;s same-origin proxy automatically, so you can keep the real server address.
                    </Alert>
                  )
                  : (
                    <Alert severity="warning" sx={{ mt: 2 }}>
                      This page is HTTPS. Direct HTTP Hydrus URLs are blocked by the browser (often shown as CORS).
                      {getEnvHydrusDefaults().proxyEnabled
                        ? <> Use this Hydrus address if it matches <code>HYDRUS_PROXY_TARGET</code>, or set Server URL to <strong>/hydrus-proxy</strong>.</>
                        : <> Configure <code>HYDRUS_PROXY_TARGET</code> in <code>.env</code>, restart the server, then use the real Hydrus URL or <strong>/hydrus-proxy</strong>.</>}
                    </Alert>
                  )
              )}
              {typeof window !== 'undefined' && form.endpoint.startsWith('/') && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  Using same-origin path <strong>{form.endpoint}</strong>. Requests stay on this HTTPS origin and are forwarded to Hydrus by the app server.
                  {!getEnvHydrusDefaults().proxyEnabled && <> If tests fail, set <code>HYDRUS_PROXY_TARGET</code> and restart with <code>npm start</code>.</>}
                </Alert>
              )}
              <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField label="Name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} fullWidth />
                <TextField label="Server URL" placeholder="http://192.168.1.128:45869" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} fullWidth autoCapitalize="off" autoCorrect="off" spellCheck={false} helperText="Hydrus Client API URL. On HTTPS pages, a matching HTTP server is proxied automatically. Port can be included in a full URL." />
                <TextField label="API Key (optional)" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} fullWidth autoCapitalize="off" autoCorrect="off" spellCheck={false} helperText="Hex API key. Pasted spaces or line breaks are ignored." />
                <FormControlLabel control={<Switch checked={!!form.ssl} onChange={(e) => setForm({ ...form, ssl: e.target.checked })} />} label="Use HTTPS (SSL)" />
                <FormControlLabel control={<Switch checked={!!form.forceApiKeyInQuery} onChange={(e) => setForm({ ...form, forceApiKeyInQuery: e.target.checked })} />} label="Send API key in query parameter" />

                <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                  <Button variant="contained" onClick={handleSave} disabled={!form.endpoint} size="large" className="touch-target" sx={{ flexGrow: { xs: 1, sm: 0 } }}>
                    Save
                  </Button>
                  <Button variant="outlined" onClick={handleTestForm} disabled={!form.endpoint || testing} startIcon={<PlayArrowIcon />} size="large" className="touch-target" sx={{ flexGrow: { xs: 1, sm: 0 } }}>
                    {testing ? 'Testing...' : 'Test connection'}
                  </Button>
                  <Button onClick={() => { setEditing(null); setForm(DEFAULT_SERVER_FORM); setLastTest(null) }} size="large" className="touch-target" sx={{ flexGrow: { xs: 1, sm: 0 } }}>
                    Reset
                  </Button>
                </Box>

                {lastTest && (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="caption">Last test: {lastTest}</Typography>
                    <Box sx={{ mt: 1 }}>
                      <Button size="small" onClick={() => {
                        const obj = editing?.lastTest ?? servers.find((s) => s.id === editing?.id)?.lastTest ?? null
                        setDetailsText(obj ? JSON.stringify(obj, null, 2) : lastTest)
                        setDetailsOpen(true)
                      }}>Show details</Button>
                    </Box>
                  </Box>
                )}

                <Dialog open={detailsOpen} onClose={() => setDetailsOpen(false)} fullWidth maxWidth="md">
                  <DialogTitle>Connection details</DialogTitle>
                  <DialogContent>
                    <Box component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12 }}>{detailsText}</Box>
                  </DialogContent>
                  <DialogActions>
                    <Button onClick={() => setDetailsOpen(false)}>Close</Button>
                  </DialogActions>
                </Dialog>
                </Box>
            </Box>
          </Grid>
        </Grid>
      </Box>
    </Box>
  )
}
