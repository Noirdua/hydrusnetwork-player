import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { loadEnv } from 'vite'

const STREAMER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG_LIMIT = 200

export const READIUM_PREFIX = '/readium'

const MAX_PUBLICATION_BYTES = 150 * 1024 * 1024
const CACHE_LIMIT = 8
const publicationCache = new Map()
const sourceAliases = new Map()
const SOURCE_ALIAS_LIMIT = 400

const MIME_BY_EXT = {
  xhtml: 'text/html',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'application/javascript',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ncx: 'application/x-dtbncx+xml',
  xml: 'application/xml',
  opf: 'application/oebps-package+xml',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  smil: 'application/smil+xml',
  txt: 'text/plain',
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length')
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
}

function send(res, status, body, headers = {}) {
  setCorsHeaders(res)
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
  res.statusCode = status
  res.end(body)
}

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  return Buffer.from(padded, 'base64').toString('utf8')
}

function normalizeZipPath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .split('/')
    .filter((part) => part && part !== '.')
    .reduce((parts, part) => {
      if (part === '..') parts.pop()
      else parts.push(part)
      return parts
    }, [])
    .join('/')
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .trim()
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))
    || tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'))
  return match ? decodeXmlEntities(match[1]) : ''
}

function innerText(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, 'i'))
  return match ? decodeXmlEntities(match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')) : ''
}

function mimeForPath(filePath, fallback) {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return MIME_BY_EXT[ext] || fallback || 'application/octet-stream'
}

function resolveAgainst(baseDir, href) {
  const cleaned = String(href || '').split('#')[0].split('?')[0]
  if (!cleaned) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(cleaned)) return cleaned
  return normalizeZipPath(baseDir ? `${baseDir}/${cleaned}` : cleaned)
}

function findZipEntry(files, wanted) {
  const normalized = normalizeZipPath(wanted)
  if (files[normalized]) return { path: normalized, bytes: files[normalized] }
  const lower = normalized.toLowerCase()
  for (const [path, bytes] of Object.entries(files)) {
    if (path.toLowerCase() === lower) return { path, bytes }
  }
  return null
}

