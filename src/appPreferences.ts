import type { MediaSection } from './types'
import type { LibraryLayoutId } from './pages/library/libraryConfig'
import type { AppThemeId } from './themes'
import { addDevLog } from './debugLog'

export type LibraryPrimaryAction = 'details' | 'stream'

export type UiPreferences = {
  devOverlayEnabled: boolean
  libraryDisplayMode: 'grid' | 'table'
  appTheme: AppThemeId
  libraryPrimaryAction: LibraryPrimaryAction
  librarySortBy: string
  librarySortDirection: 'asc' | 'desc'
  librarySectionViews: Partial<Record<MediaSection, string>>
  showSidebarLogo: boolean
  libraryViewLayouts: Partial<Record<string, LibraryLayoutId>>
  thoriumWebUrl: string
}

const STORAGE_KEY = 'api_media_player_ui_preferences_v1'

const DEFAULT_UI_PREFERENCES: UiPreferences = {
  devOverlayEnabled: true,
  libraryDisplayMode: 'grid',
  appTheme: 'hydrus-dark',
  libraryPrimaryAction: 'details',
  librarySortBy: 'artist',
  librarySortDirection: 'asc',
  librarySectionViews: {},
  showSidebarLogo: false,
  libraryViewLayouts: {},
  thoriumWebUrl: '',
}

export function loadUiPreferences(): UiPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_UI_PREFERENCES
    const parsed = JSON.parse(raw) as Partial<UiPreferences>
    return {
      ...DEFAULT_UI_PREFERENCES,
      ...parsed,
    }
  } catch {
    return DEFAULT_UI_PREFERENCES
  }
}

export function saveUiPreferences(preferences: Partial<UiPreferences>) {
  try {
    const nextPreferences = {
      ...loadUiPreferences(),
      ...preferences,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextPreferences))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    addDevLog({ kind: 'error', category: 'preferences', message: `Failed to save UI preferences: ${message}` })
  }
}