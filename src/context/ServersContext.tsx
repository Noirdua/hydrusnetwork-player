import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ServerConfig, ConnectivityResult } from '../api/hydrusClient'
import { getHydrusClient, makeId } from '../api/hydrusClient'
import { getEnvHydrusDefaults } from '../envDefaults'
import type { ServerSyncSummary } from '../types'

export const STORAGE_KEY = 'hydrus_servers_v1'
export const ACTIVE_KEY = 'hydrus_active_id_v1'

export type Server = ServerConfig & {
  lastTest?: (ConnectivityResult & { timestamp: number }) | null
  syncSummary?: ServerSyncSummary | null
}

function buildConnectivitySignature(server: Pick<ServerConfig, 'host' | 'port' | 'apiKey' | 'ssl' | 'forceApiKeyInQuery'>) {
  return [
    server.host?.trim().toLowerCase() || '',
    server.port ?? '',
    server.apiKey || '',
    server.ssl ? '1' : '0',
    server.forceApiKeyInQuery ? '1' : '0',
  ].join('|')
}

// Re-test connectivity at most once per this window for a server that was recently verified.
const CONNECTIVITY_RECHECK_TTL_MS = 30 * 60 * 1000
const FAILURE_RETRY_MS = 8000

function seedVerifiedSignatures(servers: Server[]): Record<string, string> {
  const seeded: Record<string, string> = {}
  const now = Date.now()
  for (const server of servers) {
    const lastTest = server.lastTest
    if (lastTest?.ok === true && typeof lastTest.timestamp === 'number' && now - lastTest.timestamp < CONNECTIVITY_RECHECK_TTL_MS) {
      seeded[server.id] = buildConnectivitySignature(server)
    }
  }
  return seeded
}

type ServersContextType = {
  servers: Server[]
  onlineServerIds: string[]
  healthChecksComplete: boolean
  activeServerId: string | null
  setActiveServerId: (id: string | null) => void
  addServer: (s: Omit<Server, 'id' | 'lastTest'>) => Server
  updateServer: (id: string, patch: Partial<Server>) => void
  removeServer: (id: string) => void
  testServerById: (id: string) => Promise<ConnectivityResult>
  testServerConfig: (cfg: Omit<Server, 'id' | 'lastTest'>) => Promise<ConnectivityResult>
}

const ServersContext = createContext<ServersContextType | null>(null)

function buildEnvSeedServer(): Server | null {
  const defaults = getEnvHydrusDefaults()
  if (!defaults.host) return null

  return {
    id: makeId(),
    name: defaults.proxyEnabled || defaults.host === '/hydrus-proxy' ? 'Hydrus (proxy)' : 'Hydrus',
    host: defaults.host,
    port: defaults.port,
    apiKey: defaults.apiKey || undefined,
    ssl: defaults.ssl,
    forceApiKeyInQuery: defaults.forceApiKeyInQuery,
    lastTest: null,
  }
}

function loadServers(): Server[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Server[]
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {
    // fall through to env defaults
  }

  const seeded = buildEnvSeedServer()
  return seeded ? [seeded] : []
}

function createInitialServerState() {
  const servers = loadServers()
  return {
    servers,
    verifiedConnectivitySignatures: seedVerifiedSignatures(servers),
  }
}

function saveServers(servers: Server[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servers))
  } catch (e) {
    // ignore
  }
}

