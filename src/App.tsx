import React, { Suspense, lazy, useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { type UiPreferences, loadUiPreferences, saveUiPreferences } from './appPreferences'
import Library from './pages/Library'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import DownloadsOverlay from './components/DownloadsOverlay'
import MediaPlayerOverlay from './components/MediaPlayerOverlay'
import DownloadsPage from './pages/DownloadsPage'
import ErrorBoundary from './components/ErrorBoundary'
import StartupLibraryCacheSync from './components/StartupLibraryCacheSync'
import { Box, CssBaseline, useMediaQuery } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { ACTIVE_KEY, STORAGE_KEY, ServersProvider } from './context/ServersContext'
import { useDownloadManager } from './hooks/useDownloadManager'
import { useExternalPlayback } from './hooks/useExternalPlayback'
import { createAppTheme } from './themes'
import type { MediaSection, Track } from './types'
import { getDevicePlatform } from './utils/devicePlatform'

const devicePlatform = getDevicePlatform()

const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const DevErrorPanel = lazy(() => import('./components/DevErrorPanel'))

function getInitialActivePage(): MediaSection | 'settings' | 'downloads' {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return 'settings'

    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0 ? 'all' : 'settings'
  } catch {
    return 'settings'
  }
}

function App() {
  const [uiPreferences, setUiPreferences] = useState(() => loadUiPreferences())
  const [activePage, setActivePage] = useState<MediaSection | 'settings' | 'downloads'>(() => getInitialActivePage())
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [playingTrack, setPlayingTrack] = useState<Track | null>(null)
  const [libraryItemCount, setLibraryItemCount] = useState<number | null>(null)

  const theme = useMemo(() => createAppTheme(uiPreferences.appTheme), [uiPreferences.appTheme])
  const { isAppleMobileOrTablet, isAndroidMobileOrTablet } = devicePlatform

  const lastBrowsePageRef = useRef<MediaSection>(activePage === 'settings' || activePage === 'downloads' ? 'all' : activePage)
  const isDesktopLayout = useMediaQuery(theme.breakpoints.up('md'))

  const { playNow } = useExternalPlayback({ isAppleMobileOrTablet, isAndroidMobileOrTablet })
  const {
    downloads,
    activeDownloads,
    isTrackDownloading,
    queueDownload,
    cancelDownload,
    saveDownloadAgain,
    dismissDownload,
    clearFinishedDownloads,
  } = useDownloadManager({ isAppleMobileOrTablet })

  const commitUiPreferences = useCallback((patch: Partial<UiPreferences>) => {
    setUiPreferences((prev) => ({ ...prev, ...patch }))
    saveUiPreferences(patch)
  }, [])

  useEffect(() => {
    if (activePage !== 'settings' && activePage !== 'downloads') {
      lastBrowsePageRef.current = activePage
    }
  }, [activePage])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      const hasServers = Array.isArray(parsed) && parsed.length > 0

      if (!hasServers && activePage !== 'settings') {
        setActivePage('settings')
      }

      if (!hasServers) {
        localStorage.removeItem(ACTIVE_KEY)
      }
    } catch {
      if (activePage !== 'settings') {
        setActivePage('settings')
      }
    }
  }, [activePage])

  const toggleSidebar = useCallback(() => {
    if (isDesktopLayout) {
      setDesktopSidebarOpen((open) => !open)
      return
    }
    setMobileSidebarOpen((open) => !open)
  }, [isDesktopLayout])

  const closeSidebar = useCallback(() => setMobileSidebarOpen(false), [])
  const closeSettings = useCallback(() => setActivePage(lastBrowsePageRef.current), [])
  const handleOpenInAppPlayer = useCallback((track: Track) => setPlayingTrack(track), [])
  const handleClosePlayer = useCallback(() => setPlayingTrack(null), [])
  const handleSidebarNavigate = useCallback((id: string) => {
    if (id === 'settings') setActivePage('settings')
    else if (id === 'downloads') setActivePage('downloads')
    else setActivePage(id as MediaSection)

    if (!isDesktopLayout) {
      setMobileSidebarOpen(false)
    }
  }, [isDesktopLayout])

  return (
    <ServersProvider>
      <StartupLibraryCacheSync />
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <ErrorBoundary>
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden', pl: 'env(safe-area-inset-left)', pr: 'env(safe-area-inset-right)' }}>
          <Header
            onToggleSidebar={toggleSidebar}
            searchQuery={libraryQuery}
            onSearchQueryChange={setLibraryQuery}
            searchDisabled={activePage === 'settings' || activePage === 'downloads'}
            itemCount={activePage === 'settings' || activePage === 'downloads' ? null : libraryItemCount}
          />

          <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <Sidebar
              mobileOpen={mobileSidebarOpen}
              desktopOpen={desktopSidebarOpen}
              onMobileClose={closeSidebar}
              onNavigate={handleSidebarNavigate}
              activeId={activePage}
              showLogo={uiPreferences.showSidebarLogo}
            />

            <Box sx={{ flex: 1, overflow: 'auto', pb: 2, minWidth: 0, WebkitOverflowScrolling: 'touch' }}>
              {activePage === 'settings'
                ? (
                  <Suspense fallback={null}>
                    <SettingsPage
                      onClose={closeSettings}
                      preferences={uiPreferences}
                      onSavePreferences={commitUiPreferences}
                    />
                  </Suspense>
                )
                : activePage === 'downloads'
                  ? (
                    <DownloadsPage
                      downloads={downloads}
                      onCancel={cancelDownload}
                      onSaveAgain={saveDownloadAgain}
                      onDismiss={dismissDownload}
                      onClearFinished={clearFinishedDownloads}
                    />
                  )
                  : (
                  <Library
                    mediaSection={activePage}
                    onPlayNow={playNow}
                    onOpenInAppPlayer={handleOpenInAppPlayer}
                    onDownloadTrack={queueDownload}
                    isTrackDownloading={isTrackDownloading}
                    primaryTapAction={uiPreferences.libraryPrimaryAction}
                    query={libraryQuery}
                    onQueryChange={setLibraryQuery}
                    displayModePreference={uiPreferences.libraryDisplayMode}
                    onItemCountChange={setLibraryItemCount}
                    viewLayouts={uiPreferences.libraryViewLayouts}
                  />
                  )}
            </Box>
          </Box>

          {uiPreferences.devOverlayEnabled ? (
            <Suspense fallback={null}>
              <DevErrorPanel />
            </Suspense>
          ) : null}

          {activePage !== 'downloads' ? (
            <DownloadsOverlay
              downloads={activeDownloads}
              onCancel={cancelDownload}
              onSaveAgain={saveDownloadAgain}
              onDismiss={dismissDownload}
              onClearFinished={clearFinishedDownloads}
            />
          ) : null}

          <MediaPlayerOverlay track={playingTrack} onClose={handleClosePlayer} />
        </Box>
        </ErrorBoundary>
      </ThemeProvider>
    </ServersProvider>
  )
}

export default App
