#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, chmodSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const scriptDir = path.dirname(scriptPath)
const templateConfigPath = path.join(scriptDir, 'config.toml')
const bundledLinuxHandlerPath = path.join(scriptDir, 'linux-mpv-handler.py')
const bundledLinuxDesktopPath = path.join(scriptDir, 'linux-mpv-handler.desktop')
const bundledLinuxDebugDesktopPath = path.join(scriptDir, 'linux-mpv-handler-debug.desktop')
const UPSTREAM_MPV_HANDLER_REPO = 'https://github.com/akiirui/mpv-handler.git'
const UPSTREAM_MPV_HANDLER_REF = 'v0.4.2'

const usage = `Usage:
  npm run setup:mpv-handler
  npm run setup:mpv-handler -- --root /path/to/mpv-handler
  npm run setup:mpv-handler -- --mpv /path/to/mpv --ytdl /path/to/yt-dlp

Options:
  --root <path>       Path to the extracted mpv-handler folder.
  --mpv <path>        Override the mpv executable path written to config.toml.
  --ytdl <path>       Override the yt-dlp executable path written to config.toml.
  --skip-source-build Linux only. Do not auto-build mpv-handler from source on non-x64 systems.
  --skip-config       Do not create or update config.toml.
  --keep-existing     Windows only. Keep existing protocol keys instead of replacing them.
  --dry-run           Print the actions without changing files or running installers.
  --help              Show this help text.
`

function fail(message) {
  console.error(`Error: ${message}`)
  process.exit(1)
}

function parseArgs(argv) {
  const options = {
    root: '',
    mpv: '',
    ytdl: '',
    skipSourceBuild: false,
    skipConfig: false,
    keepExisting: false,
    dryRun: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]

    if (value === '--help' || value === '-h') {
      options.help = true
      continue
    }

    if (value === '--skip-config') {
      options.skipConfig = true
      continue
    }

    if (value === '--skip-source-build') {
      options.skipSourceBuild = true
      continue
    }

    if (value === '--keep-existing') {
      options.keepExisting = true
      continue
    }

    if (value === '--dry-run') {
      options.dryRun = true
      continue
    }

    if (value === '--root' || value === '--mpv' || value === '--ytdl') {
      const nextValue = argv[index + 1]
      if (!nextValue || nextValue.startsWith('--')) {
        fail(`Missing value for ${value}`)
      }

      if (value === '--root') options.root = nextValue
      if (value === '--mpv') options.mpv = nextValue
      if (value === '--ytdl') options.ytdl = nextValue
      index += 1
      continue
    }

    fail(`Unknown argument: ${value}`)
  }

  return options
}

function escapeTomlString(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function upsertTomlValue(content, key, value) {
  const line = `${key} = "${escapeTomlString(value)}"`
  const pattern = new RegExp(`^\\s*#?\\s*${key}\\s*=.*$`, 'm')
  if (pattern.test(content)) {
    return content.replace(pattern, line)
  }

  const trimmed = content.trimEnd()
  return trimmed ? `${trimmed}\n${line}\n` : `${line}\n`
}

function resolveOnPath(commandNames) {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which'

  for (const commandName of commandNames) {
    const result = spawnSync(locator, [commandName], { encoding: 'utf8' })
    if (result.status !== 0) continue

    const match = result.stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find((entry) => entry)

    if (match && existsSync(match)) {
      return match
    }
  }

  return ''
}

function isFile(candidatePath) {
  try {
    return statSync(candidatePath).isFile()
  } catch {
    return false
  }
}

function looksLikeRoot(rootPath) {
  const requiredFiles = process.platform === 'win32'
    ? ['mpv-handler.exe', 'mpv-handler-debug.exe']
    : process.platform === 'linux'
      ? ['mpv-handler', 'mpv-handler.desktop', 'mpv-handler-debug.desktop']
      : ['mpv-handler']

  return requiredFiles.every((fileName) => isFile(path.join(rootPath, fileName)))
}

function findRoot(options) {
  const candidates = []
  if (options.root) candidates.push(path.resolve(options.root))
  candidates.push(scriptDir)
  candidates.push(process.cwd())

  const seen = new Set()
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    if (looksLikeRoot(candidate)) {
      return candidate
    }
  }

  return ''
}

