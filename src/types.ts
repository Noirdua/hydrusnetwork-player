export type MediaSection = 'all' | 'audio' | 'video' | 'image' | 'application' | 'books'

export type ServerSyncSummary = {
  updatedAt: number
  total: number
  counts: Partial<Record<MediaSection, number>>
  message?: string
}

export type Track = {
  id: number // local unique id used by the UI
  fileId?: number // original Hydrus file id (per-server)
  serverId?: string // which server this file came from
  serverName?: string // friendly server name for UI
  title: string
  artist?: string
  album?: string
  url: string
  thumbnail?: string
  hasThumbnail?: boolean
  duration?: number
  tags?: string[]
  // Optional MIME/type hints for rendering (video vs audio)
  isVideo?: boolean
  mimeType?: string
  mediaKind?: MediaSection
}
