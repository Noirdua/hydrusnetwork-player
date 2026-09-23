import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { handleReadiumRequest } from './readiumStreamer.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const distDir = path.join(root, 'dist')
const port = Number(process.env.PORT || 4173)
const host = process.env.HOST || '0.0.0.0'

const env = loadEnv(process.env.NODE_ENV === 'development' ? 'development' : 'production', root, '')
const proxyTargetRaw = (process.env.HYDRUS_PROXY_TARGET || env.HYDRUS_PROXY_TARGET || env.VITE_HYDRUS_PROXY_TARGET || '').trim()
const proxyTarget = proxyTargetRaw.replace(/\/+$/, '')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
}

function send(res, status, body, headers = {}) {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status, headers)
  res.end(body)
}

function serveStatic(req, res, urlPath) {
  let decodedPath
  try {
    decodedPath = decodeURIComponent((urlPath.split('?')[0] || '/'))
  } catch {
    send(res, 400, 'Bad path')
    return
  }

  const safePath = decodedPath === '/' ? 'index.html' : decodedPath
  let filePath = path.resolve(distDir, `.${safePath.startsWith('/') ? safePath : `/${safePath}`}`)

  if (filePath !== distDir && !filePath.startsWith(distDir + path.sep)) {
    send(res, 403, 'Forbidden')
    return
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, 'index.html')
  }

  if (!fs.existsSync(filePath)) {
    send(res, 404, 'Not found')
    return
  }

  const ext = path.extname(filePath).toLowerCase()
  const type = MIME[ext] || 'application/octet-stream'
  const stream = fs.createReadStream(filePath)
  stream.on('error', () => send(res, 404, 'Not found'))
  res.writeHead(200, { 'Content-Type': type })
  stream.pipe(res)
}

function proxyHydrus(req, res, url) {
  if (!proxyTarget) {
    send(res, 502, 'HYDRUS_PROXY_TARGET is not configured')
    return
  }

  let target
  try {
    target = new URL(proxyTarget)
  } catch {
    send(res, 502, `Invalid HYDRUS_PROXY_TARGET: ${proxyTarget}`)
    return
  }

  const incoming = new URL(req.url || '/', 'http://localhost')
  const suffix = incoming.pathname.replace(/^\/hydrus-proxy/, '') || '/'
  const targetPath = `${suffix}${incoming.search}`
  const isHttps = target.protocol === 'https:'
  const transport = isHttps ? https : http

  const headers = { ...req.headers, host: target.host }
  delete headers['origin']
  delete headers['referer']

  let clientClosed = false
  const upstream = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      method: req.method,
      path: targetPath,
      headers,
    },
    (upstreamRes) => {
      if (clientClosed || res.destroyed || res.writableEnded) {
        upstreamRes.destroy()
        upstream.destroy()
        return
      }
      const outHeaders = { ...upstreamRes.headers }
      // Same-origin browser requests do not need CORS, but keep responses clean.
      delete outHeaders['access-control-allow-origin']
      res.writeHead(upstreamRes.statusCode || 502, outHeaders)
      upstreamRes.pipe(res)
    },
  )

  const stopUpstream = () => {
    clientClosed = true
    if (!upstream.destroyed) upstream.destroy()
  }

  upstream.setTimeout(30000)
  upstream.on('timeout', () => {
    upstream.destroy()
    if (!clientClosed) send(res, 504, 'Hydrus proxy timed out')
  })
  upstream.on('error', (error) => {
    if (clientClosed || res.destroyed || res.writableEnded) return
    send(res, 502, `Hydrus proxy failed: ${error.message}`)
  })
  req.on('aborted', stopUpstream)
  res.on('close', () => {
    if (!res.writableEnded) stopUpstream()
  })

  req.pipe(upstream)
}

if (!fs.existsSync(distDir)) {
  console.error(`[serve] Missing dist/. Run "npm run build" first.`)
  process.exit(1)
}

const server = http.createServer((req, res) => {
  try {
    const url = req.url || '/'
    if (url === '/hydrus-proxy' || url.startsWith('/hydrus-proxy/')) {
      proxyHydrus(req, res, url)
      return
    }
    if (url === '/readium' || url.startsWith('/readium/')) {
      void handleReadiumRequest(req, res).catch((error) => {
        send(res, 500, error instanceof Error ? error.message : String(error))
      })
      return
    }
    serveStatic(req, res, url)
  } catch (error) {
    send(res, 500, error instanceof Error ? error.message : 'Internal server error')
  }
})

server.listen(port, host, () => {
  console.log(`[serve] API Media Player on http://${host}:${port}`)
  console.log('[serve] /readium -> EPUB streamer for Thorium Web')
  if (proxyTarget) {
    console.log(`[serve] /hydrus-proxy -> ${proxyTarget}`)
  } else {
    console.log('[serve] HYDRUS_PROXY_TARGET not set; /hydrus-proxy is disabled')
  }
})
