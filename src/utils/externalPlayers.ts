import type { Track } from '../types'
import { buildExternalPlayerMetadata } from './trackMetadata'

export const VIDEO_URL_PATTERN = /\.(m3u8|mp4|webm|ogv|mov|mkv|avi|wmv)$/i
export const AUDIO_URL_PATTERN = /\.(mp3|m4a|aac|flac|wav|ogg|opus|oga|wma)$/i

export type ExternalPlayerTarget = {
  href: string
  appName: string
}

export function normalizeMimeForPlaybackCheck(mimeType?: string) {
  return (mimeType || '').trim().toLowerCase()
}

export function isVideoMediaTrack(track: Track) {
  if (track.isVideo) return true
  const mimeType = normalizeMimeForPlaybackCheck(track.mimeType)
  if (mimeType.startsWith('video/') || mimeType.includes('mpegurl')) return true
  return VIDEO_URL_PATTERN.test(track.url)
}

export function isPlayableMediaTrack(track: Track) {
  const mimeType = normalizeMimeForPlaybackCheck(track.mimeType)
  if (isVideoMediaTrack(track)) return true
  if (mimeType.startsWith('audio/')) return true
  if (AUDIO_URL_PATTERN.test(track.url)) return true
  return false
}

function encodeUrlSafeBase64(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\//g, '_').replace(/\+/g, '-').replace(/=+$/g, '')
}

function buildIntentStringExtra(key: string, value?: string) {
  const trimmed = (value || '').trim()
  if (!trimmed) return ''
  return `;S.${key}=${encodeURIComponent(trimmed)}`
}

export function buildVlcStreamUrl(track: Track) {
  const metadata = buildExternalPlayerMetadata(track)
  const url = `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(track.url)}`
  const fileName = metadata.title
  if (!fileName) return url
  return `${url}&filename=${encodeURIComponent(fileName)}`
}

export function buildAndroidMpvIntentUrl(track: Track) {
  try {
    const metadata = buildExternalPlayerMetadata(track)
    const url = new URL(track.url)
    const scheme = url.protocol.replace(':', '') || 'https'
    const intentPath = `${url.host}${url.pathname}${url.search}`
    const mimeType = track.isVideo || normalizeMimeForPlaybackCheck(track.mimeType).startsWith('video/')
      ? 'video/*'
      : normalizeMimeForPlaybackCheck(track.mimeType).startsWith('audio/')
        ? 'audio/*'
        : 'video/any'

    return `intent://${intentPath}#Intent;scheme=${scheme};package=is.xyz.mpv;action=android.intent.action.VIEW;type=${mimeType}${buildIntentStringExtra('title', metadata.title)}${buildIntentStringExtra('artist', metadata.artist)}${buildIntentStringExtra('album', metadata.album)};end`
  } catch {
    return track.url
  }
}

export function buildDesktopMpvHandlerUrl(track: Track) {
  const metadata = buildExternalPlayerMetadata(track)
  const encodedUrl = encodeUrlSafeBase64(track.url)
  const queryParts = ['enqueue=append']
  if (metadata.title) queryParts.push(`v_title=${encodeUrlSafeBase64(metadata.title)}`)
  const query = queryParts.length > 0 ? `?${queryParts.join('&')}` : ''
  return `mpv-handler://play/${encodedUrl}/${query}`
}

export function getPreferredExternalPlayer(
  track: Track,
  platform: { isAppleMobileOrTablet: boolean; isAndroidMobileOrTablet: boolean }
): ExternalPlayerTarget {
  if (platform.isAppleMobileOrTablet) {
    return { href: buildVlcStreamUrl(track), appName: 'VLC' }
  }

  if (platform.isAndroidMobileOrTablet) {
    return { href: buildAndroidMpvIntentUrl(track), appName: 'mpv' }
  }

  return { href: buildDesktopMpvHandlerUrl(track), appName: 'mpv' }
}
