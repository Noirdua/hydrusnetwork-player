import { loadUiPreferences } from '../appPreferences'
import type { Track } from '../types'
import { getTrackExtension } from './trackMetadata'

const DEFAULT_THORIUM_WEB_URL = 'http://localhost:3000'

function readEnv(name: string) {
  const value = (import.meta.env as Record<string, string | boolean | undefined>)[name]
  return typeof value === 'string' ? value.trim() : ''
}

export function encodeUrlSafeBase64(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\//g, '_').replace(/\+/g, '-').replace(/=+$/g, '')
}

export function normalizeThoriumWebUrl(value?: string | null) {
  return (value || '').trim().replace(/\/+$/, '')
}

export function getDefaultThoriumWebUrl() {
  return normalizeThoriumWebUrl(readEnv('VITE_THORIUM_WEB_URL')) || DEFAULT_THORIUM_WEB_URL
}

export function getThoriumWebUrl() {
  return normalizeThoriumWebUrl(loadUiPreferences().thoriumWebUrl) || getDefaultThoriumWebUrl()
}

export function isPdfTrack(track: Pick<Track, 'mimeType' | 'url'>) {
  const mime = (track.mimeType || '').toLowerCase()
  if (mime.includes('pdf')) return true
  return getTrackExtension(track as Track) === 'pdf'
}

export function isThoriumReadableTrack(track: Pick<Track, 'mimeType' | 'url'>) {
  const mime = (track.mimeType || '').toLowerCase()
  if (mime.includes('epub')) return true
  return getTrackExtension(track as Track) === 'epub'
}

export function openInBrowserReader(track: Track) {
  const openedWindow = window.open(track.url, '_blank', 'noopener,noreferrer')
  if (!openedWindow) window.location.href = track.url
}

export async function registerThoriumSource(fileUrl: string, origin = window.location.origin.replace(/\/+$/, '')) {
  const response = await fetch(`${origin}/readium/source`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: fileUrl }),
  })
  if (!response.ok) throw new Error(`Failed to register publication (${response.status})`)
  const data = await response.json().catch(() => null) as { id?: unknown } | null
  if (typeof data?.id !== 'string' || !data.id) throw new Error('Invalid publication id')
  return data.id
}

export async function buildThoriumReaderHref(fileUrl: string, origin = window.location.origin) {
  const base = origin.replace(/\/+$/, '')
  let encodedSource = encodeUrlSafeBase64(fileUrl)
  try {
    encodedSource = await registerThoriumSource(fileUrl, base)
  } catch {
    // Fall back to the encoded file URL if the streamer is unavailable.
  }
  const manifestUrl = `${base}/readium/webpub/${encodedSource}/manifest.json`
  return `${getThoriumWebUrl()}/read/manifest/${encodeURIComponent(manifestUrl)}`
}

export async function openInThoriumReader(track: Track) {
  const href = await buildThoriumReaderHref(track.url)
  const openedWindow = window.open(href, '_blank', 'noopener,noreferrer')
  if (!openedWindow) window.location.href = href
}
