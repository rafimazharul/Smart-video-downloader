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

export interface RequestHeaders {
  referer?: string;
  cookie?: string;
  userAgent?: string;
}

export interface DownloadSegment {
  index: number;
  start: number;
  end: number; // inclusive
  downloaded: number;
  done: boolean;
}

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
  speed: number; // bytes per second
  progress: number; // 0..100, or -1 if totalBytes unknown while downloading
  etaSeconds: number | null;
  status: DownloadStatus;
  resumable: boolean;
  etag: string | null;
  lastModified: string | null;
  error: string | null;
  retryCount: number;
  maxRetries: number;
  thumbnailUrl: string | null;
  requestHeaders?: RequestHeaders | null;
  segments?: DownloadSegment[] | null;
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
  requestHeaders?: RequestHeaders | null;
  skipInspect?: boolean;
  mimeType?: string;
  totalBytes?: number | null;
}

export interface AppSettings {
  defaultDownloadDir: string;
  maxConcurrentDownloads: number;
  connectionsPerDownload: number; // 1..16 parallel HTTP Range segments
  speedLimitBytesPerSec: number; // 0 = unlimited
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
