import {
  AddDownloadRequest,
  AppSettings,
  DiskSpaceInfo,
  DownloadItem,
  InspectedMedia,
  TelemetryPayload,
} from './models';

export interface SmartDMApi {
  inspectUrl: (url: string) => Promise<InspectedMedia>;
  addDownload: (req: AddDownloadRequest) => Promise<DownloadItem>;
  getTelemetry: () => Promise<TelemetryPayload>;
  startDownload: (id: string) => Promise<void>;
  pauseDownload: (id: string) => Promise<void>;
  resumeDownload: (id: string) => Promise<void>;
  cancelDownload: (id: string) => Promise<void>;
  retryDownload: (id: string) => Promise<void>;
  removeDownload: (id: string, deleteFile?: boolean) => Promise<void>;
  pauseAll: () => Promise<void>;
  resumeAll: () => Promise<void>;
  clearCompleted: () => Promise<void>;
  openFile: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  openFolder: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
  selectDirectory: (currentPath?: string) => Promise<string | null>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
  getDiskSpace: (targetDir?: string) => Promise<DiskSpaceInfo | null>;
  readClipboard: () => Promise<string>;
  getExtensionBridgeStatus: () => Promise<{
    running: boolean;
    port: number;
    extensionDir: string;
  }>;
  restartExtensionBridge: () => Promise<{
    running: boolean;
    port: number;
    extensionDir: string;
  }>;
  openExtensionFolder: () => Promise<{ ok: boolean; error?: string }>;
  windowMinimize: () => Promise<void>;
  windowToggleMaximize: () => Promise<boolean>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
  onTelemetry: (callback: (payload: TelemetryPayload) => void) => () => void;
  onClipboardUrlDetected: (callback: (url: string) => void) => () => void;
  onFocusUrlInput: (callback: (prefillUrl?: string) => void) => () => void;
  onWindowMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
  onExtensionCaptured: (callback: (filename: string) => void) => () => void;
  onExtensionStatusChange: (
    callback: (status: { running: boolean; port: number; extensionDir: string }) => void
  ) => () => void;
}

declare global {
  interface Window {
    smartDM: SmartDMApi;
  }
}
