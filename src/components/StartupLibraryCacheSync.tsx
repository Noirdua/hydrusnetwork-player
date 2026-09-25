import { useEffect, useMemo, useRef } from 'react'
import { addDevLog } from '../debugLog'
import { syncLibraryCache } from '../librarySync'
import { useServers } from '../context/ServersContext'
import { buildLibraryCacheKey } from '../libraryCache'
import { publishHydrusEpubCatalogFromCache } from '../utils/hydrusEpubCatalog'

const LAST_AUTO_SYNC_KEY = 'api_media_player_last_auto_sync_v1'
const AUTO_SYNC_TTL_MS = 6 * 60 * 60 * 1000
const FAILED_SYNC_COOLDOWN_MS = 15 * 60 * 1000
const SYNC_RETRY_MS = 15000
const MAX_AUTO_SYNC_RETRIES = 4
const MAX_SYNC_RETRY_MS = 5 * 60 * 1000

function readLastAutoSync(): { signature: string; at: number; ttl: number } | null {
  try {
    const raw = localStorage.getItem(LAST_AUTO_SYNC_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { signature?: unknown; at?: unknown; ttl?: unknown }
    if (parsed && typeof parsed.signature === 'string' && typeof parsed.at === 'number') {
      return {
        signature: parsed.signature,
        at: parsed.at,
        ttl: typeof parsed.ttl === 'number' ? parsed.ttl : AUTO_SYNC_TTL_MS,
      }
    }
  } catch {
    // ignore
  }
  return null
}

function writeLastAutoSync(signature: string, ttl = AUTO_SYNC_TTL_MS) {
  try {
    localStorage.setItem(LAST_AUTO_SYNC_KEY, JSON.stringify({ signature, at: Date.now(), ttl }))
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
  const retryAttemptRef = useRef(0)
  const retryServerIdsRef = useRef<string[] | null>(null)
  const retrySignatureRef = useRef<string | null>(null)
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
    const scheduleRetry = (signature: string, serverIds: string[]) => {
      if (typeof window === 'undefined') return
      if (retrySignatureRef.current !== signature) {
        retrySignatureRef.current = signature
        retryAttemptRef.current = 0
      }
      if (retryAttemptRef.current >= MAX_AUTO_SYNC_RETRIES) {
        retryAttemptRef.current = 0
        retryServerIdsRef.current = null
        lastSyncSignatureRef.current = signature
        writeLastAutoSync(signature, FAILED_SYNC_COOLDOWN_MS)
        return
      }

      const attempt = retryAttemptRef.current
      retryAttemptRef.current += 1
      retryServerIdsRef.current = serverIds
      retrySignatureRef.current = signature
      if (retryTimeoutRef.current) window.clearTimeout(retryTimeoutRef.current)
      const delay = Math.min(MAX_SYNC_RETRY_MS, SYNC_RETRY_MS * 2 ** Math.min(attempt, 5))
      retryTimeoutRef.current = window.setTimeout(() => {
        retryTimeoutRef.current = null
        startSync(pendingSignatureRef.current || signature)
      }, delay)
    }

    const startSync = (signature: string) => {
      if (!signature || lastSyncSignatureRef.current === signature || inFlightRef.current) return

      if (retrySignatureRef.current !== signature) {
        retryAttemptRef.current = 0
        retryServerIdsRef.current = null
        retrySignatureRef.current = signature
      }

      const currentServers = serversRef.current
      const onlineIds = onlineServerIdsRef.current.filter((serverId) => currentServers.some((server) => server.id === serverId))
      const retryIds = retryServerIdsRef.current?.filter((serverId) => onlineIds.includes(serverId))
      const targetServerIds = retryIds && retryIds.length > 0 ? retryIds : onlineIds
      retryServerIdsRef.current = null
      if (targetServerIds.length === 0) return

      void publishHydrusEpubCatalogFromCache(buildLibraryCacheKey(currentServers)).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        addDevLog({ kind: 'error', category: 'thorium', message: `Background EPUB catalog publish failed: ${message}` })
      })

      const lastSync = readLastAutoSync()
      if (lastSync && lastSync.signature === signature && Date.now() - lastSync.at < lastSync.ttl) {
        lastSyncSignatureRef.current = signature
        return
      }

      inFlightRef.current = true
      void syncLibraryCache(currentServers, { targetServerIds })
        .then((result) => {
          for (const [serverId, summary] of Object.entries(result.summaries)) {
            updateServerRef.current(serverId, { syncSummary: summary })
          }

          const failedIds = Object.entries(result.summaries)
            .filter(([, summary]) => summary.message?.startsWith('Sync failed'))
            .map(([serverId]) => serverId)
          if (failedIds.length > 0) {
            scheduleRetry(signature, failedIds)
            return
          }

          retryAttemptRef.current = 0
          retryServerIdsRef.current = null
          lastSyncSignatureRef.current = signature
          writeLastAutoSync(signature)
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          addDevLog({ kind: 'error', category: 'library-cache', message: `Background cache sync failed: ${message}` })
          scheduleRetry(signature, targetServerIds)
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
            retryAttemptRef.current = 0
            retryServerIdsRef.current = null
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
