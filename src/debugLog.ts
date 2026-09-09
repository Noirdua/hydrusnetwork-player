import { makeId } from './api/hydrusClient'

export type DevLogItem = {
  id: string
  time: number
  kind: 'debug' | 'error' | 'unhandledrejection'
  category?: string
  message: string
  stack?: string
  source?: string
  details?: string
}

const MAX_LOGS = 200
let logs: DevLogItem[] = []
const listeners = new Set<(items: DevLogItem[]) => void>()

function notify() {
  for (const listener of listeners) listener(logs)
}

function stringifyDetails(details: unknown) {
  if (details == null) return undefined
  if (typeof details === 'string') return details

  try {
    return JSON.stringify(details, null, 2)
  } catch {
    return String(details)
  }
}

export function addDevLog(entry: Omit<DevLogItem, 'id' | 'time' | 'details'> & { details?: unknown }) {
  if (!import.meta.env.DEV) return

  const item: DevLogItem = {
    id: makeId(),
    time: Date.now(),
    ...entry,
    details: stringifyDetails(entry.details),
  }

  logs = [item, ...logs].slice(0, MAX_LOGS)
  notify()
}

export function clearDevLogs() {
  logs = []
  notify()
}

export function getDevLogs() {
  return logs
}

export function subscribeDevLogs(listener: (items: DevLogItem[]) => void) {
  listener(logs)
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}