# mpv-handler setup

This folder contains the desktop playback helper assets used by API Media Player.

## What is in this folder

- `setup-mpv-handler.mjs`: cross-platform helper used by `npm run setup:mpv-handler`
- `install-mpv-handler.ps1`: Windows protocol registration script
- `uninstall-mpv-handler.ps1`: Windows protocol cleanup script
- `handler-install.bat` and `handler-uninstall.bat`: thin Windows wrappers for the PowerShell scripts
- `config.toml`: template used when the helper needs to create or refresh an `mpv-handler` config
- `mpv-handler.exe` and `mpv-handler-debug.exe`: bundled Windows handler binaries

## Recommended commands

### Windows

Run from an elevated PowerShell or Windows Terminal:

```bash
npm run setup:mpv-handler
```

Remove the registration later with:

```bash
npm run uninstall:mpv-handler
```

### Linux

1. Download and extract the upstream Linux release:

```text
https://github.com/akiirui/mpv-handler/releases/latest/download/mpv-handler-linux-amd64.zip
```

The official upstream Linux release is currently `amd64` only. On Raspberry Pi or other ARM Linux systems, `npm run setup:mpv-handler` now tries to build a compatible `mpv-handler` binary automatically from upstream source if both `git` and Rust `cargo` are installed. If they are not available, the helper falls back to a bundled Python-based handler that supports this app's `mpv-handler://play/...` URLs without Rust.

2. Point the helper at that extracted folder:

```bash
npm run setup:mpv-handler -- --root /path/to/extracted/mpv-handler-linux-amd64
```

Run this on the Linux desktop client that should handle `mpv-handler://`, not on the machine that is only serving the web app.

The helper copies files into `~/.local/bin` and `~/.local/share/applications`, writes config to `~/.config/mpv-handler/config.toml` (or `$XDG_CONFIG_HOME/mpv-handler/config.toml`), and runs `xdg-mime` for both protocol handlers. On non-`x64` Linux it first tries to build and stage upstream source into `~/.cache/api-mediaplayer/`, and if `git` or `cargo` are unavailable it stages the bundled Python handler there instead.

## Useful flags

```bash
npm run setup:mpv-handler -- --help
npm run setup:mpv-handler -- --root /path/to/mpv-handler
npm run setup:mpv-handler -- --mpv /path/to/mpv
npm run setup:mpv-handler -- --ytdl /path/to/yt-dlp
npm run setup:mpv-handler -- --skip-source-build
npm run setup:mpv-handler -- --skip-config
npm run setup:mpv-handler -- --dry-run
```

## Reuse existing mpv window (playlist append)

Desktop links now include an `enqueue=append` hint. For the bundled Linux Python fallback handler, this can append into an already-running mpv instance when you set an IPC socket in `config.toml`:

```toml
ipc_socket = "/tmp/mpv-handler.sock"
```

With this set, the first launch starts mpv with that IPC socket and later launches can add new URLs to the current playlist instead of opening a new window.

`--root` points at the extracted upstream `mpv-handler` folder. On Windows it is optional because this repo already ships the handler files under `scripts/`. On Linux it is normally required.

## What the helper does

### Windows

- finds the bundled handler files in this folder unless you override `--root`
- creates or updates `config.toml`
- tries to detect `mpv` and `yt-dlp` from `PATH`
- registers `mpv-handler://` and `mpv-handler-debug://` through the PowerShell installer

### Linux

- validates the extracted upstream release layout
- auto-builds upstream source on non-`x64` Linux when no compatible local root is available and `git` plus `cargo` are installed
- falls back to a bundled Python `mpv-handler` implementation on non-`x64` Linux when source-build tooling is unavailable
- creates or updates `config.toml`
- copies the handler binary to `~/.local/bin/mpv-handler`
- copies the desktop entries to `~/.local/share/applications`
- rewrites `Exec=` entries to the installed absolute binary path
- runs `xdg-mime default ...` for both schemes

## Manual fallback

If you would rather install without the helper:

### Windows

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-mpv-handler.ps1 -InstallRoot .\scripts
```

### Linux

```bash
cp /path/to/mpv-handler/mpv-handler ~/.local/bin/mpv-handler
cp /path/to/mpv-handler/mpv-handler.desktop ~/.local/share/applications/
cp /path/to/mpv-handler/mpv-handler-debug.desktop ~/.local/share/applications/
chmod +x ~/.local/bin/mpv-handler
xdg-mime default mpv-handler.desktop x-scheme-handler/mpv-handler
xdg-mime default mpv-handler-debug.desktop x-scheme-handler/mpv-handler-debug
```

## Upstream project

Upstream `mpv-handler` releases and source:

```text
https://github.com/akiirui/mpv-handler
https://github.com/akiirui/mpv-handler/releases
```

This repo uses the upstream protocol scheme and binaries; the docs here only describe the setup flow for API Media Player.
