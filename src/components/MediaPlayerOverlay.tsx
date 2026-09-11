import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, IconButton, LinearProgress, Paper, Slider, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PauseIcon from '@mui/icons-material/Pause'
import FullscreenIcon from '@mui/icons-material/Fullscreen'
import type { Track } from '../types'
import { getTrackArtworkSrc } from '../pages/library/libraryHelpers'
import { isVideoMediaTrack } from '../utils/externalPlayers'
import { useOverlayZoomLock } from '../hooks/useOverlayZoomLock'

type Props = {
  track: Track | null
  onClose: () => void
  lifted?: boolean
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

export default function MediaPlayerOverlay({ track, onClose, lifted = false }: Props) {
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const video = useMemo(() => (track ? isVideoMediaTrack(track) : false), [track])
  const title = track?.title?.trim() || 'Now playing'
  const artist = track?.artist?.trim()
  const album = track?.album?.trim()
  const subtitle = [artist, album].filter(Boolean).join(' • ')
  const artwork = track ? getTrackArtworkSrc(track) : undefined
  const seekable = Number.isFinite(duration) && duration > 0
  const progress = seekable ? (currentTime / duration) * 100 : 0
  useOverlayZoomLock(expanded)

  useEffect(() => {
    setExpanded(false)
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
  }, [track?.url])

  useEffect(() => {
    const media = mediaRef.current
    if (!media) return

    const onTime = () => setCurrentTime(media.currentTime)
    const onDuration = () => setDuration(Number.isFinite(media.duration) ? media.duration : 0)
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => setIsPlaying(false)

    media.addEventListener('timeupdate', onTime)
    media.addEventListener('durationchange', onDuration)
    media.addEventListener('loadedmetadata', onDuration)
    media.addEventListener('play', onPlay)
    media.addEventListener('pause', onPause)
    media.addEventListener('ended', onEnded)

    setIsPlaying(!media.paused)
    setCurrentTime(media.currentTime || 0)
    if (Number.isFinite(media.duration) && media.duration > 0) setDuration(media.duration)

    return () => {
      media.removeEventListener('timeupdate', onTime)
      media.removeEventListener('durationchange', onDuration)
      media.removeEventListener('loadedmetadata', onDuration)
      media.removeEventListener('play', onPlay)
      media.removeEventListener('pause', onPause)
      media.removeEventListener('ended', onEnded)
      media.pause()
      media.removeAttribute('src')
      media.load()
    }
  }, [track?.url, video])

  const togglePlay = useCallback(() => {
    const media = mediaRef.current
    if (!media) return
    if (media.paused) void media.play()
    else media.pause()
  }, [])

  const handleSeek = useCallback((_event: Event, value: number | number[]) => {
    const next = Array.isArray(value) ? value[0] : value
    const media = mediaRef.current
    if (media && Number.isFinite(media.duration) && media.duration > 0) {
      media.currentTime = next
    }
    setCurrentTime(next)
  }, [])

  const handleFullscreen = useCallback(() => {
    const media = mediaRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    if (!media) return
    if (typeof media.requestFullscreen === 'function') {
      void media.requestFullscreen()
      return
    }
    media.webkitEnterFullscreen?.()
  }, [])

  if (!track) return null

  return (
    <>
      {!expanded && (
        <Paper
          elevation={6}
          onClick={() => setExpanded(true)}
          sx={{
            position: 'fixed',
            left: 8,
            right: 8,
            bottom: lifted ? 'max(96px, calc(env(safe-area-inset-bottom) + 88px))' : 'max(8px, env(safe-area-inset-bottom))',
            zIndex: (theme) => theme.zIndex.appBar,
            borderRadius: 2.5,
            border: '1px solid rgba(255,255,255,0.08)',
            bgcolor: 'background.paper',
            backgroundImage: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            px: 1.25,
            py: 0.75,
            cursor: 'pointer',
          }}
        >
          <Box
            component="img"
            src={artwork}
            alt={title}
            sx={{ width: 44, height: 44, borderRadius: 1.5, objectFit: 'cover', flexShrink: 0, bgcolor: '#0b0b0b' }}
          />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{title}</Typography>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, progress)}
              sx={{ mt: 0.75, height: 3, borderRadius: 999, bgcolor: 'rgba(255,255,255,0.1)' }}
            />
          </Box>
          <IconButton onClick={(event) => { event.stopPropagation(); togglePlay() }} aria-label={isPlaying ? 'pause' : 'play'} size="small" sx={{ flexShrink: 0 }}>
            {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
          </IconButton>
          <IconButton onClick={(event) => { event.stopPropagation(); onClose() }} aria-label="close player" size="small" sx={{ flexShrink: 0 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Paper>
      )}

      <Paper
        elevation={16}
        sx={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: (theme) => theme.zIndex.modal,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          bgcolor: 'background.paper',
          backgroundImage: 'none',
          boxShadow: 24,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transform: expanded ? 'translateY(0)' : 'translateY(110%)',
          transition: (theme) => theme.transitions.create('transform', { duration: 260, easing: theme.transitions.easing.easeOut }),
          pointerEvents: expanded ? 'auto' : 'none',
        }}
      >
        <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 36, flexShrink: 0, zIndex: 2 }}>
          <Box
            onClick={() => setExpanded(false)}
            sx={{ width: 44, height: 4, borderRadius: 999, bgcolor: 'rgba(255,255,255,0.22)', cursor: 'pointer' }}
            aria-label="collapse player"
          />
          <IconButton onClick={() => setExpanded(false)} aria-label="collapse player" size="small" sx={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)' }}>
            <ExpandMoreIcon fontSize="small" />
          </IconButton>
        </Box>

        {video ? (
          <Box
            sx={{
              position: 'relative',
              height: { xs: '30vh', sm: '30vh' },
              flexShrink: 0,
              bgcolor: '#000',
              '&:hover .overlay-btn': { opacity: 1 },
              '@media (hover: none)': { '& .overlay-btn': { opacity: 1 } },
            }}
          >
            <Box
              component="video"
              key={track.url}
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              src={track.url}
              autoPlay
              playsInline
              sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', bgcolor: '#000' }}
            />
            <IconButton
              className="overlay-btn"
              onClick={handleFullscreen}
              aria-label="fullscreen"
              sx={{ position: 'absolute', top: 8, right: 8, opacity: 0, transition: 'opacity 150ms ease', bgcolor: 'rgba(0,0,0,0.5)', color: '#fff' }}
            >
              <FullscreenIcon />
            </IconButton>
          </Box>
        ) : (
          <Box
            component="audio"
            key={track.url}
              ref={mediaRef as React.RefObject<HTMLAudioElement>}
            src={track.url}
            autoPlay
          />
        )}

        <Box sx={{ flexShrink: 0, px: 2, pt: 1, pb: 'max(14px, env(safe-area-inset-bottom))' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {!video && (
              <Box
                component="img"
                src={artwork}
                alt={title}
                sx={{ width: 48, height: 48, borderRadius: 1.5, objectFit: 'cover', flexShrink: 0, bgcolor: '#0b0b0b' }}
              />
            )}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700 }}>{title}</Typography>
              {subtitle && <Typography variant="body2" noWrap sx={{ color: 'text.secondary', mt: 0.25 }}>{subtitle}</Typography>}
            </Box>
            <IconButton
              onClick={togglePlay}
              aria-label={isPlaying ? 'pause' : 'play'}
              sx={{ color: '#fff', bgcolor: 'primary.main', width: 48, height: 48, flexShrink: 0, '&:hover': { bgcolor: 'primary.dark' } }}
            >
              {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
            </IconButton>
          </Box>

          <Slider
            value={currentTime}
            min={0}
            max={seekable ? duration : 1}
            step={0.1}
            disabled={!seekable}
            onChange={handleSeek}
            aria-label="seek"
            sx={{ mt: 1, color: 'primary.main', '& .MuiSlider-thumb': { width: 14, height: 14 } }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: -0.5 }}>
            <Typography variant="caption" color="text.secondary">{formatTime(currentTime)}</Typography>
            <Typography variant="caption" color="text.secondary">{formatTime(duration)}</Typography>
          </Box>
        </Box>
      </Paper>
    </>
  )
}
