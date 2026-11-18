# Smart Video Downloader — Modern IDM Alternative

A full-featured, modern Windows desktop download manager inspired by Internet Download Manager (IDM), built with **Electron**, **React**, **TypeScript**, **Tailwind CSS**, **Node.js HTTP/HTTPS Streaming**, and **SQLite**.

---

## Features

### Real Multi-Connection Streaming Download Engine
- **IDM-Style Multi-Segment Acceleration (1–16 Connections)**: Splits resumable downloads into parallel HTTP `Range` connections writing directly to exact byte offsets on disk via `FileHandle` (no post-download merge delay) with HTTP/HTTPS keep-alive connection pooling.
- **Direct Disk Streaming**: Streams data directly to `.smartdm.part` temporary files on disk without loading large files into RAM.
- **Per-Segment HTTP Range Resumption**: Persists per-segment progress in SQLite and sends `Range` + `If-Range` (`ETag` / `Last-Modified`) headers for reliable pause/resume. Gracefully falls back to single-connection mode if a server ignores `Range`.
- **Integrity Protection**: Verifies stream completion, all segment bounds, and exact file size against `Content-Length` before atomically renaming `.smartdm.part` to the final file—incomplete or truncated files are never marked completed.
- **Automatic Retry**: Retries transient network drops per segment (`ECONNRESET`, `ETIMEDOUT`, DNS errors, HTTP 5xx, premature close) with exponential backoff while keeping already-downloaded bytes.
- **Real-Time Bandwidth Throttling**: Zero-overhead direct write path when set to `Unlimited`, with a dynamic token-bucket byte-rate throttle stream when a custom speed limit is active.
- **Duplicate Filename Handling**: Automatically numbers colliding filenames (`video.mp4` → `video (1).mp4`).
- **Pre-Flight Disk Space & Permission Checks**: Checks available storage and folder write access before writing to disk.

### URL Inspection & Smart Media Detection
- Paste or type any publicly accessible `http://` or `https://` direct video or media URL.
- Automatically follows redirects (up to 10 hops) and probes `HEAD` (with `GET Range: bytes=0-0` fallback) to detect filename (`Content-Disposition` or URL), file size, MIME type, category, and Range resumability.
- Safely detects publicly embedded direct `<video>` / `<source>` / `og:video` links on standard web pages without bypassing DRM, authentication, paywalls, or access controls.
- Rename files and pick custom save folders before starting a download.

### Modern Desktop Dashboard & Controls
- **Sections**: All Downloads, Downloading, Completed, Paused, Failed, and Settings.
- **Real-Time Monitoring (1s ticks)**: Live speed (KB/s, MB/s), progress (%), downloaded/total bytes, ETA, and an animated 60-second **Real-Time Speed Graph**.
- **Full Per-Download Controls**: Start, Pause, Resume, Cancel, Retry, Open File, Open Containing Folder, Remove.
- **Bulk Controls**: Pause All, Resume All, Clear Completed, instant search filter.
- **iPhone Control Center Frosted Glass UI**: Translucent blurred glass panels, Dynamic Island live speed pill, emerald-teal primary palette, and both Dark Glass & Light Glass themes.
- **About the Creator Page**: Dedicated developer profile view with clickable links to Portfolio, LinkedIn, and GitHub.

### Desktop Integration & Persistence
- **SQLite Database**: Persists all download history and user settings in `smartdm.sqlite` inside your Electron `userData` directory. Active downloads safely recover as `Paused` across restarts.
- **System Tray**: Background downloading with live speed tooltip and quick-action tray menu.
- **Native Notifications**: Desktop notifications when downloads complete or fail.
- **Clipboard URL Monitor**: Optional automatic detection of copied direct media links.
- **Global Keyboard Shortcuts**:
  - `Ctrl + Shift + D`: Bring app to front & focus/prefill URL input
  - `Ctrl + Shift + P`: Toggle Pause All / Resume All
  - `Ctrl + N`: Focus URL bar (in-app)
  - `Ctrl + ,`: Open Settings (in-app)

---

## Project Structure

