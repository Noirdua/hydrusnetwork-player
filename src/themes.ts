import { createTheme, type PaletteOptions } from '@mui/material/styles'

export type AppThemeId = 'hydrus-dark' | 'ocean' | 'ember' | 'paper' | 'cinema'

type ThemePreset = {
  id: AppThemeId
  label: string
  description: string
}

export const APP_THEME_PRESETS: ThemePreset[] = [
  {
    id: 'hydrus-dark',
    label: 'Hydrus Dark',
    description: 'Dark graphite with the original green accent.',
  },
  {
    id: 'ocean',
    label: 'Ocean',
    description: 'Deep blue panels with a cool cyan accent.',
  },
  {
    id: 'ember',
    label: 'Ember',
    description: 'Warm dark surfaces with a copper highlight.',
  },
  {
    id: 'paper',
    label: 'Paper Light',
    description: 'Clean light interface with ink-blue accents.',
  },
  {
    id: 'cinema',
    label: 'Cinema',
    description: 'Near-black frames with gold highlights for a theater look.',
  },
]

function buildTheme(palette: PaletteOptions) {
  return createTheme({
    palette,
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: "Roboto, -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: { touchAction: 'manipulation' },
          body: { touchAction: 'manipulation' },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            touchAction: 'manipulation',
            minHeight: 40,
            borderRadius: 10,
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            touchAction: 'manipulation',
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            touchAction: 'pan-y',
            backgroundImage: 'none',
          },
        },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: {
            padding: '12px 16px',
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: 48,
            touchAction: 'manipulation',
            textTransform: 'none',
            fontWeight: 600,
          },
        },
      },
    },
  })
}

export function createAppTheme(themeId: AppThemeId) {
  switch (themeId) {
    case 'ocean':
      return buildTheme({
        mode: 'dark',
        primary: { main: '#4cc9f0' },
        secondary: { main: '#90e0ef' },
        background: { default: '#07141d', paper: '#0d1e2b' },
      })
    case 'ember':
      return buildTheme({
        mode: 'dark',
        primary: { main: '#ff7a3d' },
        secondary: { main: '#ffb26b' },
        background: { default: '#17110f', paper: '#241714' },
      })
    case 'paper':
      return buildTheme({
        mode: 'light',
        primary: { main: '#1f4d7a' },
        secondary: { main: '#6785a3' },
        background: { default: '#f2efe8', paper: '#fffdf8' },
      })
    case 'cinema':
      return buildTheme({
        mode: 'dark',
        primary: { main: '#e0b34a' },
        secondary: { main: '#f3d58a' },
        background: { default: '#070708', paper: '#121214' },
      })
    case 'hydrus-dark':
    default:
      return buildTheme({
        mode: 'dark',
        primary: { main: '#1db954' },
        secondary: { main: '#6ee7a2' },
        background: { default: '#0c0d10', paper: '#14161a' },
      })
  }
}
