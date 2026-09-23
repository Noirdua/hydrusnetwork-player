import { useEffect, useMemo, useRef } from 'react'
import { addDevLog } from '../debugLog'
import { syncLibraryCache } from '../librarySync'
import { useServers } from '../context/ServersContext'
import { buildLibraryCacheKey } from '../libraryCache'
import { publishHydrusEpubCatalogFromCache } from '../utils/hydrusEpubCatalog'

const LAST_AUTO_SYNC_KEY = 'api_media_player_last_auto_sync_v1'
const AUTO_SYNC_TTL_MS = 6 * 60 * 60 * 1000
const SYNC_RETRY_MS = 15000

function readLastAutoSync(): { signature: string; at: number } | null {
  try {
    const raw = localStorage.getItem(LAST_AUTO_SYNC_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { signature?: unknown; at?: unknown }
    if (parsed && typeof parsed.signature === 'string' && typeof parsed.at === 'number') {
      return { signature: parsed.signature, at: parsed.at }
    }
  } catch {
    // ignore
  }
  return null
}

function writeLastAutoSync(signature: string) {
  try {
    localStorage.setItem(LAST_AUTO_SYNC_KEY, JSON.stringify({ signature, at: Date.now() }))
  } catch {
    // ignore
  }
}

export default function StartupLibraryCacheSync() {
  const { servers, onlineServerIds, healthChecksComplete, updateServer } = useServers()
  const lastSyncSignatureRef = useRef<string | null>(null)
  const pendingSignatureRef = useRef<string | null>(null)
  const inFlightRef = useRef(false)
  const retryTimeoutRef = useRef<number | null>(null)
  const syncSignature = useMemo(() => servers
    .filter((server) => onlineServerIds.includes(server.id))
    .map((server) => [
      server.id,
      server.host,
      server.port,
      server.apiKey,
      server.ssl,
      server.forceApiKeyInQuery,
    ].join('|'))
    .join(','), [onlineServerIds, servers])

  const serversRef = useRef(servers)
  const onlineServerIdsRef = useRef(onlineServerIds)
  const updateServerRef = useRef(updateServer)
  serversRef.current = servers
  onlineServerIdsRef.current = onlineServerIds
  updateServerRef.current = updateServer

  useEffect(() => {
    const startSync = (signature: string) => {
      if (!signature || lastSyncSignatureRef.current === signature || inFlightRef.current) return

      const currentServers = serversRef.current
      const targetServerIds = onlineServerIdsRef.current.filter((serverId) => currentServers.some((server) => server.id === serverId))
      if (targetServerIds.length === 0) return

      void publishHydrusEpubCatalogFromCache(buildLibraryCacheKey(currentServers)).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        addDevLog({ kind: 'error', category: 'thorium', message: `Background EPUB catalog publish failed: ${message}` })
      })

      const lastSync = readLastAutoSync()
      if (lastSync && lastSync.signature === signature && Date.now() - lastSync.at < AUTO_SYNC_TTL_MS) {
        lastSyncSignatureRef.current = signature
        return
      }

      inFlightRef.current = true
      void syncLibraryCache(currentServers, { targetServerIds })
        .then((result) => {
          for (const [serverId, summary] of Object.entries(result.summaries)) {
            updateServerRef.current(serverId, { syncSummary: summary })
          }

          const failed = Object.values(result.summaries).some((summary) => summary.message?.startsWith('Sync failed'))
          if (failed) {
            if (typeof window === 'undefined') return
            if (retryTimeoutRef.current) window.clearTimeout(retryTimeoutRef.current)
            retryTimeoutRef.current = window.setTimeout(() => {
              retryTimeoutRef.current = null
              startSync(pendingSignatureRef.current || signature)
            }, SYNC_RETRY_MS)
            return
          }

          lastSyncSignatureRef.current = signature
          writeLastAutoSync(signature)
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          addDevLog({ kind: 'error', category: 'library-cache', message: `Background cache sync failed: ${message}` })
          if (typeof window !== 'undefined') {
            if (retryTimeoutRef.current) window.clearTimeout(retryTimeoutRef.current)
            retryTimeoutRef.current = window.setTimeout(() => {
              retryTimeoutRef.current = null
              startSync(pendingSignatureRef.current || signature)
            }, SYNC_RETRY_MS)
          }
        })
        .finally(() => {
          inFlightRef.current = false
          const pending = pendingSignatureRef.current
          pendingSignatureRef.current = null
          if (pending && pending !== signature && pending !== lastSyncSignatureRef.current) {
            if (retryTimeoutRef.current) {
              window.clearTimeout(retryTimeoutRef.current)
              retryTimeoutRef.current = null
            }
            startSync(pending)
          }
        })
    }

    if (!healthChecksComplete || !serversRef.current.length || !syncSignature) return
    if (lastSyncSignatureRef.current === syncSignature) return
    if (inFlightRef.current) {
      pendingSignatureRef.current = syncSignature
      return
    }
    startSync(syncSignature)
  }, [healthChecksComplete, syncSignature])

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) window.clearTimeout(retryTimeoutRef.current)
    }
  }, [])

  return null
}
