# Smart Video Downloader — Modern IDM Alternative

<p align="center">
  <img src="assets/icon.png" alt="Smart Video Downloader Logo" width="96" height="96" />
</p>

<p align="center">
  <strong>A fast, modern Windows desktop download manager inspired by Internet Download Manager (IDM)</strong><br/>
  Built with Electron, React, TypeScript, Tailwind CSS, Node.js Multi-Segment HTTP Streaming, SQLite, and a Chrome/Edge Browser Extension.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Windows%2010%2F11%20(x64)-10B981?style=for-the-badge" alt="Windows x64" />
  <img src="https://img.shields.io/badge/Electron-33-0D9488?style=for-the-badge" alt="Electron" />
  <img src="https://img.shields.io/badge/React-18-14B8A6?style=for-the-badge" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5-059669?style=for-the-badge" alt="TypeScript" />
  <img src="https://img.shields.io/badge/License-MIT-34D399?style=for-the-badge" alt="MIT License" />
</p>

---

## Highlights

### High-Speed Multi-Connection Download Engine
- **IDM-Style Multi-Segment Acceleration (1–16 Connections)**: Automatically splits resumable downloads into parallel HTTP `Range` connections (default **8 connections**, configurable **1–16** in Settings) writing directly to exact byte offsets on disk via `FileHandle`—zero merge delay on completion.
- **Direct Disk Streaming**: Streams directly to `.smartdm.part` files on disk instead of buffering large files in RAM.
- **Per-Segment HTTP Range Resumption**: Saves exact per-segment progress in SQLite and resumes cleanly with `Range` + `If-Range` (`ETag` / `Last-Modified`). Falls back automatically to single-connection streaming if a server does not support `Range`.
- **Integrity Protection**: Verifies stream completion, all segment bounds, and final disk size against `Content-Length` before atomically renaming `.smartdm.part` to the final file—corrupted or truncated files are never marked completed.
- **Per-Segment Auto-Retry**: Recovers from dropped connections (`ECONNRESET`, `ETIMEDOUT`, DNS errors, HTTP 5xx, premature EOF) with exponential backoff while keeping already-downloaded bytes.
- **Bandwidth Throttling & Queue Management**: Zero-overhead direct write path when set to `Unlimited`, live token-bucket global speed cap when throttled, and configurable concurrent download queue (1–10).
- **Smart Safety Checks**: Pre-flight disk space checks, folder write-permission checks, and automatic duplicate filename numbering (`video.mp4` → `video (1).mp4`).

### Browser Extension Integration (Chrome / Edge / Brave)
- Included Manifest V3 extension (`browser-extension/`) connects to the desktop app over a secure localhost loopback bridge (`127.0.0.1:48921`).
- **Auto-Capture Downloads**: Clicking a Download button on a website automatically transfers the download (with its `Referer` and session cookies) to Smart Video Downloader and cancels the duplicate browser download.
- **Right-Click Context Menu**: Right-click any link, video, audio, or image → **Download with Smart Video Downloader**.
- **Graceful Offline Fallback**: When the desktop app is closed, browser downloads continue normally.

### iPhone Control Center Frosted Glass UI
- **Frosted Glass Design**: Translucent blurred glass panels, emerald-teal primary palette, Dynamic Island-inspired live throughput pill, smooth 60-second cubic-Bezier speed graph, and both **Dark Glass** and **Light Glass** themes.
- **Full Download Dashboard**: Filter across **All Downloads**, **Downloading**, **Completed**, **Paused**, and **Failed**, with instant search, bulk actions (**Pause All**, **Resume All**, **Clear Completed**), and full per-item controls (**Start**, **Pause**, **Resume**, **Cancel**, **Retry**, **Open File**, **Open Folder**, **Remove**).
- **Desktop Integration**: System tray with live speed tooltip, native Windows notifications, clipboard URL auto-detection, Windows startup options, and persistent SQLite history.
- **About the Creator Page**: Dedicated developer profile view with clickable links that open in your default browser.

---

## Download & Install (Windows Users)