function bytesToString(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

function isZip(buffer) {
  return buffer.byteLength >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b
}

function isPdf(buffer) {
  return buffer.byteLength >= 4 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46
}

function publicationBase(selfHref) {
  return selfHref.replace(/manifest\.json$/, '')
}

function buildPositions(readingOrder) {
  const total = readingOrder.length
  const positions = readingOrder.map((item, index) => ({
    href: item.href,
    type: item.type,
    locations: {
      position: index + 1,
      progression: 0,
      totalProgression: total <= 1 ? 0 : index / total,
    },
  }))
  return { total: positions.length, positions }
}

function withPositionsLink(manifest, selfHref) {
  const links = [...(manifest.links || [])]
  if (!links.some((link) => link.type === 'application/vnd.readium.position-list+json')) {
    links.push({
      href: `${publicationBase(selfHref)}positions.json`,
      type: 'application/vnd.readium.position-list+json',
    })
  }
  manifest.links = links
  return manifest
}

function rememberSourceUrl(sourceUrl) {
  for (const [id, url] of sourceAliases) {
    if (url === sourceUrl) return id
  }
  const id = randomBytes(16).toString('hex')
  sourceAliases.set(id, sourceUrl)
  if (sourceAliases.size > SOURCE_ALIAS_LIMIT) {
    const oldest = sourceAliases.keys().next().value
    if (oldest) sourceAliases.delete(oldest)
  }
  return id
}

function resolveSourceUrl(encodedSource) {
  if (sourceAliases.has(encodedSource)) return sourceAliases.get(encodedSource)
  return decodeBase64Url(encodedSource)
}

function isAllowedSourceUrl(raw) {
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  return parsed.pathname.includes('/get_files/file')
}

function parseContainerRootPath(xml) {
  const match = xml.match(/<rootfile\b[^>]*>/i)
  if (!match) return ''
  return normalizeZipPath(attr(match[0], 'full-path'))
}

function parseOpfItems(opfXml) {
  const items = new Map()
  const itemPattern = /<item\b[^>]*\/?>/gi
  let match
  while ((match = itemPattern.exec(opfXml))) {
    const tag = match[0]
    const id = attr(tag, 'id')
    const href = attr(tag, 'href')
    if (!id || !href) continue
    items.set(id, {
      id,
      href,
      mediaType: attr(tag, 'media-type'),
      properties: attr(tag, 'properties').split(/\s+/).filter(Boolean),
    })
  }
  return items
}

function parseSpineIds(opfXml) {
  const ids = []
  const itemrefPattern = /<itemref\b[^>]*\/?>/gi
  let match
  while ((match = itemrefPattern.exec(opfXml))) {
    const idref = attr(match[0], 'idref')
    const linear = attr(match[0], 'linear').toLowerCase()
    if (!idref || linear === 'no') continue
    ids.push(idref)
  }
  return ids
}

function parseCoverId(opfXml, items) {
  const metaPattern = /<meta\b[^>]*\/?>/gi
  let match
  while ((match = metaPattern.exec(opfXml))) {
    const tag = match[0]
    if (attr(tag, 'name').toLowerCase() === 'cover') return attr(tag, 'content')
    if (attr(tag, 'property').toLowerCase() === 'cover-image') {
      const id = attr(tag, 'id')
      if (id) return id
    }
  }
  for (const item of items.values()) {
    if (item.properties.includes('cover-image')) return item.id
  }
  return ''
}

function parseNavToc(navXml, navDir) {
  const toc = []
  const stack = [{ children: toc }]
  const tokenPattern = /<ol\b[^>]*>|<\/ol>|<a\b[^>]*>[\s\S]*?<\/a>/gi
  let match
  while ((match = tokenPattern.exec(navXml))) {
    const token = match[0]
    if (/^<ol\b/i.test(token)) {
      const parent = stack[stack.length - 1]
      const last = parent.children[parent.children.length - 1]
      if (last) {
        last.children = last.children || []
        stack.push(last)
      }
      continue
    }
    if (/^<\/ol>/i.test(token)) {
      if (stack.length > 1) stack.pop()
      continue
    }
    const href = attr(token, 'href')
    const title = decodeXmlEntities(token.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
    if (!href || !title) continue
    stack[stack.length - 1].children.push({
      href: resolveAgainst(navDir, href),
      title,
    })
  }
  return toc
}

function buildManifest(files, selfHref) {
  const container = findZipEntry(files, 'META-INF/container.xml')
  if (!container) throw new Error('Not a valid EPUB: missing META-INF/container.xml')

  const rootPath = parseContainerRootPath(bytesToString(container.bytes))
  if (!rootPath) throw new Error('Not a valid EPUB: missing rootfile')

  const opfEntry = findZipEntry(files, rootPath)
  if (!opfEntry) throw new Error(`Not a valid EPUB: missing ${rootPath}`)

  const opfXml = bytesToString(opfEntry.bytes)
  const opfDir = rootPath.split('/').slice(0, -1).join('/')
  const items = parseOpfItems(opfXml)
  const spineIds = parseSpineIds(opfXml)
  const coverId = parseCoverId(opfXml, items)

  const readingOrder = []
  const resources = []
  const used = new Set()

  for (const id of spineIds) {
    const item = items.get(id)
    if (!item) continue
    const href = resolveAgainst(opfDir, item.href)
    if (!href || used.has(href)) continue
    used.add(href)
    readingOrder.push({
      href,
      type: item.mediaType || mimeForPath(href, 'application/xhtml+xml'),
    })
  }

  if (!readingOrder.length) throw new Error('Not a valid EPUB: empty spine')

  for (const item of items.values()) {
    const href = resolveAgainst(opfDir, item.href)
    if (!href || used.has(href)) continue
    used.add(href)
    const link = {
      href,
      type: item.mediaType || mimeForPath(href),
    }
    if (item.id === coverId || item.properties.includes('cover-image')) link.rel = 'cover'
    resources.push(link)
  }

  const navItem = [...items.values()].find((item) => item.properties.includes('nav'))
  let toc
  if (navItem) {
    const navPath = resolveAgainst(opfDir, navItem.href)
    const navEntry = findZipEntry(files, navPath)
    if (navEntry) {
      toc = parseNavToc(bytesToString(navEntry.bytes), navPath.split('/').slice(0, -1).join('/'))
    }
  }

  const title = innerText(opfXml, 'dc:title') || 'Untitled'
  const identifier = innerText(opfXml, 'dc:identifier') || selfHref
  const author = innerText(opfXml, 'dc:creator')
  const language = innerText(opfXml, 'dc:language')
  let layout = /pre-paginated|fixed-layout/i.test(opfXml) ? 'fixed' : undefined
  if (!layout) {
    for (const item of readingOrder.slice(0, 8)) {
      const entry = findZipEntry(files, item.href)
      if (!entry) continue
      if (/<meta\b[^>]*name=["']viewport["']/i.test(bytesToString(entry.bytes))) {
        layout = 'fixed'
        break
      }
    }
  }

  const metadata = {
    title,
    identifier,
    conformsTo: 'https://readium.org/webpub-manifest/profiles/epub',
  }
  if (author) metadata.author = author
  if (language) metadata.language = language
  if (layout) metadata.layout = layout

  const manifest = {
    '@context': 'https://readium.org/webpub-manifest/context.jsonld',
    metadata,
    links: [
      { rel: 'self', href: selfHref, type: 'application/webpub+json' },
    ],
    readingOrder,
    resources,
  }
  if (toc?.length) manifest.toc = toc
  return withPositionsLink(manifest, selfHref)
}

function buildPdfPublication(buffer, selfHref) {
  const pdfHref = `${publicationBase(selfHref)}publication.pdf`
  const html = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>PDF</title>
<style>
html, body { margin: 0; height: 100%; background: #111; }
iframe { border: 0; width: 100%; height: 100%; }
</style>
</head>
<body>
<iframe src="${pdfHref}" title="PDF"></iframe>
</body>
</html>`
  const files = {
    'index.xhtml': new TextEncoder().encode(html),
    'publication.pdf': buffer,
  }
  const readingOrder = [{ href: 'index.xhtml', type: 'application/xhtml+xml' }]
  const manifest = withPositionsLink({
    '@context': 'https://readium.org/webpub-manifest/context.jsonld',
    metadata: {
      title: 'PDF',
      conformsTo: 'https://readium.org/webpub-manifest/profiles/epub',
    },
    links: [
      { rel: 'self', href: selfHref, type: 'application/webpub+json' },
    ],
    readingOrder,
    resources: [{ href: 'publication.pdf', type: 'application/pdf' }],
  }, selfHref)
  return {
    files,
    manifest,
    positions: buildPositions(readingOrder),
  }
}

function rememberPublication(sourceUrl, entry) {
  publicationCache.delete(sourceUrl)
  publicationCache.set(sourceUrl, entry)
  while (publicationCache.size > CACHE_LIMIT) {
    const oldest = publicationCache.keys().next().value
    publicationCache.delete(oldest)
  }
}

async function loadPublication(sourceUrl, selfHref) {
  const cached = publicationCache.get(sourceUrl)
  if (cached) {
    rememberPublication(sourceUrl, cached)
    return cached
  }

  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(60000) })
  if (!response.ok) {
    throw new Error(`Failed to fetch publication (${response.status})`)
  }

  const lengthHeader = Number(response.headers.get('content-length') || 0)
  if (lengthHeader > MAX_PUBLICATION_BYTES) {
    throw new Error('Publication is too large to stream')
  }

  const buffer = new Uint8Array(await response.arrayBuffer())
  if (buffer.byteLength > MAX_PUBLICATION_BYTES) {
    throw new Error('Publication is too large to stream')
  }

  if (isPdf(buffer)) {
    const entry = buildPdfPublication(buffer, selfHref)
    rememberPublication(sourceUrl, entry)
    return entry
  }

  if (!isZip(buffer)) {
    throw new Error('Hydrus file is not an EPUB or PDF')
  }

  const unzipped = unzipSync(buffer)
  const files = {}
  for (const [name, bytes] of Object.entries(unzipped)) {
    const path = normalizeZipPath(name)
    if (!path || path.endsWith('/')) continue
    files[path] = bytes
  }

  const manifest = buildManifest(files, selfHref)
  const entry = {
    files,
    manifest,
    positions: buildPositions(manifest.readingOrder),
  }
  rememberPublication(sourceUrl, entry)
  return entry
}

function parseReadiumPath(rawUrl) {
  const parsed = new URL(rawUrl, 'http://streamer.local')
  const match = parsed.pathname.match(/^\/readium\/webpub\/([^/]+)\/(.*)$/)
  if (!match) return null
  return {
    encodedSource: match[1],
    rest: decodeURIComponent(match[2] || ''),
  }
}

const CATALOG_FILE = path.join(STREAMER_ROOT, '.readium-catalog.json')

function loadPostedCatalog() {
  try {
    return sanitizeCatalog(JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8')))
  } catch {
    return { publications: [] }
  }
}

let postedCatalog = loadPostedCatalog()

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function sanitizeCatalog(data) {
  const publications = Array.isArray(data?.publications) ? data.publications : []
  return {
    publications: publications
      .slice(0, 500)
      .map((item) => ({
        title: String(item?.title || 'Untitled'),
        author: String(item?.author || 'Unknown'),
        cover: String(item?.cover || ''),
        url: String(item?.url || ''),
        rendition: String(item?.rendition || 'EPUB'),
        source: String(item?.source || ''),
      }))
      .filter((item) => item.url),
  }
}

function encodeUrlSafeBase64(value) {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\//g, '_').replace(/\+/g, '-').replace(/=+$/g, '')
}

function hydrusEnv() {
  const loaded = loadEnv(process.env.NODE_ENV === 'development' ? 'development' : 'production', STREAMER_ROOT, '')
  return { ...loaded, ...process.env }
}

function hydrusConfig() {
  const env = hydrusEnv()
  const apiKey = String(env.HYDRUS_API_KEY || env.VITE_HYDRUS_API_KEY || '').replace(/\s+/g, '')
  let host = String(env.HYDRUS_HOST || env.VITE_HYDRUS_HOST || env.HYDRUS_PROXY_TARGET || env.VITE_HYDRUS_PROXY_TARGET || '').trim().replace(/\/+$/, '')
  const port = String(env.HYDRUS_PORT || env.VITE_HYDRUS_PORT || '').trim()
  if (host && port && !host.startsWith('/')) {
    try {
      const parsed = new URL(/^https?:\/\//i.test(host) ? host : `http://${host}`)
      if (!parsed.port) parsed.port = port
      host = parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, ''))
    } catch {
      host = `${host}:${port}`
    }
  }
  return { host, apiKey }
}