function getLinuxCacheDir() {
  const xdgCacheHome = process.env.XDG_CACHE_HOME?.trim()
  return xdgCacheHome
    ? path.join(xdgCacheHome, 'api-mediaplayer')
    : path.join(os.homedir(), '.cache', 'api-mediaplayer')
}

function runCommandOrFail(command, args, options) {
  const result = spawnSync(command, args, options)
  if (result.status === 0) return result

  const reason = result.error?.message || `exit code ${result.status ?? 'unknown'}`
  fail(`${command} failed (${reason}).`)
}

function prepareLinuxSourceBuildRoot(options) {
  const gitPath = resolveOnPath(['git'])
  const cargoPath = resolveOnPath(['cargo'])

  if (!gitPath || !cargoPath) {
    fail(`Could not find a Linux mpv-handler release for ${process.arch}, and automatic source build requires both git and cargo on PATH. Install them or rerun with --root pointing at a compatible extracted mpv-handler folder.`)
  }

  const cacheDir = getLinuxCacheDir()
  const sourceDir = path.join(cacheDir, `mpv-handler-src-${UPSTREAM_MPV_HANDLER_REF}`)
  const stageDir = path.join(cacheDir, `mpv-handler-linux-${process.arch}`)

  if (options.dryRun) {
    console.log(`Dry run: would clone ${UPSTREAM_MPV_HANDLER_REPO} at ${UPSTREAM_MPV_HANDLER_REF} into ${sourceDir}`)
    console.log(`Dry run: would build mpv-handler with cargo in ${sourceDir}`)
    console.log(`Dry run: would stage Linux assets into ${stageDir}`)
    return stageDir
  }

  mkdirSync(cacheDir, { recursive: true })

  if (!existsSync(sourceDir)) {
    runCommandOrFail(gitPath, ['clone', '--depth', '1', '--branch', UPSTREAM_MPV_HANDLER_REF, UPSTREAM_MPV_HANDLER_REPO, sourceDir], { stdio: 'inherit' })
  }

  runCommandOrFail(cargoPath, ['build', '--release'], { cwd: sourceDir, stdio: 'inherit' })

  mkdirSync(stageDir, { recursive: true })

  copyFileSync(path.join(sourceDir, 'target', 'release', 'mpv-handler'), path.join(stageDir, 'mpv-handler'))
  copyFileSync(path.join(sourceDir, 'share', 'linux', 'mpv-handler.desktop'), path.join(stageDir, 'mpv-handler.desktop'))
  copyFileSync(path.join(sourceDir, 'share', 'linux', 'mpv-handler-debug.desktop'), path.join(stageDir, 'mpv-handler-debug.desktop'))
  copyFileSync(path.join(sourceDir, 'share', 'linux', 'config.toml'), path.join(stageDir, 'config.toml'))
  chmodSync(path.join(stageDir, 'mpv-handler'), 0o755)

  return stageDir
}

function prepareBundledLinuxHandlerRoot(options) {
  const cacheDir = getLinuxCacheDir()
  const stageDir = path.join(cacheDir, 'linux-bundled-handler')

  if (options.dryRun) {
    console.log(`Dry run: would stage bundled Linux handler into ${stageDir}`)
    return stageDir
  }

  mkdirSync(cacheDir, { recursive: true })
  mkdirSync(stageDir, { recursive: true })

  copyFileSync(bundledLinuxHandlerPath, path.join(stageDir, 'mpv-handler'))
  copyFileSync(bundledLinuxDesktopPath, path.join(stageDir, 'mpv-handler.desktop'))
  copyFileSync(bundledLinuxDebugDesktopPath, path.join(stageDir, 'mpv-handler-debug.desktop'))
  copyFileSync(templateConfigPath, path.join(stageDir, 'config.toml'))
  chmodSync(path.join(stageDir, 'mpv-handler'), 0o755)

  return stageDir
}

