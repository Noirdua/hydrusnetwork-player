import { withStore } from './utils/indexedDb'

type PersistedDownloadRecord = {
  id: string
  trackKey: string
  title: string
  fileName?: string
  receivedBytes: number
  totalBytes: number | null
  note?: string
  blob: Blob
  savedAt: number
}

const DB_CONFIG = {
  name: 'api-mediaplayer-downloads',
  version: 1,
  storeName: 'downloads',
  keyPath: 'id',
}

export async function listStoredDownloads(): Promise<PersistedDownloadRecord[]> {
  if (typeof indexedDB === 'undefined') return []
  const records = await withStore<PersistedDownloadRecord[]>(DB_CONFIG, 'readonly', (store) => store.getAll())
  return Array.isArray(records) ? [...records].sort((left, right) => right.savedAt - left.savedAt) : []
}

export async function saveStoredDownload(record: PersistedDownloadRecord) {
  if (typeof indexedDB === 'undefined') return
  await withStore(DB_CONFIG, 'readwrite', (store) => store.put(record))
}

export async function deleteStoredDownload(id: string) {
  if (!id || typeof indexedDB === 'undefined') return
  await withStore(DB_CONFIG, 'readwrite', (store) => store.delete(id))
}

export async function clearStoredDownloads() {
  if (typeof indexedDB === 'undefined') return
  await withStore(DB_CONFIG, 'readwrite', (store) => store.clear())
}

export type { PersistedDownloadRecord }