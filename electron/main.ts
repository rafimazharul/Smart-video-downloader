import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
} from 'electron';
import fs from 'fs';
import path from 'path';
import { EXTENSION_BRIDGE_PORT, ExtensionBridgeServer } from './bridge/extensionServer';
import { AppDatabase } from './db/database';
import { DownloadManager } from './engine/downloadManager';
import { inspectUrl } from './engine/inspector';
import { getDiskSpace, looksLikeDownloadableUrl } from './engine/utils';
import { AddDownloadRequest, AppSettings, DownloadItem, TelemetryPayload } from './types';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let db: AppDatabase | null = null;
let manager: DownloadManager | null = null;
let extensionBridge: ExtensionBridgeServer | null = null;
let isQuitting = false;
let didCleanShutdown = false;
let clipboardTimer: NodeJS.Timeout | null = null;
let lastClipboardText = '';

function resolveAssetPath(filename: string): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'assets', filename),
    path.join(__dirname, '..', 'assets', filename),
    path.join(process.cwd(), 'assets', filename),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return candidates[1];
}

function resolveExtensionDir(): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'browser-extension'),
    path.join(__dirname, '..', 'browser-extension'),
    path.join(process.cwd(), 'browser-extension'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return candidates[1];
}

function formatSpeedCompact(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '0 KB/s';
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
  }
  return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
}

function showAndFocusWindow(focusUrlInput = false, prefillUrl?: string): void {
  if (!mainWindow) {
    createWindow(false);
  }
  if (!mainWindow) return;

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();

  if (focusUrlInput) {
    mainWindow.webContents.send('app:focusUrlInput', prefillUrl);
  }
}

function createWindow(startHidden: boolean): void {
  const iconPath = resolveAssetPath('icon.png');
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;

  mainWindow = new BrowserWindow({
    width: 1220,
    height: 800,
    minWidth: 920,
    minHeight: 620,
    show: !startHidden,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#060E12',
    icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const isDev = !app.isPackaged && Boolean(process.env.VITE_DEV_SERVER_URL);
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximizedChange', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximizedChange', false);
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting && manager?.getSettings().minimizeToTrayOnClose) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray(): void {
  const icoPath = resolveAssetPath('icon.ico');
  const trayPath = resolveAssetPath('tray-icon.png');
  const iconPath =
    process.platform === 'win32' && fs.existsSync(icoPath)
      ? icoPath
      : fs.existsSync(trayPath)
      ? trayPath
      : resolveAssetPath('icon.png');
  const trayImg = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();

  tray = new Tray(trayImg);
  tray.setToolTip('Smart Video Downloader');

  const buildMenu = () =>
    Menu.buildFromTemplate([
      {
        label: 'Open Smart Video Downloader',
        click: () => showAndFocusWindow(false),
      },
      {
        label: 'New Download (Ctrl+Shift+D)',
        click: () => showAndFocusWindow(true),
      },
      { type: 'separator' },
      {
        label: 'Pause All Downloads',
        click: () => {
          void manager?.pauseAll();
        },
      },
      {
        label: 'Resume All Downloads',
        click: () => {
          manager?.resumeAll();
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);

  tray.setContextMenu(buildMenu());
  tray.on('double-click', () => showAndFocusWindow(false));
  tray.on('click', () => showAndFocusWindow(false));
}

function registerShortcuts(): void {
  try {
    globalShortcut.register('CommandOrControl+Shift+D', () => {
      const text = clipboard.readText().trim();
      const maybeUrl = looksLikeDownloadableUrl(text) ? text : undefined;
      showAndFocusWindow(true, maybeUrl);
    });

    globalShortcut.register('CommandOrControl+Shift+P', () => {
      if (!manager) return;
      const payload = manager.getTelemetryPayload();
      if (payload.activeCount > 0) {
        void manager.pauseAll();
      } else {
        manager.resumeAll();
      }
    });
  } catch (err) {
    console.error('Failed to register global shortcuts:', err);
  }
}

function startClipboardMonitor(): void {
  lastClipboardText = clipboard.readText().trim();
  clipboardTimer = setInterval(() => {
    if (!manager || !manager.getSettings().clipboardMonitorEnabled) return;
    const current = clipboard.readText().trim();
    if (!current || current === lastClipboardText) return;
    lastClipboardText = current;

    if (looksLikeDownloadableUrl(current)) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('clipboard:urlDetected', current);
      }
    }
  }, 1200);
}

function applyStartupSettings(settings: AppSettings): void {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: settings.launchAtStartup,
      args: settings.startMinimized ? ['--hidden'] : [],
    });
  } catch (err) {
    console.error('Failed to apply login item settings:', err);
  }
}