function collectTags(entry) {
  const tags = []
  const walk = (value) => {
    if (typeof value === 'string') {
      tags.push(value)
      return
    }
    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }
    if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk(entry?.service_names_to_statuses_to_tags || entry?.tags)
  return tags
}

function namespaceValue(tags, name) {
  const prefix = `${name.toLowerCase()}:`
  const matches = tags
    .filter((tag) => tag.toLowerCase().startsWith(prefix))
    .map((tag) => tag.slice(prefix.length).replace(/_/g, ' ').trim())
    .filter(Boolean)
  matches.sort((left, right) => right.length - left.length)
  return matches[0] || ''
}

function hydrusUrl(host, apiPath, params, apiKey) {
  const url = new URL(`${host}${apiPath}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  if (apiKey) url.searchParams.set('Hydrus-Client-API-Access-Key', apiKey)
  return url.toString()
}

async function buildHydrusCatalog(req) {
  const { host, apiKey } = hydrusConfig()
  if (!host || !apiKey) {
    return {
      publications: [],
      error: 'Open API Media Player and sync cache so it can publish the Hydrus EPUB catalog.',
    }
  }

  const searchUrl = hydrusUrl(host, '/get_files/search_files', {
    tags: JSON.stringify(['ext:epub', `system:limit=${CATALOG_LIMIT}`]),
    return_file_ids: 'true',
  }, apiKey)
  const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(30000) })
  if (!searchRes.ok) {
    throw new Error(`Hydrus EPUB search failed (${searchRes.status})`)
  }
  const searchData = await searchRes.json()
  const fileIds = Array.isArray(searchData) ? searchData : searchData?.file_ids || searchData?.results || []
  if (!fileIds.length) return { publications: [] }

  const metadataUrl = hydrusUrl(host, '/get_files/file_metadata', {
    file_ids: JSON.stringify(fileIds),
    include_services_object: 'false',
  }, apiKey)
  const metadataRes = await fetch(metadataUrl, { signal: AbortSignal.timeout(30000) })
  if (!metadataRes.ok) {
    throw new Error(`Hydrus EPUB metadata failed (${metadataRes.status})`)
  }
  const metadataData = await metadataRes.json()
  const entries = Array.isArray(metadataData?.metadata)
    ? metadataData.metadata
    : Array.isArray(metadataData?.file_metadata)
      ? metadataData.file_metadata
      : Array.isArray(metadataData)
        ? metadataData
        : []
  const byId = new Map(entries.map((entry) => [Number(entry.file_id), entry]))

  const protoHeader = req.headers['x-forwarded-proto']
  const proto = protoHeader ? String(protoHeader).split(',')[0] : 'http'
  const requestHost = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:4173'
  const origin = `${proto}://${requestHost}`

  const publications = fileIds.map((fileId) => {
    const entry = byId.get(Number(fileId)) || {}
    const tags = collectTags(entry)
    const title = namespaceValue(tags, 'title') || `EPUB ${fileId}`
    const author = namespaceValue(tags, 'author') || namespaceValue(tags, 'creator') || 'Unknown'
    const fileUrl = hydrusUrl(host, '/get_files/file', { file_id: fileId }, apiKey)
    const cover = hydrusUrl(host, '/get_files/thumbnail', { file_id: fileId }, apiKey)
    const manifestUrl = `${origin}${READIUM_PREFIX}/webpub/${rememberSourceUrl(fileUrl)}/manifest.json`
    return {
      title,
      author,
      cover,
      url: `/read/manifest/${encodeURIComponent(manifestUrl)}`,
      rendition: 'EPUB',
      fileUrl,
    }
  })

  return { publications }
}

export function createReadiumMiddleware() {
  return (req, res, next) => {
    Promise.resolve(handleReadiumRequest(req, res))
      .then((handled) => {
        if (!handled && typeof next === 'function' && !res.headersSent) next()
      })
      .catch((error) => {
        if (typeof next === 'function') next(error)
        else send(res, 500, error instanceof Error ? error.message : String(error))
      })
  }
}

export async function handleReadiumRequest(req, res) {
  const rawUrl = req.url || '/'
  if (!rawUrl.startsWith(`${READIUM_PREFIX}/`)) return false

  setCorsHeaders(res)
  if (req.method === 'OPTIONS') {
    send(res, 204, '')
    return true
  }

  const pathOnly = rawUrl.split('?')[0]
  const isCatalog = pathOnly === `${READIUM_PREFIX}/catalog` || pathOnly === `${READIUM_PREFIX}/catalog.json`

  if (pathOnly === `${READIUM_PREFIX}/source` && req.method === 'POST') {
    try {
      const body = await readJsonBody(req)
      const sourceUrl = String(body?.url || '')
      if (!isAllowedSourceUrl(sourceUrl)) {
        send(res, 400, JSON.stringify({ ok: false, error: 'Invalid publication URL' }), {
          'Content-Type': 'application/json; charset=utf-8',
        })
        return true
      }
      const id = rememberSourceUrl(sourceUrl)
      send(res, 200, JSON.stringify({ ok: true, id }), {
        'Content-Type': 'application/json; charset=utf-8',
      })
    } catch {
      send(res, 400, JSON.stringify({ ok: false, error: 'Invalid source' }), {
        'Content-Type': 'application/json; charset=utf-8',
      })
    }
    return true
  }

  if (isCatalog && req.method === 'POST') {
    try {
      postedCatalog = sanitizeCatalog(await readJsonBody(req))
      try {
        fs.writeFileSync(CATALOG_FILE, JSON.stringify(postedCatalog))
      } catch {
        // ignore catalog persistence failures
      }
      send(res, 200, JSON.stringify({ ok: true, count: postedCatalog.publications.length }), {
        'Content-Type': 'application/json; charset=utf-8',
      })
    } catch {
      send(res, 400, JSON.stringify({ ok: false, error: 'Invalid catalog' }), {
        'Content-Type': 'application/json; charset=utf-8',
      })
    }
    return true
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method not allowed')
    return true
  }

  if (isCatalog) {
    try {
      const catalog = postedCatalog.publications.length
        ? postedCatalog
        : await buildHydrusCatalog(req)
      const body = JSON.stringify(
        catalog.publications.length
          ? catalog
          : {
              publications: [],
              error: catalog.error || 'Open API Media Player so it can publish the Hydrus EPUB catalog.',
            },
      )
      send(res, 200, body, { 'Content-Type': 'application/json; charset=utf-8' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      send(res, 502, JSON.stringify({ publications: [], error: message }), {
        'Content-Type': 'application/json; charset=utf-8',
      })
    }
    return true
  }

  const parsed = parseReadiumPath(rawUrl)
  if (!parsed) {
    send(res, 404, 'Not found')
    return true
  }

  let sourceUrl
  try {
    sourceUrl = resolveSourceUrl(parsed.encodedSource)
  } catch {
    send(res, 400, 'Invalid publication id')
    return true
  }

  if (!isAllowedSourceUrl(sourceUrl)) {
    send(res, 403, 'Publication URL is not a Hydrus file')
    return true
  }

  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'
  const protoHeader = req.headers['x-forwarded-proto']
  const proto = protoHeader ? String(protoHeader).split(',')[0] : 'http'
  const selfHref = `${proto}://${host}${READIUM_PREFIX}/webpub/${parsed.encodedSource}/manifest.json`

  try {
    const publication = await loadPublication(sourceUrl, selfHref)
    if (parsed.rest === 'manifest.json') {
      const body = JSON.stringify(publication.manifest)
      if (req.method === 'HEAD') {
        send(res, 200, '', {
          'Content-Type': 'application/webpub+json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
        })
        return true
      }
      send(res, 200, body, { 'Content-Type': 'application/webpub+json; charset=utf-8' })
      return true
    }

    if (parsed.rest === 'positions.json') {
      const body = JSON.stringify(publication.positions || { total: 0, positions: [] })
      if (req.method === 'HEAD') {
        send(res, 200, '', {
          'Content-Type': 'application/vnd.readium.position-list+json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
        })
        return true
      }
      send(res, 200, body, { 'Content-Type': 'application/vnd.readium.position-list+json; charset=utf-8' })
      return true
    }

    const entry = findZipEntry(publication.files, parsed.rest)
    if (!entry) {
      send(res, 404, 'Resource not found')
      return true
    }

    const type = mimeForPath(entry.path, 'application/octet-stream')
    if (req.method === 'HEAD') {
      send(res, 200, '', {
        'Content-Type': type,
        'Content-Length': entry.bytes.byteLength,
      })
      return true
    }

    setCorsHeaders(res)
    res.setHeader('Content-Type', type)
    res.setHeader('Content-Length', entry.bytes.byteLength)
    res.statusCode = 200
    res.end(Buffer.from(entry.bytes))
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    send(res, 502, message)
    return true
  }
}
