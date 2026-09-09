import type { MediaSection, Track } from '../../types'
import type { DisplayMode, LibraryLayoutId, LibraryView } from './libraryHelpers'

export type NestedCatalogGroup = {
  name: string
  tracks: Track[]
  subgroups: { name: string; tracks: Track[] }[]
}

export const LIBRARY_LAYOUT_OPTIONS: Array<{ id: LibraryLayoutId; label: string; description: string }> = [
  { id: 'grid', label: 'Grid', description: 'Poster cards in a wrap grid.' },
  { id: 'table', label: 'Table', description: 'Compact rows with sortable columns.' },
  { id: 'nested-catalog', label: 'Nested catalog', description: 'Group boxes, then subgroups, then items.' },
]

export function viewLayoutKey(section: MediaSection, view: LibraryView) {
  return `${section}:${view}`
}

export function resolveViewLayout(
  configuredLayout: LibraryLayoutId | undefined,
  overrideLayout: LibraryLayoutId | undefined,
  displayMode: DisplayMode,
): LibraryLayoutId {
  if (overrideLayout) return overrideLayout
  if (configuredLayout) return configuredLayout
  return displayMode === 'table' ? 'table' : 'grid'
}

export function buildNestedCatalog(
  tracks: Track[],
  getGroupName: (track: Track) => string | null | undefined,
  getSubgroupName: (track: Track) => string | null | undefined,
  fallbackGroup = 'Unknown',
  fallbackSubgroup = 'Episodes',
): NestedCatalogGroup[] {
  const groups = new Map<string, Map<string, Track[]>>()

  for (const track of tracks) {
    const groupName = getGroupName(track)?.trim() || fallbackGroup
    const subgroupName = getSubgroupName(track)?.trim() || fallbackSubgroup
    if (!groups.has(groupName)) groups.set(groupName, new Map())
    const subgroups = groups.get(groupName)!
    if (!subgroups.has(subgroupName)) subgroups.set(subgroupName, [])
    subgroups.get(subgroupName)!.push(track)
  }

  return Array.from(groups.entries()).map(([name, subgroups]) => {
    const nested = Array.from(subgroups.entries()).map(([subgroupName, subgroupTracks]) => ({
      name: subgroupName,
      tracks: subgroupTracks,
    }))
    return {
      name,
      subgroups: nested,
      tracks: nested.flatMap((subgroup) => subgroup.tracks),
    }
  })
}

export function sliceNestedCatalog(groups: NestedCatalogGroup[], limit: number) {
  let remaining = limit
  const sliced: NestedCatalogGroup[] = []

  for (const group of groups) {
    if (remaining <= 0) break
    const subgroups: NestedCatalogGroup['subgroups'] = []
    for (const subgroup of group.subgroups) {
      if (remaining <= 0) break
      const tracks = subgroup.tracks.slice(0, remaining)
      remaining -= tracks.length
      if (tracks.length) subgroups.push({ name: subgroup.name, tracks })
    }
    if (subgroups.length) {
      sliced.push({
        name: group.name,
        subgroups,
        tracks: subgroups.flatMap((subgroup) => subgroup.tracks),
      })
    }
  }

  return sliced
}
