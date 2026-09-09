import React from 'react'
import { Box, Drawer, List, ListItemButton, ListItemIcon, ListItemText, Typography, Divider, useMediaQuery } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useOverlayZoomLock } from '../hooks/useOverlayZoomLock'
import AudiotrackIcon from '@mui/icons-material/Audiotrack'
import MovieIcon from '@mui/icons-material/Movie'
import ImageIcon from '@mui/icons-material/Image'
import AppsIcon from '@mui/icons-material/Apps'
import MenuBookIcon from '@mui/icons-material/MenuBook'
import DownloadIcon from '@mui/icons-material/Download'
import LibraryMusicIcon from '@mui/icons-material/LibraryMusic'
import SettingsIcon from '@mui/icons-material/Settings'
import type { MediaSection } from '../types'

export const drawerWidth = 240

type NavItem = {
  id: MediaSection | 'downloads'
  label: string
  icon: React.ReactNode
}

const ITEMS: NavItem[] = [
  { id: 'all', label: 'All', icon: <LibraryMusicIcon /> },
  { id: 'audio', label: 'Audio', icon: <AudiotrackIcon /> },
  { id: 'video', label: 'Video', icon: <MovieIcon /> },
  { id: 'image', label: 'Image', icon: <ImageIcon /> },
  { id: 'books', label: 'Books', icon: <MenuBookIcon /> },
  { id: 'application', label: 'Applications', icon: <AppsIcon /> },
  { id: 'downloads', label: 'Downloads', icon: <DownloadIcon /> },
]

export default function Sidebar({
  mobileOpen,
  desktopOpen = true,
  onMobileClose,
  onNavigate,
  activeId,
  showLogo = false,
}: {
  mobileOpen?: boolean
  desktopOpen?: boolean
  onMobileClose?: () => void
  onNavigate?: (id: string) => void
  activeId?: string
  showLogo?: boolean
}) {
  const theme = useTheme()
  const isMobileDrawer = useMediaQuery(theme.breakpoints.down('md'))
  useOverlayZoomLock(Boolean(mobileOpen) && isMobileDrawer)

  const handleNavigate = (id: string) => {
    onNavigate?.(id)
    onMobileClose?.()
  }

  const content = (
    <Box sx={{ width: drawerWidth, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {showLogo && (
        <>
          <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 36, height: 36, borderRadius: 1, background: 'linear-gradient(135deg,#1db954,#1ed760)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700 }}>
              H
            </Box>
            <Typography variant="h6" component="div" sx={{ fontSize: 16, fontWeight: 600 }}>
              Hydrus
            </Typography>
          </Box>
          <Divider sx={{ opacity: 0.08 }} />
        </>
      )}

      <List sx={{ p: 1, flex: 1 }}>
        {ITEMS.map((it) => (
          <ListItemButton
            key={it.id}
            selected={activeId === it.id}
            onClick={() => handleNavigate(it.id)}
            sx={{
              borderRadius: 1.5,
              mb: 0.5,
              minHeight: 44,
              transition: 'background-color 180ms ease, transform 180ms ease',
              '&.Mui-selected': {
                bgcolor: 'action.selected',
                '&:hover': { bgcolor: 'action.selected' },
              },
            }}
          >
            <ListItemIcon sx={{ color: 'inherit', minWidth: 40 }}>{it.icon}</ListItemIcon>
            <ListItemText primary={it.label} primaryTypographyProps={{ fontSize: 14 }} />
          </ListItemButton>
        ))}
      </List>

      <Divider sx={{ opacity: 0.08 }} />

      <Box sx={{ p: 1 }}>
        <ListItemButton
          selected={activeId === 'settings'}
          onClick={() => handleNavigate('settings')}
          sx={{
            borderRadius: 1.5,
            minHeight: 44,
            '&.Mui-selected': {
              bgcolor: 'action.selected',
              '&:hover': { bgcolor: 'action.selected' },
            },
          }}
        >
          <ListItemIcon sx={{ color: 'inherit', minWidth: 40 }}>
            <SettingsIcon />
          </ListItemIcon>
          <ListItemText primary="Settings" primaryTypographyProps={{ fontSize: 14 }} />
        </ListItemButton>
      </Box>
    </Box>
  )

  return (
    <>
      <Box
        sx={{
          display: { xs: 'none', md: 'block' },
          width: desktopOpen ? drawerWidth : 0,
          flexShrink: 0,
          overflow: 'hidden',
          transition: (theme) => theme.transitions.create('width', {
            duration: theme.transitions.duration.standard,
            easing: theme.transitions.easing.sharp,
          }),
        }}
      >
        <Box
          sx={{
            width: drawerWidth,
            height: '100%',
            borderRight: '1px solid rgba(255,255,255,0.08)',
            bgcolor: 'background.paper',
            backgroundImage: 'none',
            transform: desktopOpen ? 'translateX(0)' : `translateX(-${drawerWidth}px)`,
            transition: (theme) => theme.transitions.create('transform', {
              duration: theme.transitions.duration.standard,
              easing: theme.transitions.easing.sharp,
            }),
          }}
        >
          {content}
        </Box>
      </Box>

      {/* Temporary drawer for mobile */}
      <Drawer
        anchor="left"
        open={Boolean(mobileOpen)}
        onClose={onMobileClose}
        ModalProps={{ keepMounted: true }}
        PaperProps={{ sx: { width: drawerWidth, touchAction: 'pan-y' } }}
        sx={{ display: { xs: 'block', md: 'none' }, '& .MuiBackdrop-root': { touchAction: 'none' } }}
      >
        {content}
      </Drawer>
    </>
  )
}
