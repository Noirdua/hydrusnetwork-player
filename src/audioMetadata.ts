import type { FFmpeg } from '@ffmpeg/ffmpeg'

type AudioTagMetadata = {
  title?: string
  artist?: string
  album?: string
  trackNumber?: string
}

const AUDIO_METADATA_EXTENSIONS = new Set([
  'flac',
  'm4a',
  'aac',
  'ogg',
  'opus',
  'oga',
  'wav',
  'aiff',
  'aif',
  'ape',
  'wv',
])

let ffmpegInstance: FFmpeg | null = null
let ffmpegLoadPromise: Promise<FFmpeg> | null = null
let ffmpegOperationPromise: Promise<void> = Promise.resolve()
let ffmpegTempFileCounter = 0

function sanitizeExtension(extension?: string | null) {
  return (extension || '').trim().replace(/^\./, '').toLowerCase()
}

async function getFFmpeg() {
  if (ffmpegInstance?.loaded) return ffmpegInstance
  if (ffmpegLoadPromise) return ffmpegLoadPromise

  ffmpegLoadPromise = (async () => {
    const [{ FFmpeg }, ffmpegCoreUrl, ffmpegWasmUrl, ffmpegWorkerUrl] = await Promise.all([
      import('@ffmpeg/ffmpeg'),
      import('@ffmpeg/core?url').then((mod) => mod.default),
      import('@ffmpeg/core/wasm?url').then((mod) => mod.default),
      import('@ffmpeg/ffmpeg/worker?url').then((mod) => mod.default),
    ])
    const ffmpeg = new FFmpeg()
    await ffmpeg.load({
      classWorkerURL: ffmpegWorkerUrl,
      coreURL: ffmpegCoreUrl,
      wasmURL: ffmpegWasmUrl,
    })
    ffmpegInstance = ffmpeg
    return ffmpeg
  })()

  try {
    return await ffmpegLoadPromise
  } finally {
    ffmpegLoadPromise = null
  }
}

function createTempFileStem() {
  ffmpegTempFileCounter += 1
  return `metadata-${Date.now()}-${ffmpegTempFileCounter}`
}

function queueFFmpegOperation<T>(operation: () => Promise<T>) {
  const pending = ffmpegOperationPromise.then(operation, operation)
  ffmpegOperationPromise = pending.then(() => undefined, () => undefined)
  return pending
}

function buildMetadataArgs(metadata: AudioTagMetadata) {
  const args: string[] = []
  if (metadata.title) args.push('-metadata', `title=${metadata.title}`)
  if (metadata.artist) args.push('-metadata', `artist=${metadata.artist}`)
  if (metadata.album) args.push('-metadata', `album=${metadata.album}`)
  if (metadata.trackNumber) args.push('-metadata', `track=${metadata.trackNumber}`)
  return args
}

export function supportsContainerMetadataEmbedding(extension?: string | null, mimeType?: string | null) {
  const normalizedExtension = sanitizeExtension(extension)
  if (normalizedExtension && AUDIO_METADATA_EXTENSIONS.has(normalizedExtension)) return true

  const normalizedMimeType = (mimeType || '').trim().toLowerCase()
  return normalizedMimeType.startsWith('audio/') && !normalizedMimeType.includes('mpeg') && !normalizedMimeType.includes('mp3')
}

export async function embedContainerAudioMetadata(blob: Blob, extension: string | undefined, metadata: AudioTagMetadata) {
  if (!metadata.title && !metadata.artist && !metadata.album && !metadata.trackNumber) return blob

  return queueFFmpegOperation(async () => {
    const normalizedExtension = sanitizeExtension(extension) || 'audio'
    const ffmpeg = await getFFmpeg()
    const { fetchFile } = await import('@ffmpeg/util')
    const tempStem = createTempFileStem()
    const inputPath = `${tempStem}-input.${normalizedExtension}`
    const outputPath = `${tempStem}-output.${normalizedExtension}`

    await ffmpeg.writeFile(inputPath, await fetchFile(blob))

    try {
      const exitCode = await ffmpeg.exec([
        '-nostdin',
        '-y',
        '-i', inputPath,
        '-map', '0',
        '-map_metadata', '0',
        '-c', 'copy',
        ...buildMetadataArgs(metadata),
        outputPath,
      ])

      if (exitCode !== 0) {
        throw new Error(`FFmpeg metadata update failed (${exitCode})`)
      }

      const outputData = await ffmpeg.readFile(outputPath)
      if (!(outputData instanceof Uint8Array)) return blob
      const outputCopy = new Uint8Array(outputData.byteLength)
      outputCopy.set(outputData)
      return new Blob([outputCopy], { type: blob.type || 'application/octet-stream' })
    } finally {
      try { await ffmpeg.deleteFile(inputPath) } catch {}
      try { await ffmpeg.deleteFile(outputPath) } catch {}
    }
  })
}

export type { AudioTagMetadata }