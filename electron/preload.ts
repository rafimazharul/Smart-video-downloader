import { contextBridge, ipcRenderer } from 'electron';
import {
  AddDownloadRequest,
  AppSettings,
  DiskSpaceInfo,
  DownloadItem,
  InspectedMedia,
  TelemetryPayload,
} from './types';

const api = {
  inspectUrl: (url: string): Promise<InspectedMedia> =>
    ipcRenderer.invoke('downloads:inspect', url),

  addDownload: (req: AddDownloadRequest): Promise<DownloadItem> =>
    ipcRenderer.invoke('downloads:add', req),

  getTelemetry: (): Promise<TelemetryPayload> =>
    ipcRenderer.invoke('downloads:telemetry'),

  startDownload: (id: string): Promise<void> =>
    ipcRenderer.invoke('downloads:start', id),

  pauseDownload: (id: string): Promise<void> =>
    ipcRenderer.invoke('downloads:pause', id),

  resumeDownload: (id: string): Promise<void> =>
    ipcRenderer.invoke('downloads:resume', id),

  cancelDownload: (id: string): Promise<void> =>
    ipcRenderer.invoke('downloads:cancel', id),

  retryDownload: (id: string): Promise<void> =>
    ipcRenderer.invoke('downloads:retry', id),

  removeDownload: (id: string, deleteFile = false): Promise<void> =>
    ipcRenderer.invoke('downloads:remove', id, deleteFile),

  pauseAll: (): Promise<void> => ipcRenderer.invoke('downloads:pauseAll'),

  resumeAll: (): Promise<void> => ipcRenderer.invoke('downloads:resumeAll'),

  clearCompleted: (): Promise<void> => ipcRenderer.invoke('downloads:clearCompleted'),

  openFile: (filePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('shell:openFile', filePath),

  openFolder: (filePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('shell:openFolder', filePath),

  openExternal: (url: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('shell:openExternal', url),

  selectDirectory: (currentPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:selectDirectory', currentPath),

  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),

  updateSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:update', patch),

  getDiskSpace: (targetDir?: string): Promise<DiskSpaceInfo | null> =>
    ipcRenderer.invoke('system:diskSpace', targetDir),

  readClipboard: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),

  getExtensionBridgeStatus: (): Promise<{
    running: boolean;
    port: number;
    extensionDir: string;
  }> => ipcRenderer.invoke('extension:status'),

  restartExtensionBridge: (): Promise<{
    running: boolean;
    port: number;
    extensionDir: string;
  }> => ipcRenderer.invoke('extension:restart'),

  openExtensionFolder: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('extension:openFolder'),

  windowMinimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggleMaximize'),
  windowClose: (): Promise<void> => ipcRenderer.invoke('window:close'),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),

  onTelemetry: (callback: (payload: TelemetryPayload) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: TelemetryPayload) =>
      callback(payload);
    ipcRenderer.on('downloads:telemetry', handler);
    return () => ipcRenderer.removeListener('downloads:telemetry', handler);
  },

  onClipboardUrlDetected: (callback: (url: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) => callback(url);
    ipcRenderer.on('clipboard:urlDetected', handler);
    return () => ipcRenderer.removeListener('clipboard:urlDetected', handler);
  },

  onFocusUrlInput: (callback: (prefillUrl?: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, prefillUrl?: string) =>
      callback(prefillUrl);
    ipcRenderer.on('app:focusUrlInput', handler);
    return () => ipcRenderer.removeListener('app:focusUrlInput', handler);
  },

  onWindowMaximizedChange: (callback: (maximized: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) =>
      callback(maximized);
    ipcRenderer.on('window:maximizedChange', handler);
    return () => ipcRenderer.removeListener('window:maximizedChange', handler);
  },

  onExtensionCaptured: (callback: (filename: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, filename: string) => callback(filename);
    ipcRenderer.on('extension:captured', handler);
    return () => ipcRenderer.removeListener('extension:captured', handler);
  },

  onExtensionStatusChange: (
    callback: (status: { running: boolean; port: number; extensionDir: string }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      status: { running: boolean; port: number; extensionDir: string }
    ) => callback(status);
    ipcRenderer.on('extension:statusChange', handler);
    return () => ipcRenderer.removeListener('extension:statusChange', handler);
  },
};

contextBridge.exposeInMainWorld('smartDM', api);

export type SmartDMApi = typeof api;
