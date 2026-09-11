type PersistedDownloadRecord = {
  id: string
  trackKey: string
  title: string
  fileName?: string
  receivedBytes: number
  totalBytes: number | null
  note?: string
  blob?: Blob
  savedAt: number
}

type DownloadMetadataRecord = Omit<PersistedDownloadRecord, 'blob'>
type DownloadBlobRecord = { id: string; blob: Blob }

const DB_NAME = 'api-mediaplayer-downloads'
const DB_VERSION = 2
const META_STORE = 'downloads'
const BLOB_STORE = 'download-blobs'

let databasePromise: Promise<IDBDatabase> | null = null

function openDownloadsDatabase() {
  if (databasePromise) return databasePromise
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available'))
  }

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const database = request.result
      const transaction = request.transaction
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE, { keyPath: 'id' })
      }
      if (!database.objectStoreNames.contains(BLOB_STORE)) {
        database.createObjectStore(BLOB_STORE, { keyPath: 'id' })
      }
      if (!transaction) return

      const metaStore = transaction.objectStore(META_STORE)
      const blobStore = transaction.objectStore(BLOB_STORE)
      const cursorRequest = metaStore.openCursor()
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (!cursor) return
        const record = cursor.value as PersistedDownloadRecord
        if (record.blob) {
          blobStore.put({ id: record.id, blob: record.blob })
          const { blob: _blob, ...meta } = record
          cursor.update(meta)
        }
        cursor.continue()
      }
    }

    request.onsuccess = () => {
      const database = request.result
      database.onclose = () => { databasePromise = null }
      database.onversionchange = () => {
        database.close()
        databasePromise = null
      }
      resolve(database)
    }
    request.onerror = () => {
      databasePromise = null
      reject(request.error ?? new Error('Failed to open download database'))
    }
  })

  return databasePromise
}

function withDownloadsStore<T>(storeName: string, mode: IDBTransactionMode, handler: (store: IDBObjectStore) => IDBRequest<T>) {
  return openDownloadsDatabase().then((database) => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    const request = handler(store)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  }))
}

export async function listStoredDownloads(): Promise<DownloadMetadataRecord[]> {
  if (typeof indexedDB === 'undefined') return []
  const records = await withDownloadsStore<DownloadMetadataRecord[]>(META_STORE, 'readonly', (store) => store.getAll())
  return Array.isArray(records) ? [...records].sort((left, right) => right.savedAt - left.savedAt) : []
}

export async function getStoredDownloadBlob(id: string): Promise<Blob | null> {
  if (!id || typeof indexedDB === 'undefined') return null
  const record = await withDownloadsStore<DownloadBlobRecord | undefined>(BLOB_STORE, 'readonly', (store) => store.get(id))
  return record?.blob || null
}

export async function saveStoredDownload(record: PersistedDownloadRecord) {
  if (typeof indexedDB === 'undefined') return
  const { blob, ...meta } = record
  if (!blob) return
  const database = await openDownloadsDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([META_STORE, BLOB_STORE], 'readwrite')
    transaction.objectStore(META_STORE).put(meta)
    transaction.objectStore(BLOB_STORE).put({ id: record.id, blob })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to save download'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Download save aborted'))
  })
}

export async function deleteStoredDownload(id: string) {
  if (!id || typeof indexedDB === 'undefined') return
  const database = await openDownloadsDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([META_STORE, BLOB_STORE], 'readwrite')
    transaction.objectStore(META_STORE).delete(id)
    transaction.objectStore(BLOB_STORE).delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to delete download'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Download delete aborted'))
  })
}

export async function clearStoredDownloads() {
  if (typeof indexedDB === 'undefined') return
  const database = await openDownloadsDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([META_STORE, BLOB_STORE], 'readwrite')
    transaction.objectStore(META_STORE).clear()
    transaction.objectStore(BLOB_STORE).clear()
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to clear downloads'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Download clear aborted'))
  })
}

export type { PersistedDownloadRecord, DownloadMetadataRecord }
