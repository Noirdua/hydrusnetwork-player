import type { MediaSection, Track } from '../../types'
import { getTrackDisplayTitle, getTrackExtension, matchesMediaSection } from './libraryHelpers'

export const LOCAL_SEARCH_TOKEN_PATTERN = /(?:[^\s"]+:"(?:[^"\\]|\\.)*"|"(?:[^"\\]|\\.)*"|\S+)/g
export const SEARCH_NAMESPACE_PATTERN = /^([a-z0-9_+-]+):(.*)$/i

export function normalizeSearchText(value?: string | null) {
  return (value || '').replace(/_/g, ' ').trim().toLocaleLowerCase()
}

export function normalizeSearchTerm(value: string) {
  let normalized = value.trim()
  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    normalized = normalized.slice(1, -1)
  }

  normalized = normalized
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/^\*+|\*+$/g, '')

  return normalizeSearchText(normalized)
}

export function normalizeSearchPattern(value: string) {
  let normalized = value.trim()
  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    normalized = normalized.slice(1, -1)
  }

  normalized = normalized
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')

  return normalizeSearchText(normalized)
}

export function matchesSearchValue(value: string | undefined | null, term: string) {
  if (!term) return true
  return normalizeSearchText(value).includes(term)
}

export function matchesPatternSearchValue(value: string | undefined | null, pattern: string) {
  if (!pattern) return true

  const normalizedValue = normalizeSearchText(value)
  if (!pattern.includes('*')) return normalizedValue.includes(pattern)

  const escapedPattern = pattern.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escapedPattern}$`, 'i').test(normalizedValue)
}

export function matchesNamespacedTag(tags: string[] | undefined, namespace: string, term: string, exact = false) {
  if (!tags || tags.length === 0) return false

  const prefix = `${namespace.toLowerCase()}:`
  return tags.some((tag) => {
    if (typeof tag !== 'string') return false
    if (!tag.toLowerCase().startsWith(prefix)) return false
    return exact
      ? matchesPatternSearchValue(tag.slice(prefix.length), term)
      : matchesSearchValue(tag.slice(prefix.length), term)
  })
}

export function splitSearchClauses(rawQuery: string) {
  const clauses: string[] = []
  let current = ''
  let inQuotes = false
  let escapeNext = false

  for (const char of rawQuery) {
    if (escapeNext) {
      current += char
      escapeNext = false
      continue
    }

    if (char === '\\') {
      current += char
      escapeNext = true
      continue
    }

    if (char === '"') {
      inQuotes = !inQuotes
      current += char
      continue
    }

    if (char === ',' && !inQuotes) {
      const trimmed = current.trim()
      if (trimmed) clauses.push(trimmed)
      current = ''
      continue
    }

    current += char
  }

  const trimmed = current.trim()
  if (trimmed) clauses.push(trimmed)
  return clauses
}

export function matchesSystemPredicate(track: Track, rawValue: string, section: MediaSection) {
  const normalized = normalizeSearchText(rawValue).replace(/^system:/, '')
  if (!normalized || normalized === 'everything') return true

  const fileTypeMatch = normalized.match(/^filetype\s*=\s*(audio|video|image|application)$/)
  if (fileTypeMatch) {
    return matchesMediaSection(track, fileTypeMatch[1] as MediaSection)
  }

  return true
}

export function matchesNamespacedClause(track: Track, namespace: string, rawValue: string, section: MediaSection) {
  const term = normalizeSearchPattern(rawValue)
  if (!term) return true

  if (namespace === 'system') return matchesSystemPredicate(track, `${namespace}:${rawValue}`, section)
  if (namespace === 'title') return matchesPatternSearchValue(getTrackDisplayTitle(track), term)
  if (namespace === 'artist' || namespace === 'author' || namespace === 'creator') {
    return matchesPatternSearchValue(track.artist, term)
      || matchesNamespacedTag(track.tags, namespace, term, true)
      || matchesNamespacedTag(track.tags, 'artist', term, true)
      || matchesNamespacedTag(track.tags, 'author', term, true)
      || matchesNamespacedTag(track.tags, 'creator', term, true)
  }
  if (namespace === 'album' || namespace === 'series' || namespace === 'collection') {
    return matchesPatternSearchValue(track.album, term)
      || matchesNamespacedTag(track.tags, namespace, term, true)
      || matchesNamespacedTag(track.tags, 'album', term, true)
      || matchesNamespacedTag(track.tags, 'series', term, true)
      || matchesNamespacedTag(track.tags, 'collection', term, true)
  }
  if (namespace === 'ext') return matchesPatternSearchValue(getTrackExtension(track), term.replace(/^\./, ''))

  return matchesNamespacedTag(track.tags, namespace, term, true)
}

export function matchesGenericClause(track: Track, clause: string, section: MediaSection) {
  const tokens = clause.match(LOCAL_SEARCH_TOKEN_PATTERN)?.filter(Boolean) ?? []
  if (tokens.length === 0) return true

  return tokens.every((token) => {
    const namespaceMatch = token.match(SEARCH_NAMESPACE_PATTERN)
    if (namespaceMatch) {
      return matchesNamespacedClause(track, namespaceMatch[1].toLowerCase(), namespaceMatch[2], section)
    }

    const term = normalizeSearchTerm(token)
    if (!term) return true

    const searchableValues = [
      getTrackDisplayTitle(track),
      track.artist,
      track.album,
      track.serverName,
      getTrackExtension(track),
      ...(track.tags || []),
    ]

    return searchableValues.some((value) => matchesSearchValue(value, term))
  })
}

export function matchesTrackSearch(track: Track, rawQuery: string, section: MediaSection) {
  const trimmedQuery = rawQuery.trim()
  if (!trimmedQuery) return true

  const clauses = splitSearchClauses(trimmedQuery)
  if (clauses.length === 0) return true

  return clauses.every((clause) => {
    const namespaceMatch = clause.match(SEARCH_NAMESPACE_PATTERN)
    if (namespaceMatch) {
      const namespace = namespaceMatch[1].toLowerCase()
      const rawValue = namespaceMatch[2]
      return matchesNamespacedClause(track, namespace, rawValue, section)
    }

    return matchesGenericClause(track, clause, section)
  })
}

export function formatNamespacedSearchValue(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const escaped = trimmed
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')

  return /[,"]/.test(trimmed) ? `"${escaped}"` : escaped
}

export function getNamespacedQueryValue(rawQuery: string, namespace: string) {
  const clauses = splitSearchClauses(rawQuery)

  for (let index = clauses.length - 1; index >= 0; index -= 1) {
    const namespaceMatch = clauses[index].match(SEARCH_NAMESPACE_PATTERN)
    if (!namespaceMatch) continue
    if (namespaceMatch[1].toLowerCase() !== namespace) continue

    const normalized = normalizeSearchPattern(namespaceMatch[2])
    return normalized || null
  }

  return null
}

export function applyLibraryQueryFilters(query: string, updates: Record<string, string | null | undefined>) {
  const clauses = splitSearchClauses(query)
  const targetNamespaces = new Set(Object.keys(updates).map((namespace) => namespace.toLowerCase()))
  const retainedClauses = clauses.filter((clause) => {
    const namespaceMatch = clause.match(SEARCH_NAMESPACE_PATTERN)
    if (!namespaceMatch) return true

    const clauseNamespace = namespaceMatch[1].toLowerCase()
    return !targetNamespaces.has(clauseNamespace)
  })

  const nextClauses = [...retainedClauses]

  for (const [namespace, value] of Object.entries(updates)) {
    const trimmed = value?.trim()
    if (!trimmed) continue
    nextClauses.push(`${namespace}:${formatNamespacedSearchValue(trimmed)}`)
  }

  return nextClauses.join(', ')
}
