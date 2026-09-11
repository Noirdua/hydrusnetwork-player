export type EnvHydrusDefaults = {
  host: string
  port?: string
  apiKey: string
  ssl: boolean
  forceApiKeyInQuery: boolean
  proxyEnabled: boolean
  proxyTarget: string
}

function readEnv(name: string) {
  const value = (import.meta.env as Record<string, string | boolean | undefined>)[name]
  return typeof value === 'string' ? value.trim() : ''
}

function readBool(name: string, fallback = false) {
  const value = readEnv(name).toLowerCase()
  if (!value) return fallback
  return value === '1' || value === 'true' || value === 'yes'
}

  /** Defaults from Vite-exposed env. Use /hydrus-proxy only when no host is configured. */
export function getEnvHydrusDefaults(): EnvHydrusDefaults {
  const proxyEnabled = readBool('VITE_HYDRUS_PROXY_ENABLED')
  const proxyTarget = ''
  const configuredHost = readEnv('VITE_HYDRUS_HOST').replace(/\/+$/, '')
  const host = configuredHost || (proxyEnabled ? '/hydrus-proxy' : '')

  let ssl = readBool('VITE_HYDRUS_SSL')
  if (host.startsWith('https://')) ssl = true
  if (host.startsWith('http://')) ssl = false
  if (host.startsWith('/')) {
    ssl = typeof window !== 'undefined' ? window.location.protocol === 'https:' : true
  }

  return {
    host,
    port: host.startsWith('/') ? undefined : (readEnv('VITE_HYDRUS_PORT') || undefined),
    apiKey: readEnv('VITE_HYDRUS_API_KEY').replace(/\s+/g, ''),
    ssl,
    forceApiKeyInQuery: readBool('VITE_HYDRUS_FORCE_API_KEY_IN_QUERY'),
    proxyEnabled,
    proxyTarget,
  }
}
