type DatabaseConfig = {
  name: string
  version: number
  storeName: string
  keyPath: string
}

const databaseCache = new Map<string, Promise<IDBDatabase>>()

function openDatabase(config: DatabaseConfig) {
  const cacheKey = `${config.name}:${config.version}`
  const cached = databaseCache.get(cacheKey)
  if (cached) return cached

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(config.name, config.version)

    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(config.storeName)) {
        database.createObjectStore(config.storeName, { keyPath: config.keyPath })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => {
      databaseCache.delete(cacheKey)
      reject(request.error ?? new Error(`Failed to open database: ${config.name}`))
    }
  })

  databaseCache.set(cacheKey, opening)
  return opening
}

export function withStore<T>(
  config: DatabaseConfig,
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return new Promise<T>((resolve, reject) => {
    openDatabase(config)
      .then((database) => {
        const transaction = database.transaction(config.storeName, mode)
        const store = transaction.objectStore(config.storeName)
        const request = handler(store)

        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
      })
      .catch(reject)
  })
}