function resolveRoot(options) {
  const resolvedRoot = findRoot(options)
  if (resolvedRoot) return resolvedRoot

  if (process.platform === 'win32') {
    fail('Could not find mpv-handler files. Re-run with --root pointing at the extracted mpv-handler folder.')
  }

  if (process.platform === 'linux') {
    if (process.arch !== 'x64') {
      if (!options.skipSourceBuild) {
        const gitPath = resolveOnPath(['git'])
        const cargoPath = resolveOnPath(['cargo'])
        if (gitPath && cargoPath) {
          return prepareLinuxSourceBuildRoot(options)
        }
      }

      return prepareBundledLinuxHandlerRoot(options)
    }

    const archHint = process.arch === 'x64'
      ? 'Download and extract the upstream archive, then pass --root /path/to/extracted/mpv-handler-linux-amd64.'
      : `The upstream project only publishes an official linux-amd64 archive. Install git and cargo to allow automatic source builds, use the bundled fallback handler, or build/obtain a compatible mpv-handler binary and pass --root /path/to/extracted/mpv-handler.`
    fail(`Could not find a Linux mpv-handler release. ${archHint}`)
  }

  fail('Automatic setup is not available for this platform yet.')
}

function getLinuxConfigDir() {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim()
  return xdgConfigHome
    ? path.join(xdgConfigHome, 'mpv-handler')
    : path.join(os.homedir(), '.config', 'mpv-handler')
}

function getConfigPath(rootPath) {
  if (process.platform === 'linux') {
    return path.join(getLinuxConfigDir(), 'config.toml')
  }

  return path.join(rootPath, 'config.toml')
}

function ensureConfig(rootPath, options) {
  const configPath = getConfigPath(rootPath)
  if (options.skipConfig) {
    return { configPath, changed: false, mpvPath: '', ytdlPath: '' }
  }

  const configExists = existsSync(configPath)
  const bundledConfigPath = path.join(rootPath, 'config.toml')
  const content = configExists
    ? readFileSync(configPath, 'utf8')
    : existsSync(bundledConfigPath)
      ? readFileSync(bundledConfigPath, 'utf8')
      : readFileSync(templateConfigPath, 'utf8')

  const detectedMpv = options.mpv || resolveOnPath(process.platform === 'win32' ? ['mpv.com', 'mpv.exe', 'mpv'] : ['mpv'])
  const detectedYtdl = options.ytdl || resolveOnPath(process.platform === 'win32' ? ['yt-dlp.exe', 'yt-dlp'] : ['yt-dlp'])

  let changed = !configExists
  let nextContent = content

  if (detectedMpv) {
    const updated = upsertTomlValue(nextContent, 'mpv', detectedMpv)
    changed ||= updated !== nextContent
    nextContent = updated
  }

  if (detectedYtdl) {
    const updated = upsertTomlValue(nextContent, 'ytdl', detectedYtdl)
    changed ||= updated !== nextContent
    nextContent = updated
  }

  if (changed && !options.dryRun) {
    mkdirSync(path.dirname(configPath), { recursive: true })
    writeFileSync(configPath, nextContent, 'utf8')
  }

  return {
    configPath,
    changed,
    mpvPath: detectedMpv,
    ytdlPath: detectedYtdl,
  }
}

function runWindowsSetup(rootPath, options) {
  const powershell = resolveOnPath(['powershell.exe', 'pwsh.exe']) || 'powershell.exe'
  const installScript = path.join(scriptDir, 'install-mpv-handler.ps1')
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installScript, '-InstallRoot', rootPath]

  if (options.keepExisting) {
    args.push('-KeepExistingProtocolKeys')
  }

  if (options.dryRun) {
    console.log('Dry run: would execute Windows installer')
    console.log(`${powershell} ${args.map((value) => JSON.stringify(value)).join(' ')}`)
    return
  }

  const result = spawnSync(powershell, args, { stdio: 'inherit' })
  if (result.status !== 0) {
    fail('Windows protocol registration failed. Re-run the command from an elevated PowerShell or Windows Terminal.')
  }
}