1. Download the latest **`Smart-Video-Downloader-Setup-1.0.0.exe`** from the **[Releases](https://github.com/rafimazharul/Smart-video-downloader/releases)** page.
2. Run the installer *(if Windows SmartScreen appears for an unsigned app, click **More info → Run anyway**)*.
3. *(Optional)* Install the **Browser Extension**:
   - Open **Smart Video Downloader → Settings → Open Extension Folder**.
   - Open `chrome://extensions` (Chrome/Brave) or `edge://extensions` (Microsoft Edge).
   - Enable **Developer mode** (top-right toggle).
   - Click **Load unpacked** and select the `browser-extension` folder.

---

## Keyboard Shortcuts

| Shortcut | Scope | Action |
|---|---|---|
| `Ctrl + Shift + D` | Global | Bring app to front & focus / prefill URL bar |
| `Ctrl + Shift + P` | Global | Toggle Pause All / Resume All downloads |
| `Ctrl + N` | In-App | Focus URL input field |
| `Ctrl + ,` | In-App | Open Settings |

---

## Tech Stack

- **Desktop Runtime**: Electron 33
- **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide Icons, Vite
- **Download Engine**: Native Node.js `http` / `https` streaming with HTTP/1.1 Keep-Alive pools, `FileHandle` positional writes, and token-bucket throttling
- **Database**: SQLite 3 (`sql.js` WebAssembly with atomic async disk persistence)
- **Browser Extension**: Chromium Manifest V3 (`downloads`, `cookies`, `contextMenus`, `storage`)
- **Packaging**: `electron-builder` (Windows NSIS x64 `.exe` installer)

---

## Project Structure

```text
.
├── assets/                          # App, tray & ICO icons
├── browser-extension/               # Chrome / Edge / Brave Manifest V3 extension
│   ├── icons/
│   ├── background.js                # Download interception, cookies/referer & bridge client
│   ├── manifest.json
│   ├── popup.css
│   ├── popup.html
│   └── popup.js
├── build/                           # Windows installer icon
├── electron/
│   ├── bridge/
│   │   └── extensionServer.ts       # Secure 127.0.0.1:48921 extension bridge with auto-retry
│   ├── db/
│   │   └── database.ts              # SQLite persistence (history, segments, settings)
│   ├── engine/
│   │   ├── downloadManager.ts       # Multi-download queue, telemetry, resume & retries
│   │   ├── inspector.ts             # Redirect-following HEAD/GET metadata & public media probe
│   │   ├── segmentedWorker.ts       # 1-16x parallel HTTP Range segmented engine
│   │   ├── throttle.ts              # Dynamic token-bucket speed limiter stream
│   │   └── utils.ts                 # Validation, sanitization, disk space & error handling
│   ├── main.ts                      # Electron main process, tray, shortcuts & IPC
│   ├── preload.ts                   # Secure contextBridge preload API
│   └── types.ts                     # Shared backend TypeScript definitions
├── scripts/
│   ├── generate-icons.cjs           # Pure-Node multi-res PNG & ICO icon generator
│   └── test-engine.cjs              # 10-part automated integration & SHA-256 test suite
├── src/
│   ├── assets/
│   │   └── creator-photo.jpg        # Developer profile photo
│   ├── components/
│   │   ├── AboutCreatorView.tsx     # About the Creator profile page
│   │   ├── CategoryIcon.tsx         # Media category icons & badges
│   │   ├── ClipboardToast.tsx       # Clipboard URL auto-detection banner
│   │   ├── DownloadCard.tsx         # Per-download glass card & controls
│   │   ├── SettingsView.tsx         # Settings, speed accelerator & extension setup
│   │   ├── Sidebar.tsx              # Floating Control Center navigation sidebar
│   │   ├── SpeedGraph.tsx           # Real-time 60s smooth Bezier throughput graph
│   │   ├── TitleBar.tsx             # Custom Windows title bar & Dynamic Island pill
│   │   ├── ToastContainer.tsx       # Glass toast notifications
│   │   └── UrlBar.tsx               # Hero URL bar & pre-download metadata editor
│   ├── types/
│   ├── utils/
│   ├── App.tsx
│   ├── index.css
│   └── main.tsx
├── index.html
├── package.json
├── tailwind.config.js
├── tsconfig.electron.json
├── tsconfig.json
└── vite.config.ts
```

---

## Development & Building from Source

### Prerequisites
- **Node.js** 20+ (tested on Node.js 24)
- **npm** 10+
- **Windows 10 / 11 (x64)** for packaging the Windows installer

### Commands

```bash
# 1. Install dependencies
npm install

# 2. Run in development mode (Vite HMR + Electron)
npm run dev

# 3. Build frontend + Electron main process
npm run build

# 4. Launch the built desktop application
npm start

# 5. Run the 10-part automated download engine & SHA-256 test suite
npm run test:engine

# 6. Package the production Windows NSIS .exe installer (output in release/)
npm run package:win
```

---

## Legal & Ethical Usage

Smart Video Downloader is intended strictly for downloading publicly accessible files and content you are legally authorized to download. It respects copyright restrictions, platform terms of service, DRM, authentication, paywalls, and access controls.

---

## About the Creator

**Mazharul Islam Rafi** — CSE student and aspiring Software Engineer from Bangladesh.

- **Portfolio**: [mazharul.bro.bd](https://mazharul.bro.bd)
- **LinkedIn**: [linkedin.com/in/rafimazharul](https://www.linkedin.com/in/rafimazharul/)
- **GitHub**: [github.com/rafimazharul](https://github.com/rafimazharul)

---

© 2026 Mazharul Islam Rafi. All rights reserved.