function showDownloadNotification(item: DownloadItem, type: 'completed' | 'failed'): void {
  if (!manager?.getSettings().notificationsEnabled) return;
  if (!Notification.isSupported()) return;

  const iconPath = resolveAssetPath('icon.png');
  const notification = new Notification({
    title: type === 'completed' ? 'Download Completed' : 'Download Failed',
    body:
      type === 'completed'
        ? `${item.filename} is ready.`
        : `${item.filename}: ${item.error || 'Download failed.'}`,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
  });

  notification.on('click', () => {
    if (type === 'completed' && fs.existsSync(item.filePath)) {
      shell.showItemInFolder(item.filePath);
    } else {
      showAndFocusWindow(false);
    }
  });

  notification.show();
}

function registerIpcHandlers(): void {
  ipcMain.handle('downloads:inspect', async (_e, url: string) => {
    return inspectUrl(url);
  });

  ipcMain.handle('downloads:add', async (_e, req: AddDownloadRequest) => {
    if (!manager) throw new Error('Download manager not initialized.');
    return manager.addDownload(req);
  });

  ipcMain.handle('downloads:telemetry', async () => {
    if (!manager) throw new Error('Download manager not initialized.');
    return manager.getTelemetryPayload();
  });

  ipcMain.handle('downloads:start', async (_e, id: string) => {
    manager?.startDownload(id);
  });

  ipcMain.handle('downloads:pause', async (_e, id: string) => {
    await manager?.pauseDownload(id);
  });

  ipcMain.handle('downloads:resume', async (_e, id: string) => {
    manager?.resumeDownload(id);
  });

  ipcMain.handle('downloads:cancel', async (_e, id: string) => {
    await manager?.cancelDownload(id);
  });

  ipcMain.handle('downloads:retry', async (_e, id: string) => {
    manager?.retryDownload(id);
  });

  ipcMain.handle('downloads:remove', async (_e, id: string, deleteFile = false) => {
    await manager?.removeDownload(id, deleteFile);
  });

  ipcMain.handle('downloads:pauseAll', async () => {
    await manager?.pauseAll();
  });

  ipcMain.handle('downloads:resumeAll', async () => {
    manager?.resumeAll();
  });

  ipcMain.handle('downloads:clearCompleted', async () => {
    manager?.clearCompleted();
  });

  ipcMain.handle('shell:openFile', async (_e, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return { ok: false, error: 'File no longer exists on disk.' };
    }
    const errStr = await shell.openPath(filePath);
    if (errStr) {
      return { ok: false, error: errStr };
    }
    return { ok: true };
  });

  ipcMain.handle('shell:openFolder', async (_e, filePath: string) => {
    if (!filePath) {
      return { ok: false, error: 'Invalid path.' };
    }
    if (fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
      return { ok: true };
    }
    const dir = path.dirname(filePath);
    if (fs.existsSync(dir)) {
      await shell.openPath(dir);
      return { ok: true };
    }
    return { ok: false, error: 'Folder no longer exists on disk.' };
  });

  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { ok: false, error: 'Only HTTP/HTTPS URLs can be opened.' };
      }
      await shell.openExternal(parsed.toString());
      return { ok: true };
    } catch {
      return { ok: false, error: 'Invalid external URL.' };
    }
  });

  ipcMain.handle('dialog:selectDirectory', async (_e, currentPath?: string) => {
    const win = mainWindow || BrowserWindow.getFocusedWindow();
    const opts: Electron.OpenDialogOptions = {
      title: 'Select Download Folder',
      defaultPath: currentPath && fs.existsSync(currentPath) ? currentPath : app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('settings:get', async () => {
    if (!manager) throw new Error('Download manager not initialized.');
    return manager.getSettings();
  });

  ipcMain.handle('settings:update', async (_e, patch: Partial<AppSettings>) => {
    if (!manager) throw new Error('Download manager not initialized.');
    const updated = manager.updateSettings(patch);
    applyStartupSettings(updated);
    return updated;
  });

  ipcMain.handle('system:diskSpace', async (_e, targetDir?: string) => {
    const dir = targetDir || manager?.getSettings().defaultDownloadDir || app.getPath('downloads');
    const space = await getDiskSpace(dir);
    if (!space) return null;
    return { ...space, path: dir };
  });

  ipcMain.handle('clipboard:read', async () => {
    return clipboard.readText().trim();
  });

  ipcMain.handle('extension:status', () => {
    return {
      running: extensionBridge?.isRunning() ?? false,
      port: EXTENSION_BRIDGE_PORT,
      extensionDir: resolveExtensionDir(),
    };
  });

  ipcMain.handle('extension:restart', async () => {
    const running = (await extensionBridge?.restart()) ?? false;
    return {
      running,
      port: EXTENSION_BRIDGE_PORT,
      extensionDir: resolveExtensionDir(),
    };
  });

  ipcMain.handle('extension:openFolder', async () => {
    const extDir = resolveExtensionDir();
    if (!fs.existsSync(extDir)) {
      return { ok: false, error: 'Browser extension folder was not found.' };
    }
    const err = await shell.openPath(extDir);
    if (err) return { ok: false, error: err };
    return { ok: true };
  });

  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('window:toggleMaximize', () => {
    if (!mainWindow) return false;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return false;
    }
    mainWindow.maximize();
    return true;
  });

  ipcMain.handle('window:close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });
}

// Single instance lock so clicking the app shortcut focuses the running window
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showAndFocusWindow(false);
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.smartdm.downloader');

    const userDataDir = app.getPath('userData');
    const defaultDownloadDir = path.join(app.getPath('downloads'), 'SmartVideoDownloader');
    fs.mkdirSync(defaultDownloadDir, { recursive: true });

    db = new AppDatabase(path.join(userDataDir, 'smartdm.sqlite'));
    await db.init(defaultDownloadDir);

    manager = new DownloadManager(db, defaultDownloadDir);
    manager.init();

    manager.on('telemetry', (payload: TelemetryPayload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('downloads:telemetry', payload);
      }
      if (tray) {
        const tooltip =
          payload.activeCount > 0
            ? `Smart Video Downloader — ${payload.activeCount} active (${formatSpeedCompact(payload.totalSpeedBytesPerSec)})`
            : 'Smart Video Downloader — Idle';
        tray.setToolTip(tooltip);
      }
    });

    manager.on('completed', (item: DownloadItem) => {
      showDownloadNotification(item, 'completed');
    });

    manager.on('failed', (item: DownloadItem) => {
      showDownloadNotification(item, 'failed');
    });

    extensionBridge = new ExtensionBridgeServer(
      manager,
      (item: DownloadItem) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('extension:captured', item.filename);
        }
        showAndFocusWindow(false);
      },
      (running: boolean) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('extension:statusChange', {
            running,
            port: EXTENSION_BRIDGE_PORT,
            extensionDir: resolveExtensionDir(),
          });
        }
      }
    );
    await extensionBridge.start();

    registerIpcHandlers();
    createTray();

    const settings = manager.getSettings();
    const launchHidden = process.argv.includes('--hidden') || settings.startMinimized;
    createWindow(launchHidden);
    registerShortcuts();
    startClipboardMonitor();
  });

  app.on('before-quit', async (event) => {
    if (didCleanShutdown) return;
    event.preventDefault();
    isQuitting = true;
    didCleanShutdown = true;

    if (clipboardTimer) {
      clearInterval(clipboardTimer);
      clipboardTimer = null;
    }
    globalShortcut.unregisterAll();

    try {
      await extensionBridge?.stop();
      await manager?.shutdown();
      db?.close();
    } catch (err) {
      console.error('Error during shutdown:', err);
    }
    app.exit(0);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !manager?.getSettings().minimizeToTrayOnClose) {
      app.quit();
    }
  });
}