```
.
├── assets/                     # App & system tray PNG icons
├── build/                      # Windows installer ICO icon
├── electron/
│   ├── db/
│   │   └── database.ts         # SQLite persistence (sql.js WASM, atomic flush)
│   ├── engine/
│   │   ├── downloadManager.ts  # Streaming engine, queue, Range resume, retries, telemetry
│   │   ├── inspector.ts        # HTTP/HTTPS metadata probe & safe public media extraction
│   │   ├── throttle.ts         # Dynamic token-bucket speed limiter stream
│   │   └── utils.ts            # URL validation, filename sanitization, disk space, errors
│   ├── main.ts                 # Electron main process, Tray, Shortcuts, IPC, Notifications
│   ├── preload.ts              # Secure contextBridge preload API
│   └── types.ts                # Shared backend TypeScript types
├── scripts/
│   ├── generate-icons.cjs      # Pure-Node multi-res PNG & ICO generator
│   └── test-engine.cjs         # Automated end-to-end download engine integration tests
├── src/
│   ├── components/
│   │   ├── CategoryIcon.tsx    # Media category icons & badge styles
│   │   ├── ClipboardToast.tsx  # Clipboard URL auto-detection banner
│   │   ├── DownloadCard.tsx    # Per-download card with live stats & all action controls
│   │   ├── SettingsView.tsx    # Settings page & keyboard shortcut guide
│   │   ├── Sidebar.tsx         # Navigation sidebar, bandwidth & storage widget
│   │   ├── SpeedGraph.tsx      # Real-time 60s SVG download speed graph
│   │   ├── TitleBar.tsx        # Custom Windows title bar & theme toggle
│   │   ├── ToastContainer.tsx  # App-level toast notifications
│   │   └── UrlBar.tsx          # Hero URL input, Paste button & pre-download inspector
│   ├── types/
│   │   ├── electron.d.ts       # Window API typings
│   │   └── models.ts           # Frontend TypeScript models
│   ├── utils/
│   │   └── format.ts           # Byte, speed, ETA, and relative time formatters
│   ├── App.tsx                 # Main application layout & state
│   ├── index.css               # Tailwind styles & progress animations
│   └── main.tsx                # React entry point
├── index.html
├── package.json
├── tailwind.config.js
├── tsconfig.electron.json
├── tsconfig.json
└── vite.config.ts
```

---

## Prerequisites

- **Node.js** 20+ (tested on Node.js 24)
- **npm** 10+
- **Windows 10 / 11 (x64)** for running and building the Windows `.exe` installer

---

## Installation & Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run in development mode** (Vite HMR + Electron):
   ```bash
   npm run dev
   ```

3. **Build production bundles** (React + Electron TypeScript):
   ```bash
   npm run build
   ```

4. **Launch built desktop application**:
   ```bash
   npm start
   ```

5. **Run automated download engine integration tests**:
   ```bash
   npm run test:engine
   ```

6. **Build production Windows `.exe` installer**:
   ```bash
   npm run package:win
   ```
   The NSIS Windows installer (`Smart-Video-Downloader-Setup-1.0.0.exe`) and unpacked app are output to the `release/` directory.

---

### Browser Extension Integration (Chrome / Edge / Brave)
The included Manifest V3 extension (`browser-extension/`) automatically intercepts browser downloads when you click a Download button on a website and hands them off (including session cookies & `Referer`) to Smart Video Downloader over a local loopback bridge (`127.0.0.1:48921`):

1. Open `chrome://extensions` (Chrome/Brave) or `edge://extensions` (Microsoft Edge).
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and choose the `browser-extension` folder (or open it directly from **Settings → Open Extension Folder** inside the desktop app).
4. Keep **Smart Video Downloader** running—clicked website downloads and right-click **"Download with Smart Video Downloader"** links will automatically transfer into the desktop app. When the desktop app is closed, browser downloads continue normally.

---

## Legal & Ethical Usage

Smart Video Downloader is intended strictly for downloading publicly accessible files and content you are legally authorized to download. It does not circumvent DRM, paywalls, authentication, or platform access controls.