export function ServersProvider({ children }: { children: React.ReactNode }) {
  const [initialServerState] = useState(createInitialServerState)
  const [servers, setServers] = useState<Server[]>(initialServerState.servers)
  const [verifiedConnectivitySignatures, setVerifiedConnectivitySignatures] = useState<Record<string, string>>(initialServerState.verifiedConnectivitySignatures)
  const [activeServerId, setActiveServerIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY)
    } catch (e) {
      return null
    }
  })
  const connectivityRequestsRef = useRef<Record<string, Promise<ConnectivityResult>>>({})
  const serversRef = useRef(servers)
  const failureRetryTimeoutsRef = useRef<Record<string, number>>({})
  serversRef.current = servers

  useEffect(() => saveServers(servers), [servers])

  useEffect(() => {
    return () => {
      for (const timeoutId of Object.values(failureRetryTimeoutsRef.current)) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [])

  const setActiveServerId = useCallback((id: string | null) => {
    setActiveServerIdState(id)
    try {
      if (id) localStorage.setItem(ACTIVE_KEY, id)
      else localStorage.removeItem(ACTIVE_KEY)
    } catch {
      // ignore private-mode / quota errors
    }
  }, [])

  const addServer = useCallback((s: Omit<Server, 'id' | 'lastTest'>) => {
    const id = makeId()
    const srv: Server = { id, ...s, lastTest: null }
    setServers((prev) => [...prev, srv])
    return srv
  }, [])

  const updateServer = useCallback((id: string, patch: Partial<Server>) => {
    setServers((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const removeServer = useCallback((id: string) => {
    setServers((prev) => prev.filter((s) => s.id !== id))
    setVerifiedConnectivitySignatures((prev) => {
      if (!(id in prev)) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (activeServerId === id) setActiveServerId(null)
  }, [activeServerId, setActiveServerId])

  const runPersistedConnectivityTest = useCallback((server: Server) => {
    const signature = buildConnectivitySignature(server)
    const requestKey = `${server.id}|${signature}`
    const existingRequest = connectivityRequestsRef.current[requestKey]
    if (existingRequest) return existingRequest

    const request = (async () => {
      const client = getHydrusClient(server)
      const res = await client.testConnectivity()
      const current = serversRef.current.find((candidate) => candidate.id === server.id)
      if (!current || buildConnectivitySignature(current) !== signature) return res

      updateServer(server.id, { lastTest: { ...res, timestamp: Date.now() } })
      setVerifiedConnectivitySignatures((prev) => {
        if (prev[server.id] === signature) return prev
        return { ...prev, [server.id]: signature }
      })

      if (failureRetryTimeoutsRef.current[server.id]) {
        window.clearTimeout(failureRetryTimeoutsRef.current[server.id])
        delete failureRetryTimeoutsRef.current[server.id]
      }

      if (!res.ok && typeof window !== 'undefined') {
        failureRetryTimeoutsRef.current[server.id] = window.setTimeout(() => {
          delete failureRetryTimeoutsRef.current[server.id]
          const latest = serversRef.current.find((candidate) => candidate.id === server.id)
          if (!latest || buildConnectivitySignature(latest) !== signature || latest.lastTest?.ok) return
          delete connectivityRequestsRef.current[requestKey]
          void runPersistedConnectivityTest(latest)
        }, FAILURE_RETRY_MS)
      }

      return res
    })()

    connectivityRequestsRef.current[requestKey] = request

    void request.finally(() => {
      delete connectivityRequestsRef.current[requestKey]
    })

    return request
  }, [updateServer])

  useEffect(() => {
    const activeServerIds = new Set(servers.map((server) => server.id))

    setVerifiedConnectivitySignatures((prev) => {
      const nextEntries = Object.entries(prev).filter(([serverId]) => activeServerIds.has(serverId))
      if (nextEntries.length === Object.keys(prev).length) return prev
      return Object.fromEntries(nextEntries)
    })

    Object.keys(connectivityRequestsRef.current).forEach((requestKey) => {
      const [serverId] = requestKey.split('|')
      if (!activeServerIds.has(serverId)) {
        delete connectivityRequestsRef.current[requestKey]
      }
    })

    for (const server of servers) {
      const signature = buildConnectivitySignature(server)
      if (verifiedConnectivitySignatures[server.id] === signature) continue
      void runPersistedConnectivityTest(server)
    }
  }, [servers, runPersistedConnectivityTest, verifiedConnectivitySignatures])

  const testServerById = useCallback(async (id: string) => {
    const server = servers.find((s) => s.id === id)
    if (!server) return { ok: false, message: 'Server not found' } as ConnectivityResult
    return runPersistedConnectivityTest(server)
  }, [runPersistedConnectivityTest, servers])

  const testServerConfig = useCallback(async (cfg: Omit<Server, 'id' | 'lastTest'>) => {
    const client = getHydrusClient(cfg as ServerConfig)
    return client.testConnectivity()
  }, [])

  const healthChecksComplete = useMemo(() => servers.every((server) => {
    const signature = buildConnectivitySignature(server)
    return verifiedConnectivitySignatures[server.id] === signature
  }), [servers, verifiedConnectivitySignatures])

  const onlineServerIds = useMemo(() => servers
    .filter((server) => {
      const signature = buildConnectivitySignature(server)
      return verifiedConnectivitySignatures[server.id] === signature && server.lastTest?.ok === true
    })
    .map((server) => server.id), [servers, verifiedConnectivitySignatures])

  const value = useMemo(() => ({
    servers,
    onlineServerIds,
    healthChecksComplete,
    activeServerId,
    setActiveServerId,
    addServer,
    updateServer,
    removeServer,
    testServerById,
    testServerConfig,
  }), [servers, onlineServerIds, healthChecksComplete, activeServerId, setActiveServerId, addServer, updateServer, removeServer, testServerById, testServerConfig])

  return (
    <ServersContext.Provider value={value}>
      {children}
    </ServersContext.Provider>
  )
}

export function useServers() {
  const ctx = useContext(ServersContext)
  if (!ctx) throw new Error('useServers must be used within ServersProvider')
  return ctx
}
