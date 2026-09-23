import {
  extractFileDetailsFromMetadata,
  extractMediaInfoFromMetadata,
  extractTagsFromMetadata,
  extractTitleFromTags,
  type HydrusFileDetails,
  type HydrusFileMetadata,
} from './hydrusMetadata'

export type ServerConfig = {
  id: string
  name?: string
  host: string
  port?: string | number
  apiKey?: string
  ssl?: boolean
  forceApiKeyInQuery?: boolean
}

export type ConnectivityResult = {
  ok: boolean
  message: string
  status?: number | null
  searchOk?: boolean
  rangeSupported?: boolean
}

export type { HydrusFileDetails, HydrusFileMetadata, HydrusMediaInfo } from './hydrusMetadata'
export { extractTitleFromTags }

function sanitizeApiKey(value?: string) {
  return (value || '').replace(/\s+/g, '')
}

function sanitizePort(value?: string | number) {
  if (value == null) return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

export function makeId() {
  return Date.now().toString() + '-' + Math.random().toString(36).slice(2, 9)
}

export type HydrusSearchTag = string | HydrusSearchTags
export type HydrusSearchTags = HydrusSearchTag[]

const SYSTEM_PREDICATE_PATTERN = /^(system:[^<>!=]+?)\s*(<=|>=|!=|=|<|>)\s*(.+)$/i
const SEARCH_TOKEN_PATTERN = /(?:[^\s"]+:"(?:[^"\\]|\\.)*"|"(?:[^"\\]|\\.)*"|\S+)/g
const METADATA_CACHE_LIMIT = 256
const METADATA_CACHE_TTL_MS = 2 * 60 * 1000

const clientRegistry = new Map<string, { signature: string; client: HydrusClient }>()

function createAbortError() {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

function isHydrusProxyEnabled() {
  const value = String(import.meta.env.VITE_HYDRUS_PROXY_ENABLED || '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

function rewriteHttpHydrusToSameOriginProxy(absoluteUrl: string) {
  if (typeof window === 'undefined' || window.location?.protocol !== 'https:') return absoluteUrl
  if (!/^http:\/\//i.test(absoluteUrl)) return absoluteUrl
  if (!isHydrusProxyEnabled()) return absoluteUrl

  return `${window.location.origin}/hydrus-proxy`
}

function redactAccessKey(value: string) {
  return value.replace(/Hydrus-Client-API-Access-Key=[^&\s]*/gi, 'Hydrus-Client-API-Access-Key=REDACTED')
}

async function cancelResponseBody(response: Response) {
  try {
    await response.body?.cancel()
  } catch {
    try { await response.arrayBuffer() } catch {}
  }
}

function clientSignature(cfg: Pick<ServerConfig, 'host' | 'port' | 'apiKey' | 'ssl' | 'forceApiKeyInQuery'>) {
  return [cfg.host, cfg.port ?? '', cfg.apiKey || '', cfg.ssl ? '1' : '0', cfg.forceApiKeyInQuery ? '1' : '0'].join('|')
}

export function getHydrusClient(cfg: Partial<ServerConfig> = {}) {
  if (!cfg.id) return new HydrusClient(cfg)

  const signature = clientSignature({
    host: (cfg.host || '').trim(),
    port: sanitizePort(cfg.port),
    apiKey: sanitizeApiKey(cfg.apiKey),
    ssl: !!cfg.ssl,
    forceApiKeyInQuery: !!cfg.forceApiKeyInQuery,
  })
  const existing = clientRegistry.get(cfg.id)
  if (existing && existing.signature === signature) return existing.client

  const client = new HydrusClient(cfg)
  clientRegistry.set(cfg.id, { signature, client })
  return client
}

export class HydrusClient {
  cfg: ServerConfig
  private metadataPayloadCache = new Map<number, { data: unknown; storedAt: number }>()

  constructor(cfg: Partial<ServerConfig> = {}) {
    this.cfg = {
      id: (cfg.id as string) || makeId(),
      name: (cfg.name || '').trim(),
      host: (cfg.host || '').trim(),
      port: sanitizePort(cfg.port),
      apiKey: sanitizeApiKey(cfg.apiKey),
      ssl: !!cfg.ssl,
      forceApiKeyInQuery: !!cfg.forceApiKeyInQuery,
    }
  }

  baseUrl(): string {
    if (!this.cfg.host) throw new Error('Hydrus host not defined')
    let url = this.cfg.host.trim().replace(/\/+$/, '')

    if (url.startsWith('/')) {
      if (typeof window !== 'undefined' && window.location?.origin) {
        return `${window.location.origin}${url}`
      }
      return url
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = (this.cfg.ssl ? 'https://' : 'http://') + url
    }
    try {
      const parsed = new URL(url)
      if (this.cfg.port && !parsed.port) {
        parsed.port = String(this.cfg.port)
      }
      const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname.replace(/\/$/, '') : ''
      const absolute = parsed.origin + path
      return rewriteHttpHydrusToSameOriginProxy(absolute)
    } catch {
      return url + (this.cfg.port ? `:${this.cfg.port}` : '')
    }
  }

  private describeFetchFailure(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err)
    const target = (() => {
      try {
        return this.baseUrl()
      } catch {
        return this.cfg.host || 'unknown host'
      }
    })()

    let pageIsHttps = false
    try {
      pageIsHttps = typeof window !== 'undefined' && window.location?.protocol === 'https:'
    } catch {
      pageIsHttps = false
    }

    const targetIsHttp = /^http:\/\//i.test(target)
    if (pageIsHttps && targetIsHttp) {
      return [
        'Blocked mixed content: this app is HTTPS but Hydrus is HTTP.',
        'Browsers block that even when Hydrus CORS is enabled.',
        'Fix: put Hydrus behind HTTPS, serve this app over HTTP on your LAN, or use the built-in /hydrus-proxy reverse proxy (see README).',
        `Target: ${target}`,
      ].join(' ')
    }

    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || err instanceof TypeError) {
      return [
        `Network or CORS error talking to ${target}.`,
        'If the URL is reachable, enable CORS + non-local API in Hydrus services,',
        'or route through a same-origin reverse proxy (/hydrus-proxy).',
        `Details: ${msg}`,
      ].join(' ')
    }

    return msg
  }

  getHeaders(includeApiKeyInHeader = true, includeContentType = false) {
    const headers: Record<string, string> = {}
    if (includeContentType) headers['Content-Type'] = 'application/json'
    if (this.cfg.apiKey && includeApiKeyInHeader) headers['Hydrus-Client-API-Access-Key'] = this.cfg.apiKey
    return headers
  }

  private appendApiKeyToUrl(url: string) {
    if (!this.cfg.apiKey) return url
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}Hydrus-Client-API-Access-Key=${encodeURIComponent(this.cfg.apiKey)}`
  }

  private buildApiUrl(path: string, params: Record<string, string | number | undefined> = {}, includeApiKeyInQuery = false) {
    const url = new URL(`${this.baseUrl()}${path}`)

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue
      url.searchParams.set(key, String(value))
    }

    if (includeApiKeyInQuery && this.cfg.apiKey) {
      url.searchParams.set('Hydrus-Client-API-Access-Key', this.cfg.apiKey)
    }

    return url.toString()
  }

  private async fetchWithAuthRetry(url: string, init: RequestInit = {}) {
    const requestInit: RequestInit = { mode: 'cors', ...init }
    let response = await fetch(url, requestInit)

    if ((response.status === 401 || response.status === 403) && this.cfg.apiKey && !(this.cfg.forceApiKeyInQuery ?? false)) {
      response = await fetch(this.appendApiKeyToUrl(url), {
        ...requestInit,
        headers: undefined,
      })
    }

    return response
  }

  private readMetadataPayload(fileId: number) {
    const cached = this.metadataPayloadCache.get(fileId)
    if (!cached) return undefined
    if (Date.now() - cached.storedAt > METADATA_CACHE_TTL_MS) {
      this.metadataPayloadCache.delete(fileId)
      return undefined
    }
    this.metadataPayloadCache.delete(fileId)
    this.metadataPayloadCache.set(fileId, cached)
    return cached.data
  }

  private rememberMetadataPayload(fileId: number, data: unknown) {
    this.metadataPayloadCache.delete(fileId)
    if (this.metadataPayloadCache.size >= METADATA_CACHE_LIMIT) {
      const oldest = this.metadataPayloadCache.keys().next().value
      if (oldest != null) this.metadataPayloadCache.delete(oldest)
    }
    this.metadataPayloadCache.set(fileId, { data, storedAt: Date.now() })
  }

  private async getFileMetadataPayload(fileId: number, signal?: AbortSignal) {
    const cached = this.readMetadataPayload(fileId)
    if (cached !== undefined) return cached

    const url = this.buildApiUrl('/get_files/file_metadata', { file_id: fileId }, this.cfg.forceApiKeyInQuery ?? false)
    const headers = this.getHeaders(!(this.cfg.forceApiKeyInQuery ?? false))
    const res = await this.fetchWithAuthRetry(url, { method: 'GET', headers, signal })

    if (res.status === 404) {
      console.warn('[HydrusClient] getFileMetadata 404', { url, status: res.status })
      return null
    }

    if (!res.ok) {
      console.warn('[HydrusClient] getFileMetadata Response Error', { status: res.status, statusText: res.statusText })
      return null
    }

    const data = await res.json().catch(() => null)
    if (data) this.rememberMetadataPayload(fileId, data)
    return data
  }

  private async getFilesMetadataPayload(fileIds: number[], signal?: AbortSignal) {
    if (!fileIds || fileIds.length === 0) return []

    const url = this.buildApiUrl('/get_files/file_metadata', {
      file_ids: JSON.stringify(fileIds),
      include_services_object: 'false',
    }, this.cfg.forceApiKeyInQuery ?? false)
    const headers = this.getHeaders(!(this.cfg.forceApiKeyInQuery ?? false))
    const res = await this.fetchWithAuthRetry(url, { method: 'GET', headers, signal })

    if (!res.ok) {
      throw new Error(`Metadata request failed (${res.status})`)
    }

    const data = await res.json().catch(() => null)
    if (Array.isArray(data?.metadata)) return data.metadata
    if (Array.isArray(data?.file_metadata)) return data.file_metadata
    if (Array.isArray(data)) return data
    return []
  }

  private cleanSearchTag(value: HydrusSearchTag | undefined | null): HydrusSearchTag | null {
    if (!value) return null
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) return null
      return /^system:/i.test(trimmed) ? this.normalizeSystemPredicate(trimmed) : trimmed
    }
    if (Array.isArray(value)) {
      const cleaned = value
        .map((item) => this.cleanSearchTag(item))
        .filter((item): item is HydrusSearchTag => item !== null)
      return cleaned.length ? cleaned : null
    }
    return null
  }

  private normalizeSystemPredicate(value: string) {
    const trimmed = value.trim().replace(/\s+/g, ' ')
    const match = trimmed.match(SYSTEM_PREDICATE_PATTERN)
    if (!match) return trimmed

    const [, left, operator, right] = match
    return `${left.trim()} ${operator} ${right.trim()}`
  }

  private buildSearchTags(searchableText: string | HydrusSearchTags | undefined | null): HydrusSearchTags {
    const tags: HydrusSearchTags = []
    if (!searchableText) return tags

    const seen = new Set<string>()

    const pushValue = (value: HydrusSearchTag | undefined | null) => {
      const cleaned = this.cleanSearchTag(value)
      if (!cleaned) return
      const key = JSON.stringify(cleaned)
      if (seen.has(key)) return
      seen.add(key)
      tags.push(cleaned)
    }

    if (typeof searchableText === 'string') {
      const s = searchableText.trim()
      if (!s) return tags

      if (/^system:/i.test(s)) {
        pushValue(this.normalizeSystemPredicate(s))
        return tags
      }

      const tokens = s.match(SEARCH_TOKEN_PATTERN)?.filter(Boolean) ?? []
      const wildcardize = (tok: string) => (tok.includes('*') ? tok : `*${tok}*`)

      if (tokens.length === 1) {
        const t = tokens[0]
        if (t.includes(':')) {
          pushValue(t)
        } else {
          pushValue([t, `title:${wildcardize(t)}`])
        }
      } else {
        if (!s.includes(':')) {
          pushValue([s, `title:${wildcardize(s)}`])
        }

        for (const t of tokens) {
          if (t.includes(':')) pushValue(t)
          else pushValue([t, `title:${wildcardize(t)}`])
        }
      }
    } else {
      for (const tag of searchableText) {
        pushValue(tag)
      }
    }

    return tags
  }

  async searchFiles(searchableText: string | HydrusSearchTags | null = '', resultsPerPage = 20, signal?: AbortSignal): Promise<number[]> {
    const headers = this.getHeaders(!(this.cfg.forceApiKeyInQuery ?? false))

    const tagsArr: HydrusSearchTags = this.buildSearchTags(searchableText)
    tagsArr.push(this.normalizeSystemPredicate(`system:limit=${resultsPerPage}`))

    const url = this.buildApiUrl('/get_files/search_files', {
      tags: JSON.stringify(tagsArr),
      return_file_ids: 'true',
    }, this.cfg.forceApiKeyInQuery ?? false)

    const res = await this.fetchWithAuthRetry(url, { method: 'GET', headers, signal })

    if (res.status === 404) {
      const text = await res.text().catch(() => '')
      console.warn('[HydrusClient] searchFiles 404', { url: redactAccessKey(url), status: res.status, body: text })
      throw new Error(`Search failed (404): ${text ? text : 'Not Found'} (request: ${redactAccessKey(url)}). Note: /get_files/search_files expects GET with a 'tags' query parameter. Avoid POST fallback as this endpoint may not accept POST.`)
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.warn('[HydrusClient] searchFiles Response Error', { status: res.status, statusText: res.statusText, body: text })
      throw new Error(`Search failed (${res.status})${text ? ': ' + (text.length > 1000 ? text.slice(0, 1000) + '...' : text) : ''} (request: ${redactAccessKey(url)})`)
    }

    const data = await res.json().catch(() => null)
    if (Array.isArray(data)) return data as number[]
    if (data && Array.isArray((data as { file_ids?: unknown }).file_ids)) return (data as { file_ids: number[] }).file_ids
    if (data && Array.isArray((data as { results?: unknown }).results)) return (data as { results: number[] }).results
    return []
  }

  getFileUrl(fileId: number, includeApiKeyInQuery = true) {
    return this.buildApiUrl('/get_files/file', { file_id: fileId }, includeApiKeyInQuery)
  }

  getThumbnailUrl(fileId: number, includeApiKeyInQuery = true) {
    return this.buildApiUrl('/get_files/thumbnail', { file_id: fileId }, includeApiKeyInQuery)
  }

  async testConnectivity(): Promise<ConnectivityResult> {
    try {
      const searchUrl = this.buildApiUrl('/get_files/search_files', {
        tags: JSON.stringify([this.normalizeSystemPredicate('system:limit=1')]),
        return_file_ids: 'true',
      }, this.cfg.forceApiKeyInQuery ?? false)

      const headers = this.getHeaders(!(this.cfg.forceApiKeyInQuery ?? false))

      const res = await this.fetchWithAuthRetry(searchUrl, { method: 'GET', headers })

      if ((res.status === 401 || res.status === 403) && this.cfg.apiKey) {
        return { ok: false, message: `Authentication required (status ${res.status})`, status: res.status }
      }

      if (res.status === 404) {
        const text = await res.text().catch(() => '')
        return { ok: false, message: `Search endpoint not found (404): ${text ? text : 'No response body'}`, status: 404 }
      }

      if (!res.ok) return { ok: false, message: `Search request failed (status ${res.status})`, status: res.status }

      const json = await res.json().catch(() => null)
      const fileId = Array.isArray(json) && json.length > 0 ? json[0] : json?.file_ids?.[0] ?? null

      const result: ConnectivityResult = { ok: true, message: 'Connected (search OK)', status: res.status, searchOk: true }

      if (fileId) {
        try {
          const fileUrl = `${this.baseUrl()}/get_files/file?file_id=${fileId}`
          const headers2: Record<string, string> = {}
          if (this.cfg.apiKey && !(this.cfg.forceApiKeyInQuery ?? false)) headers2['Hydrus-Client-API-Access-Key'] = this.cfg.apiKey
          headers2['Range'] = 'bytes=0-0'

          const rres = await fetch(fileUrl, { method: 'GET', headers: headers2, mode: 'cors' })
          const rangeSupported = rres.status === 206 || (rres.headers.get('accept-ranges') || '').toLowerCase() === 'bytes'
          await cancelResponseBody(rres)
          if (rangeSupported) {
            result.rangeSupported = true
            result.message += '; Range requests supported'
            return result
          }

          if (this.cfg.apiKey) {
            const qUrl = `${this.getFileUrl(fileId, true)}`
            const rres2 = await fetch(qUrl, { method: 'GET', headers: { Range: 'bytes=0-0' }, mode: 'cors' })
            const queryRangeSupported = rres2.status === 206 || (rres2.headers.get('accept-ranges') || '').toLowerCase() === 'bytes'
            await cancelResponseBody(rres2)
            if (queryRangeSupported) {
              result.rangeSupported = true
              result.message += '; Range requests supported (via query param)'
              return result
            }
          }

          result.rangeSupported = false
          result.message += '; Range request test failed (no 206)'
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error)
          result.rangeSupported = false
          result.message += `; Range test error: ${message}`
        }
      } else {
        result.message += '; No files to test Range support'
      }

      return result
    } catch (err: unknown) {
      return { ok: false, message: this.describeFetchFailure(err) }
    }
  }

  async getFileDetails(fileId: number, signal?: AbortSignal): Promise<HydrusFileDetails> {
    const data = await this.getFileMetadataPayload(fileId, signal)
    if (!data) return { fileId, tags: [] }
    return extractFileDetailsFromMetadata(data, fileId)
  }

  private metadataFromPayload(data: unknown, fileId: number): HydrusFileMetadata {
    return {
      ...extractMediaInfoFromMetadata(data, fileId),
      tags: extractTagsFromMetadata(data, fileId),
    }
  }

  async getFilesMetadata(fileIds: number[], concurrency = 4, signal?: AbortSignal, options?: { fresh?: boolean }): Promise<Record<number, HydrusFileMetadata>> {
    const out: Record<number, HydrusFileMetadata> = {}
    if (!fileIds || fileIds.length === 0) return out

    const uniqueFileIds = Array.from(new Set(fileIds.filter((fileId) => Number.isFinite(fileId))))
    const missingFileIds: number[] = []
    const fresh = options?.fresh === true
    for (const fileId of uniqueFileIds) {
      if (fresh) {
        missingFileIds.push(fileId)
        continue
      }
      const cached = this.readMetadataPayload(fileId)
      if (cached !== undefined) {
        out[fileId] = this.metadataFromPayload(cached, fileId)
      } else {
        missingFileIds.push(fileId)
      }
    }

    if (missingFileIds.length === 0) return out

    const batchSize = 128
    const batches: number[][] = []
    for (let index = 0; index < missingFileIds.length; index += batchSize) {
      batches.push(missingFileIds.slice(index, index + batchSize))
    }

    let idx = 0
    const workers = new Array(Math.min(concurrency, batches.length)).fill(null).map(async () => {
      while (true) {
        if (signal?.aborted) throw createAbortError()

        const i = idx
        if (i >= batches.length) break
        idx++

        const batch = batches[i]
        try {
          const entries = await this.getFilesMetadataPayload(batch, signal)
          const entryMap = new Map<number, unknown>()

          for (const entry of entries) {
            const entryFileId = Number((entry as { file_id?: unknown })?.file_id)
            if (Number.isFinite(entryFileId)) {
              entryMap.set(entryFileId, entry)
              this.rememberMetadataPayload(entryFileId, entry)
            }
          }

          for (const fid of batch) {
            const entry = entryMap.get(fid)
            if (!entry) continue
            out[fid] = this.metadataFromPayload(entry, fid)
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name === 'AbortError') throw error
          throw error
        }
      }
    })

    await Promise.all(workers)
    return out
  }
}
