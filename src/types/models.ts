export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type MediaCategory =
  | 'video'
  | 'audio'
  | 'image'
  | 'archive'
  | 'document'
  | 'software'
  | 'other';

export interface DownloadItem {
  id: string;
  url: string;
  finalUrl: string;
  filename: string;
  saveDir: string;
  filePath: string;
  partPath: string;
  mimeType: string;
  category: MediaCategory;
  totalBytes: number | null;
  downloadedBytes: number;
  speed: number;
  progress: number;
  etaSeconds: number | null;
  status: DownloadStatus;
  resumable: boolean;
  etag: string | null;
  lastModified: string | null;
  error: string | null;
  retryCount: number;
  maxRetries: number;
  thumbnailUrl: string | null;
  activeConnections?: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface InspectedMedia {
  url: string;
  finalUrl: string;
  filename: string;
  mimeType: string;
  category: MediaCategory;
  totalBytes: number | null;
  resumable: boolean;
  etag: string | null;
  lastModified: string | null;
  thumbnailUrl: string | null;
  extractedFromPage?: boolean;
  pageTitle?: string;
}

export interface AddDownloadRequest {
  url: string;
  filename?: string;
  saveDir?: string;
  startImmediately?: boolean;
  inspected?: InspectedMedia | null;
}

export interface AppSettings {
  defaultDownloadDir: string;
  maxConcurrentDownloads: number;
  connectionsPerDownload: number;
  speedLimitBytesPerSec: number;
  autoRetry: boolean;
  maxRetries: number;
  theme: 'dark' | 'light';
  notificationsEnabled: boolean;
  clipboardMonitorEnabled: boolean;
  minimizeToTrayOnClose: boolean;
  launchAtStartup: boolean;
  startMinimized: boolean;
}

export interface SpeedPoint {
  timestamp: number;
  speedBytesPerSec: number;
  activeCount: number;
}

export interface DiskSpaceInfo {
  freeBytes: number;
  totalBytes: number;
  path: string;
}

export interface TelemetryPayload {
  downloads: DownloadItem[];
  totalSpeedBytesPerSec: number;
  activeCount: number;
  speedHistory: SpeedPoint[];
}

export type NavSection =
  | 'all'
  | 'downloading'
  | 'completed'
  | 'paused'
  | 'failed'
  | 'settings'
  | 'about';

export interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'error';
  title: string;
  description?: string;
}
