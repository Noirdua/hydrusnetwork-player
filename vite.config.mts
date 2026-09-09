import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadiumMiddleware } from './scripts/readiumStreamer.mjs'

function buildHydrusProxy(target: string): Record<string, ProxyOptions> {
  const normalizedTarget = target.replace(/\/+$/, '')
  if (!normalizedTarget) return {}

  return {
    '/hydrus-proxy': {
      target: normalizedTarget,
      changeOrigin: true,
      secure: false,
      rewrite: (path) => path.replace(/^\/hydrus-proxy/, '') || '/',
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq) => {
          // Hydrus often binds to a specific host; strip hop-by-hop noise.
          proxyReq.removeHeader('origin')
        })
      },
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = (env.HYDRUS_PROXY_TARGET || env.VITE_HYDRUS_PROXY_TARGET || '').trim()
  const proxy = buildHydrusProxy(proxyTarget)
  const proxyEnabled = Boolean(proxyTarget)

  return {
    plugins: [
      react(),
      {
        name: 'readium-streamer',
        configureServer(server) {
          server.middlewares.use(createReadiumMiddleware())
        },
        configurePreviewServer(server) {
          server.middlewares.use(createReadiumMiddleware())
        },
      },
    ],
    optimizeDeps: {
      exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core'],
    },
    // Lets the client know the build-time proxy is configured so Settings can default to /hydrus-proxy.
    define: {
      'import.meta.env.VITE_HYDRUS_PROXY_ENABLED': JSON.stringify(proxyEnabled ? 'true' : 'false'),
      'import.meta.env.VITE_HYDRUS_PROXY_TARGET': JSON.stringify(proxyTarget),
    },
    server: {
      port: 5173,
      proxy,
    },
    preview: {
      proxy,
    },
  }
})
