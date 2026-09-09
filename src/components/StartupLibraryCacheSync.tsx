import { useEffect, useMemo, useRef } from 'react'
import { addDevLog } from '../debugLog'
import { syncLibraryCache } from '../librarySync'
import { useServers } from '../context/ServersContext'
import { buildLibraryCacheKey } from '../libraryCache'
import { publishHydrusEpubCatalogFromCache } from '../utils/hydrusEpubCatalog'

const LAST_AUTO_SYNC_KEY = 'api_media_player_last_auto_sync_v1'
// Skip the background full sync within this window to avoid hammering Hydrus on every page load.
const AUTO_SYNC_TTL_MS = 6 * 60 * 60 * 1000

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

// Warms the shared client-side library cache in the background once server health checks complete,
// but throttles re-syncs so a simple reload doesn't re-fetch the entire library.
export default function StartupLibraryCacheSync() {
  const { servers, onlineServerIds, healthChecksComplete, updateServer } = useServers()
  const lastSyncSignatureRef = useRef<string | null>(null)
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

  useEffect(() => {
    if (!healthChecksComplete || !servers.length || !syncSignature || lastSyncSignatureRef.current === syncSignature) return

    lastSyncSignatureRef.current = syncSignature
    let cancelled = false
    const targetServerIds = onlineServerIds.filter((serverId) => servers.some((server) => server.id === serverId))

    if (targetServerIds.length === 0) return

    void publishHydrusEpubCatalogFromCache(buildLibraryCacheKey(servers)).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      addDevLog({ kind: 'error', category: 'thorium', message: `Background EPUB catalog publish failed: ${message}` })
    })

    const lastSync = readLastAutoSync()
    if (lastSync && lastSync.signature === syncSignature && Date.now() - lastSync.at < AUTO_SYNC_TTL_MS) {
      return
    }

    void syncLibraryCache(servers, { targetServerIds })
      .then((result) => {
        if (cancelled) return

        writeLastAutoSync(syncSignature)

        for (const [serverId, summary] of Object.entries(result.summaries)) {
          updateServer(serverId, { syncSummary: summary })
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        addDevLog({ kind: 'error', category: 'library-cache', message: `Background cache sync failed: ${message}` })
      })

    return () => {
      cancelled = true
    }
  }, [healthChecksComplete, onlineServerIds, servers, syncSignature, updateServer])

  return null
}
