import type { MediaSection } from '../../types'

export type LibraryView = 'tracks' | 'albums' | 'artists' | 'text' | 'data'
export type LibraryLayoutId = 'grid' | 'table' | 'nested-catalog'

export const SECTION_CONFIG: Record<MediaSection, { label: string; systemPredicate?: string; views: Array<{ id: LibraryView; label: string; layout?: LibraryLayoutId }> }> = {
  all: {
    label: 'All Files',
    views: [
      { id: 'tracks', label: 'All Files' },
    ],
  },
  audio: {
    label: 'Audio',
    systemPredicate: 'system:filetype = audio',
    views: [
      { id: 'tracks', label: 'Tracks', layout: 'nested-catalog' },
      { id: 'albums', label: 'Albums' },
      { id: 'artists', label: 'Artists' },
    ],
  },
  video: {
    label: 'Video',
    systemPredicate: 'system:filetype = video',
    views: [
      { id: 'artists', label: 'Series' },
      { id: 'albums', label: 'Season' },
      { id: 'tracks', label: 'Episode', layout: 'nested-catalog' },
    ],
  },
  image: {
    label: 'Image',
    systemPredicate: 'system:filetype = image',
    views: [
      { id: 'tracks', label: 'Images' },
      { id: 'albums', label: 'Albums' },
    ],
  },
  application: {
    label: 'Applications',
    systemPredicate: 'system:filetype = application',
    views: [
      { id: 'tracks', label: 'Applications' },
      { id: 'text', label: 'Text' },
      { id: 'data', label: 'Data' },
    ],
  },
  books: {
    label: 'Books',
    views: [
      { id: 'tracks', label: 'Title' },
      { id: 'albums', label: 'Series' },
      { id: 'artists', label: 'Author' },
    ],
  },
}
