# API Media Player

API Media Player is a web-first PWA for browsing Hydrus media and handing playback off to native apps instead of an in-browser player.

## What works today

- Start the app with `npm start` and connect a Hydrus server from the web settings screen
- Use `npm run dev` when you want the live-reload development server
- Add one or more Hydrus clients from the Settings page or a local `.env` file
- Launch playback in native apps:
	- Windows and Linux desktop: `mpv` through `mpv-handler://`
	- Android: `mpv-android` through `intent://`
	- iPhone and iPad: VLC through `vlc-x-callback://`

## Fast start

1. Install Node.js 20 or newer.
2. Install dependencies:

```bash
npm install
```

3. Start the app:

```bash
npm start
```

4. Open the local URL printed in the terminal. By default it starts on `http://localhost:4173`, but it will move to the next free port if that one is already in use.

On a fresh install the app opens the Hydrus server settings first. Add your host, port, and API key there, test the connection, then save the server before browsing the library. Playback itself is always external, so actual media launch still depends on the platform-specific player flow below.

`npm start` now builds the app and serves the production output, which is the safer default for devices like Raspberry Pi. Use `npm run dev` only when you specifically want the Vite development server and live reload.

## Connect Hydrus (optional)

Add Hydrus servers from Settings in the app (host, port, and API key). You can add more than one. Nothing is preconfigured on first launch.

Browsers cannot attach custom Hydrus API headers to direct media URLs. If your Hydrus setup requires header-based authentication for file access, put a trusted reverse proxy in front of it or provide playable URLs another way.

### HTTPS app + HTTP Hydrus (mixed content / "CORS")

If this PWA is opened on **HTTPS** (for example `https://media.example.com`) and Hydrus is only available on **HTTP** (`http://hydrus.example.com:45869` or `http://192.168.x.x:45869`), the browser will block the request. That often shows up as a CORS or "Failed to fetch" error even when Hydrus has **CORS** and **allow non-local connections** enabled. CORS cannot override mixed-content rules.

Pick one of these fixes:

1. **Recommended:** Terminate TLS in front of Hydrus (Caddy/nginx/Traefik) so the API is also HTTPS, then use that HTTPS URL in Settings.
2. **Built-in same-origin proxy (this repo):** set `HYDRUS_PROXY_TARGET` to your Hydrus HTTP API, restart `npm run dev` / `npm start`, and in Settings use Server URL `/hydrus-proxy` (plus your API key). The browser only talks to this app's origin; Vite forwards to Hydrus.
3. Serve this app over plain HTTP on a trusted LAN (not ideal for public networks).

Example `.env` for option 2:

```dotenv
HYDRUS_PROXY_TARGET=http://192.168.1.50:45869
```

If you host the built `dist/` files behind your own reverse proxy instead of `vite preview`, add an equivalent path rewrite there (map `/hydrus-proxy/*` → Hydrus `/*`) and still use `/hydrus-proxy` as the Server URL.

## Playback setup by device

### Windows desktop

1. Install `mpv` and optionally `yt-dlp`.
2. Open an elevated PowerShell or Windows Terminal.
3. From the repo root, run:

```bash
npm run setup:mpv-handler
```

The repo already includes the Windows `mpv-handler` binaries under `scripts/`, so the helper script can:

- reuse the bundled handler files
- detect `mpv` and `yt-dlp` from `PATH` when possible
- update `scripts/config.toml`
- register `mpv-handler://` and `mpv-handler-debug://`

To remove the registration later:

```bash
npm run uninstall:mpv-handler
```

### Linux desktop

Run this on the Linux desktop client that should receive `mpv-handler://` links, not on the server that is merely hosting API Media Player.

1. Install `mpv` and optionally `yt-dlp`.
2. Download and extract the latest upstream Linux release:

```text
https://github.com/akiirui/mpv-handler/releases/latest/download/mpv-handler-linux-amd64.zip
```

The upstream project currently publishes an official Linux release for `amd64` only. On Raspberry Pi or other ARM Linux systems, `npm run setup:mpv-handler` now tries to build a compatible binary automatically from upstream source if both `git` and Rust `cargo` are installed. If they are not available, it falls back to a bundled Python-based Linux protocol handler that supports this app's `mpv-handler://play/...` URLs without Rust.

3. Run the helper against the extracted folder:

```bash
npm run setup:mpv-handler -- --root /path/to/extracted/mpv-handler-linux-amd64
```

On Linux the helper copies the binary and desktop files into `~/.local`, writes `config.toml` to `~/.config/mpv-handler/config.toml` (or `$XDG_CONFIG_HOME/mpv-handler/config.toml`), and runs `xdg-mime` for both protocol handlers. On non-`x64` Linux it first prefers an automatic upstream source build under `~/.cache/api-mediaplayer/` when `git` and `cargo` are available, and otherwise falls back to the bundled Python handler.

### Android

Install `mpv-android` (`is.xyz.mpv`). No extra handler setup is needed.

### iPhone / iPad

Install VLC for iOS. The app sends playback to `vlc-x-callback://` automatically.

### macOS desktop

The app can still browse Hydrus and demo content on macOS, but this repo does not currently automate `mpv-handler://` registration for desktop macOS. If you already have a compatible custom protocol handler installed, the desktop playback flow will use it. Otherwise, use another supported playback platform for now.

## Optional userscript for direct media URLs

If you want direct file loads in the browser to jump into `mpv` before the page player starts, install the userscript served by this app:

```text
/userscripts/api-media-player-open-in-mpv.user.js
```

Examples:

```text
http://localhost:4173/userscripts/api-media-player-open-in-mpv.user.js
http://127.0.0.1:4173/userscripts/api-media-player-open-in-mpv.user.js
```

If preview chooses a different port because `4173` is busy, use that same port for the userscript URL too.

It only activates on `localhost`, loopback, RFC1918 LAN IPs, and `.local` or `.lan` hosts. On desktop it redirects to `mpv-handler://...`; on Android it redirects to the `mpv` app through `intent://...`.

## Book reader (Thorium Web)

EPUB files in the Books section open in [Thorium Web](https://github.com/edrlab/thorium-web). PDFs open in the browser’s built-in reader.

1. Run Thorium Web alongside this app (`pnpm dev` or `pnpm start` in the Thorium Web repo, default `http://localhost:3000`).
2. Keep Thorium's `.env` with `MANIFEST_ROUTE_FORCE_ENABLE=true` and `MANIFEST_ALLOWED_DOMAINS=*`.
3. Sync cache in Settings so Thorium's home page lists Hydrus EPUBs from the servers saved in this app.
4. Click an EPUB here or in Thorium. The app streams the Hydrus file into Thorium at `/read/manifest/...`.

The Thorium URL can be changed in Settings, or with `VITE_THORIUM_WEB_URL`. PDFs use the browser reader. Other book formats still open in the browser. Hydrus API keys stay in Settings, not in `.env`.

## Useful commands

```bash
npm start
npm run dev
npm run build
npm run preview
npm run typecheck
npm run setup:mpv-handler -- --help
```

## More detail

See `scripts/README.md` for the helper script behavior, flags, and the Windows/Linux manual fallbacks.
