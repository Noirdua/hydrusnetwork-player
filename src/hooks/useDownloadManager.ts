import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { makeId, type HydrusFileDetails } from '../api/hydrusClient'
import { addDevLog } from '../debugLog'
import type { DownloadOverlayItem } from '../components/DownloadsOverlay'
import { clearStoredDownloads, deleteStoredDownload, getStoredDownloadBlob, listStoredDownloads, saveStoredDownload } from '../downloadStore'
import type { Track } from '../types'
import { buildHydrusDownloadDisplayTitle } from '../utils/trackMetadata'
import {
  buildTrackDownloadKey,
  buildTrackDownloadName,
  embedDownloadMetadata,
  triggerBrowserDownload,
} from '../utils/downloadHelpers'

export function useDownloadManager({ isAppleMobileOrTablet }: { isAppleMobileOrTablet: boolean }) {
  const [downloads, setDownloads] = useState<DownloadOverlayItem[]>([])
  const downloadAbortControllersRef = useRef<Record<string, AbortController>>({})
  const downloadUrlsRef = useRef<Record<string, string>>({})
  const inFlightTrackKeysRef = useRef(new Set<string>())
  const cancelledIdsRef = useRef(new Set<string>())
  const dismissedIdsRef = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false

    void listStoredDownloads()
      .then((records) => {
        if (cancelled || records.length === 0) return

        const restoredDownloads: DownloadOverlayItem[] = records.map((record) => ({
          id: record.id,
          trackKey: record.trackKey,
          title: record.title,
          fileName: record.fileName,
          status: 'completed',
          receivedBytes: record.receivedBytes,
          totalBytes: record.totalBytes,
          note: record.note,
        }))

        setDownloads((prev) => {
          const existingIds = new Set(prev.map((download) => download.id))
          return [...prev, ...restoredDownloads.filter((download) => !existingIds.has(download.id))]
        })
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        addDevLog({ kind: 'error', category: 'downloads', message: `Failed to list stored downloads: ${message}` })
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      for (const controller of Object.values(downloadAbortControllersRef.current)) {
        try { controller.abort() } catch {}
      }
      for (const url of Object.values(downloadUrlsRef.current)) {
        try { window.URL.revokeObjectURL(url) } catch {}
      }
    }
  }, [])

  const updateDownload = useCallback((id: string, patch: Partial<DownloadOverlayItem>) => {
    setDownloads((prev) => prev.map((download) => (download.id === id ? { ...download, ...patch } : download)))
  }, [])

  const activeDownloads = useMemo(() => downloads.filter((download) => download.status === 'downloading'), [downloads])

  const isTrackDownloading = useCallback((track: Track) => {
    const trackKey = buildTrackDownloadKey(track)
    return downloads.some((download) => download.trackKey === trackKey && download.status === 'downloading')
  }, [downloads])

  const revokeDownloadUrl = useCallback((id: string) => {
    const objectUrl = downloadUrlsRef.current[id]
    if (!objectUrl) return

    try { window.URL.revokeObjectURL(objectUrl) } catch {}
    delete downloadUrlsRef.current[id]
  }, [])

  const queueDownload = useCallback((track: Track, details?: HydrusFileDetails | null) => {
    const id = makeId()
    const trackKey = buildTrackDownloadKey(track)

    if (inFlightTrackKeysRef.current.has(trackKey)) return
    inFlightTrackKeysRef.current.add(trackKey)

    const initialItem: DownloadOverlayItem = {
      id,
      trackKey,
      title: buildHydrusDownloadDisplayTitle(track, details),
      status: 'downloading',
      receivedBytes: 0,
      totalBytes: details?.sizeBytes || null,
    }

    setDownloads((prev) => [initialItem, ...prev])

    const controller = new AbortController()
    downloadAbortControllersRef.current[id] = controller
    void (async () => {
      try {
        const response = await fetch(track.url, { method: 'GET', mode: 'cors', signal: controller.signal })
        if (!response.ok) {
          throw new Error(`Download failed (${response.status})`)
        }

        const contentLength = Number(response.headers.get('content-length') || '')
        const resolvedTotalBytes = Number.isFinite(contentLength) && contentLength > 0
          ? contentLength
          : details?.sizeBytes || null

        updateDownload(id, { totalBytes: resolvedTotalBytes })

        let blob: Blob
        if (response.body) {
          const reader = response.body.getReader()
          const chunks: ArrayBuffer[] = []
          let receivedBytes = 0
          let lastProgressUpdate = 0

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (!value) continue

            const chunk = new Uint8Array(value.byteLength)
            chunk.set(value)
            chunks.push(chunk.buffer)
            receivedBytes += value.byteLength

            const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
            if (receivedBytes === resolvedTotalBytes || now - lastProgressUpdate > 120) {
              updateDownload(id, { receivedBytes })
              lastProgressUpdate = now
            }
          }

          blob = new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' })
          updateDownload(id, {
            receivedBytes,
            totalBytes: resolvedTotalBytes || blob.size || null,
          })
        } else {
          blob = await response.blob()
          updateDownload(id, {
            receivedBytes: blob.size,
            totalBytes: resolvedTotalBytes || blob.size || null,
          })
        }

        if (controller.signal.aborted || cancelledIdsRef.current.has(id)) return

        const shouldEmbedMetadataClientSide = !isAppleMobileOrTablet
        const taggedDownload = shouldEmbedMetadataClientSide
          ? await (async () => {
            updateDownload(id, {
              note: 'Embedding metadata...',
            })
            return embedDownloadMetadata(blob, track, details, response.headers.get('content-type'))
          })()
          : {
            blob,
            note: 'iOS download: using server-provided metadata (client embedding skipped)',
          }

        if (controller.signal.aborted || cancelledIdsRef.current.has(id)) return

        blob = taggedDownload.blob
        const downloadName = buildTrackDownloadName(track, details, response.headers.get('content-disposition'))
        const objectUrl = window.URL.createObjectURL(blob)
        downloadUrlsRef.current[id] = objectUrl
        triggerBrowserDownload(objectUrl, downloadName)

        let persistNote = taggedDownload.note
        let persisted = false
        if (!cancelledIdsRef.current.has(id) && !dismissedIdsRef.current.has(id)) {
          try {
            await saveStoredDownload({
              id,
              trackKey,
              title: buildHydrusDownloadDisplayTitle(track, details),
              fileName: downloadName,
              receivedBytes: blob.size,
              totalBytes: blob.size || resolvedTotalBytes || null,
              note: taggedDownload.note,
              blob,
              savedAt: Date.now(),
            })
            persisted = true
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error)
            persistNote = persistNote ? `${persistNote} • Not stored for later` : 'Saved this session only (storage failed)'
            addDevLog({ kind: 'error', category: 'downloads', message: `Failed to persist download: ${message}` })
          }
        }

        if (cancelledIdsRef.current.has(id) || dismissedIdsRef.current.has(id)) {
          if (persisted) {
            void deleteStoredDownload(id).catch(() => undefined)
          }
          revokeDownloadUrl(id)
          return
        }

        window.setTimeout(() => {
          if (downloadUrlsRef.current[id] === objectUrl) revokeDownloadUrl(id)
        }, 60_000)
        updateDownload(id, {
          status: 'completed',
          fileName: downloadName,
          saveHref: objectUrl,
          receivedBytes: blob.size,
          totalBytes: blob.size || resolvedTotalBytes || null,
          note: persistNote,
        })
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') {
          updateDownload(id, { status: 'cancelled', error: undefined, note: undefined })
          return
        }

        updateDownload(id, {
          status: 'error',
          error: error instanceof Error ? error.message : 'Download failed.',
          note: undefined,
        })
      } finally {
        inFlightTrackKeysRef.current.delete(trackKey)
        delete downloadAbortControllersRef.current[id]
        cancelledIdsRef.current.delete(id)
      }
    })()
  }, [isAppleMobileOrTablet, revokeDownloadUrl, updateDownload])

  const cancelDownload = useCallback((id: string) => {
    cancelledIdsRef.current.add(id)
    const controller = downloadAbortControllersRef.current[id]
    if (controller) {
      try { controller.abort() } catch {}
    }
    updateDownload(id, { status: 'cancelled' })
  }, [updateDownload])

  const saveDownloadAgain = useCallback((id: string) => {
    const download = downloads.find((entry) => entry.id === id)
    if (!download?.fileName) return

    const liveHref = download.saveHref || downloadUrlsRef.current[id]
    if (liveHref) {
      triggerBrowserDownload(liveHref, download.fileName)
      return
    }

    void getStoredDownloadBlob(id)
      .then((blob) => {
        if (!blob) return
        const objectUrl = window.URL.createObjectURL(blob)
        triggerBrowserDownload(objectUrl, download.fileName || 'download')
        window.setTimeout(() => {
          try { window.URL.revokeObjectURL(objectUrl) } catch {}
        }, 60_000)
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        addDevLog({ kind: 'error', category: 'downloads', message: `Failed to reopen stored download: ${message}` })
      })
  }, [downloads])

  const dismissDownload = useCallback((id: string) => {
    dismissedIdsRef.current.add(id)
    cancelledIdsRef.current.add(id)
    if (downloadAbortControllersRef.current[id]) {
      try { downloadAbortControllersRef.current[id].abort() } catch {}
    }
    revokeDownloadUrl(id)
    setDownloads((prev) => prev.filter((download) => download.id !== id))
    void deleteStoredDownload(id).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      addDevLog({ kind: 'error', category: 'downloads', message: `Failed to delete stored download: ${message}` })
    })
  }, [revokeDownloadUrl])

  const clearFinishedDownloads = useCallback(() => {
    setDownloads((prev) => {
      for (const download of prev) {
        if (download.status === 'downloading') continue
        dismissedIdsRef.current.add(download.id)
        cancelledIdsRef.current.add(download.id)
        revokeDownloadUrl(download.id)
      }

      return prev.filter((download) => download.status === 'downloading')
    })
    void clearStoredDownloads().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      addDevLog({ kind: 'error', category: 'downloads', message: `Failed to clear stored downloads: ${message}` })
    })
  }, [revokeDownloadUrl])

  return {
    downloads,
    activeDownloads,
    isTrackDownloading,
    queueDownload,
    cancelDownload,
    saveDownloadAgain,
    dismissDownload,
    clearFinishedDownloads,
  }
}
