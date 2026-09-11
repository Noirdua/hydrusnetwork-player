import React, { useState } from 'react'
import { Box, IconButton, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import type { Track } from '../../types'
import { formatDuration, getTrackArtworkSrc, getTrackDisplayTitle } from './libraryHelpers'
import { getTrackCacheKey } from '../../utils/trackMetadata'
import type { TrackInteractionProps } from './LibraryLists'

type NestedCatalogLayoutProps = {
  groups: Array<{
    name: string
    tracks: Track[]
    subgroups: { name: string; tracks: Track[] }[]
  }>
  labels: {
    group: string
    subgroup: string
    item: string
  }
  getInteractionProps: (track: Track) => TrackInteractionProps
  onImageError: (event: React.SyntheticEvent<HTMLImageElement>, track?: Track) => void
}

function toggleName(current: Set<string>, name: string) {
  const next = new Set(current)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  return next
}

export default function NestedCatalogLayout({ groups, labels, getInteractionProps, onImageError }: NestedCatalogLayoutProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [collapsedSubgroups, setCollapsedSubgroups] = useState<Set<string>>(new Set())

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {groups.map((group) => {
        const poster = group.tracks.find((track) => track.thumbnail) || group.tracks[0]
        const groupOpen = !collapsedGroups.has(group.name)

        return (
          <Box
            key={group.name}
            sx={{
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 3,
              overflow: 'hidden',
              bgcolor: 'rgba(255,255,255,0.03)',
            }}
          >
            <Box
              onClick={() => setCollapsedGroups((current) => toggleName(current, group.name))}
              sx={{
                display: 'flex',
                gap: 2,
                alignItems: 'center',
                p: { xs: 1.5, sm: 2 },
                borderBottom: groupOpen ? '1px solid rgba(255,255,255,0.08)' : 'none',
                cursor: 'pointer',
                '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' },
              }}
            >
              {poster && (
                <Box
                  component="img"
                  src={getTrackArtworkSrc(poster)}
                  onError={(event: React.SyntheticEvent<HTMLImageElement>) => onImageError(event, poster)}
                  alt={group.name}
                  sx={{ width: 64, height: 96, objectFit: 'cover', borderRadius: 1.5, flexShrink: 0, bgcolor: '#0b0b0b' }}
                />
              )}
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {labels.group}
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }} noWrap>
                  {group.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {group.tracks.length} {group.tracks.length === 1 ? labels.item.toLowerCase() : `${labels.item.toLowerCase()}s`}
                </Typography>
              </Box>
              <IconButton
                size="small"
                aria-label={groupOpen ? `collapse ${group.name}` : `expand ${group.name}`}
                sx={{ color: 'text.secondary', transform: groupOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 160ms ease' }}
              >
                <ExpandMoreIcon />
              </IconButton>
            </Box>

            {groupOpen && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, p: { xs: 1.25, sm: 1.75 } }}>
                {group.subgroups.map((subgroup) => {
                  const subgroupKey = `${group.name}:${subgroup.name}`
                  const subgroupOpen = !collapsedSubgroups.has(subgroupKey)

                  return (
                    <Box
                      key={subgroupKey}
                      sx={{
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 2,
                        bgcolor: 'rgba(0,0,0,0.18)',
                        overflow: 'hidden',
                      }}
                    >
                      <Box
                        onClick={() => setCollapsedSubgroups((current) => toggleName(current, subgroupKey))}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          px: 1.5,
                          py: 1,
                          cursor: 'pointer',
                          borderBottom: subgroupOpen ? '1px solid rgba(255,255,255,0.06)' : 'none',
                          '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' },
                        }}
                      >
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            {subgroup.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {subgroup.tracks.length} {subgroup.tracks.length === 1 ? labels.item.toLowerCase() : `${labels.item.toLowerCase()}s`}
                          </Typography>
                        </Box>
                        <IconButton
                          size="small"
                          aria-label={subgroupOpen ? `collapse ${subgroup.name}` : `expand ${subgroup.name}`}
                          sx={{ color: 'text.secondary', transform: subgroupOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 160ms ease' }}
                        >
                          <ExpandMoreIcon fontSize="small" />
                        </IconButton>
                      </Box>
                      {subgroupOpen && (
                        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                          {subgroup.tracks.map((track, index) => {
                            const duration = formatDuration(track.duration)
                            return (
                              <Box
                                key={getTrackCacheKey(track.serverId, track.fileId) || track.id}
                                {...getInteractionProps(track)}
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 1.25,
                                  px: 1.5,
                                  py: 1,
                                  cursor: track.url ? 'pointer' : 'default',
                                  borderTop: index === 0 ? 'none' : '1px solid rgba(255,255,255,0.04)',
                                  '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' },
                                }}
                              >
                                <Box sx={{ width: 28, color: 'text.secondary', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                                  {index + 1}
                                </Box>
                                <PlayArrowIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
                                <Typography variant="body2" noWrap sx={{ flex: 1, fontWeight: 600 }}>
                                  {getTrackDisplayTitle(track)}
                                </Typography>
                                {duration && (
                                  <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                                    {duration}
                                  </Typography>
                                )}
                              </Box>
                            )
                          })}
                        </Box>
                      )}
                    </Box>
                  )
                })}
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}
