export function extractNamespaceValue(tags: string[] | null | undefined, namespace: string): string | null {
  if (!tags || !Array.isArray(tags)) return null
  const prefix = `${namespace.toLowerCase()}:`
  let bestValue = ''

  for (const tag of tags) {
    if (typeof tag !== 'string') continue
    if (!tag.toLowerCase().startsWith(prefix)) continue

    const value = tag.slice(prefix.length).replace(/_/g, ' ').trim()
    if (value.length > bestValue.length) bestValue = value
  }

  return bestValue || null
}
