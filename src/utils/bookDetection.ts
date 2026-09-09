const BOOK_MIME_TOKENS = [
  'pdf',
  'epub',
  'mobi',
  'azw',
  'djvu',
  'comicbook',
  'fictionbook',
  'amazon',
  'kindle',
  'cbr',
  'cbz',
]

export function isBookMimeType(mimeType?: string | null): boolean {
  const mime = (mimeType || '').toLowerCase()
  if (!mime) return false
  return BOOK_MIME_TOKENS.some((token) => mime.includes(token))
}
