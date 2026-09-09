import React from 'react'
import { AppBar, Toolbar, IconButton, Typography, TextField, InputAdornment } from '@mui/material'
import { alpha } from '@mui/material/styles'
import MenuIcon from '@mui/icons-material/Menu'
import ClearIcon from '@mui/icons-material/Clear'

type HeaderProps = {
  onToggleSidebar?: () => void
  searchQuery?: string
  onSearchQueryChange?: (value: string) => void
  searchDisabled?: boolean
  itemCount?: number | null
}

export default function Header({ onToggleSidebar, searchQuery = '', onSearchQueryChange, searchDisabled = false, itemCount = null }: HeaderProps) {
  const canClear = Boolean(searchQuery) && !searchDisabled

  return (
    <AppBar
      position="static"
      color="transparent"
      elevation={0}
      sx={{
        mb: 0,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        pt: 'env(safe-area-inset-top)',
        backdropFilter: 'blur(16px)',
        backgroundColor: (theme) => alpha(theme.palette.background.default, 0.86),
      }}
    >
      <Toolbar variant="dense" sx={{ minHeight: { xs: 52, sm: 48 }, py: 0.5, gap: 0.75, px: { xs: 1, sm: 2 } }}>
        <IconButton onClick={() => onToggleSidebar && onToggleSidebar()} aria-label="menu" size="medium" sx={{ width: 44, height: 44, flexShrink: 0 }}>
          <MenuIcon />
        </IconButton>

        <TextField
          value={searchQuery}
          onChange={(event) => onSearchQueryChange && onSearchQueryChange(event.target.value)}
          disabled={searchDisabled}
          size="small"
          placeholder="Search library"
          inputProps={{ enterKeyHint: 'search' }}
          InputProps={{
            endAdornment: canClear ? (
              <InputAdornment position="end">
                <IconButton
                  aria-label="clear search"
                  onClick={() => onSearchQueryChange && onSearchQueryChange('')}
                  edge="end"
                  size="small"
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          }}
          sx={{
            flex: 1,
            minWidth: 0,
            maxWidth: { sm: 560 },
            '& .MuiInputBase-root': { borderRadius: 999 },
            '& .MuiInputBase-input': { fontSize: { xs: 16, sm: 14 }, py: 1 },
          }}
        />

        {itemCount != null && (
          <Typography variant="caption" sx={{ flexShrink: 0, color: 'text.secondary', fontWeight: 600, whiteSpace: 'nowrap', pr: 0.5 }}>
            {itemCount.toLocaleString()} {itemCount === 1 ? 'item' : 'items'}
          </Typography>
        )}
      </Toolbar>
    </AppBar>
  )
}