function rewriteDesktopExec(content, targetBinary) {
  return content.replace(/^Exec=.*$/m, (line) => {
    const prefix = 'Exec='
    const rest = line.slice(prefix.length).trim()
    const firstSpaceIndex = rest.indexOf(' ')
    const suffix = firstSpaceIndex === -1 ? '' : rest.slice(firstSpaceIndex)
    return `${prefix}${targetBinary}${suffix}`
  })
}

function runLinuxSetup(rootPath, options) {
  const localBin = path.join(os.homedir(), '.local', 'bin')
  const applicationsDir = path.join(os.homedir(), '.local', 'share', 'applications')
  const targetBinary = path.join(localBin, 'mpv-handler')
  const copies = [
    {
      source: path.join(rootPath, 'mpv-handler'),
      target: targetBinary,
      executable: true,
    },
    {
      source: path.join(rootPath, 'mpv-handler.desktop'),
      target: path.join(applicationsDir, 'mpv-handler.desktop'),
      patchExec: true,
    },
    {
      source: path.join(rootPath, 'mpv-handler-debug.desktop'),
      target: path.join(applicationsDir, 'mpv-handler-debug.desktop'),
      patchExec: true,
    },
  ]

  if (options.dryRun) {
    console.log('Dry run: would install Linux desktop files to ~/.local')
    for (const item of copies) {
      console.log(`copy ${item.source} -> ${item.target}`)
    }
    console.log('xdg-mime default mpv-handler.desktop x-scheme-handler/mpv-handler')
    console.log('xdg-mime default mpv-handler-debug.desktop x-scheme-handler/mpv-handler-debug')
    return
  }

  mkdirSync(localBin, { recursive: true })
  mkdirSync(applicationsDir, { recursive: true })

  for (const item of copies) {
    if (item.patchExec) {
      const content = readFileSync(item.source, 'utf8')
      writeFileSync(item.target, rewriteDesktopExec(content, targetBinary), 'utf8')
      continue
    }

    copyFileSync(item.source, item.target)
    if (item.executable) {
      chmodSync(item.target, 0o755)
    }
  }

  for (const args of [
    ['default', 'mpv-handler.desktop', 'x-scheme-handler/mpv-handler'],
    ['default', 'mpv-handler-debug.desktop', 'x-scheme-handler/mpv-handler-debug'],
  ]) {
    const result = spawnSync('xdg-mime', args, { stdio: 'inherit' })
    if (result.status !== 0) {
      fail(`xdg-mime failed for ${args[2]}. Run the command manually after fixing your desktop environment registration.`)
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.help) {
    console.log(usage)
    return
  }

  if (!['win32', 'linux', 'darwin'].includes(process.platform)) {
    fail(`Unsupported platform: ${process.platform}`)
  }

  if (process.platform === 'darwin') {
    console.log('Automatic macOS protocol registration is not available in this repo yet.')
    console.log('The app can still browse media on macOS, but desktop playback setup must be handled manually.')
    return
  }

  const rootPath = resolveRoot(options)
  const configResult = ensureConfig(rootPath, options)

  console.log(`Platform: ${process.platform}`)
  console.log(`mpv-handler root: ${rootPath}`)
  console.log(`config.toml: ${configResult.configPath}${configResult.changed ? ' (updated)' : ' (unchanged)'}`)
  console.log(`mpv: ${configResult.mpvPath || 'not detected'}`)
  console.log(`yt-dlp: ${configResult.ytdlPath || 'not detected'}`)

  if (process.platform === 'win32') {
    runWindowsSetup(rootPath, options)
  } else if (process.platform === 'linux') {
    runLinuxSetup(rootPath, options)
  }

  console.log('mpv-handler setup complete.')
}

main()