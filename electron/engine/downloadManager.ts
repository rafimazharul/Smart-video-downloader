import crypto from 'crypto';
import { EventEmitter } from 'events';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { AppDatabase } from '../db/database';
import {
  AddDownloadRequest,
  AppSettings,
  DownloadItem,
  SpeedPoint,
  TelemetryPayload,
} from '../types';
import { inspectUrl } from './inspector';
import {
  areSegmentsValidForResume,
  MIN_SEGMENT_SIZE,
  SegmentedWorker,
} from './segmentedWorker';
import { DynamicThrottleStream } from './throttle';
import {
  checkDirectoryWritable,
  classifyError,
  detectCategory,
  extractFilenameFromDisposition,
  formatHttpError,
  getDiskSpace,
  inferFilename,
  mergeCookies,
  resolveUniqueFilePath,
  sanitizeFilename,
  validateDownloadUrl,
} from './utils';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_REDIRECTS = 10;
const SOCKET_TIMEOUT_MS = 30000;
const SPEED_HISTORY_LEN = 60;

interface ActiveWorker {
  id: string;
  req: http.ClientRequest | null;
  res: http.IncomingMessage | null;
  writeStream: fs.WriteStream | null;
  throttle: DynamicThrottleStream | null;
  segmented: SegmentedWorker | null;
  abortedByUser: 'pause' | 'cancel' | 'shutdown' | null;
  bytesSinceLastTick: number;
  smoothedSpeed: number;
}

export class DownloadManager extends EventEmitter {
  private db: AppDatabase;
  private fallbackDownloadDir: string;
  private settings: AppSettings;
  private items: Map<string, DownloadItem> = new Map();
  private workers: Map<string, ActiveWorker> = new Map();
  private retryTimers: Map<string, NodeJS.Timeout> = new Map();
  private speedHistory: SpeedPoint[] = [];
  private telemetryTimer: NodeJS.Timeout | null = null;
  private progressTimer: NodeJS.Timeout | null = null;
  private persistTickCounter = 0;

  constructor(db: AppDatabase, fallbackDownloadDir: string) {
    super();
    this.db = db;
    this.fallbackDownloadDir = fallbackDownloadDir;
    this.settings = db.getSettings(fallbackDownloadDir);

    // Pre-populate 60 seconds of zero points for smooth graph start
    const now = Date.now();
    for (let i = SPEED_HISTORY_LEN - 1; i >= 0; i--) {
      this.speedHistory.push({
        timestamp: now - i * 1000,
        speedBytesPerSec: 0,
        activeCount: 0,
      });
    }
  }

  init(): void {
    const saved = this.db.getAllDownloads();
    for (const item of saved) {
      // Recover any downloads that were mid-flight when the app closed
      if (item.status === 'downloading') {
        item.status = 'paused';
        item.speed = 0;
        item.etaSeconds = null;
        item.activeConnections = 0;
        if (item.segments && item.totalBytes && areSegmentsValidForResume(item.segments, item.totalBytes)) {
          item.downloadedBytes = item.segments.reduce((acc, s) => acc + s.downloaded, 0);
          item.progress = Math.min(100, (item.downloadedBytes / item.totalBytes) * 100);
        } else if (fs.existsSync(item.partPath)) {
          try {
            item.downloadedBytes = fs.statSync(item.partPath).size;
            if (item.totalBytes && item.totalBytes > 0) {
              item.progress = Math.min(100, (item.downloadedBytes / item.totalBytes) * 100);
            }
          } catch {
            // keep DB value
          }
        }
        this.db.upsertDownload(item);
      }
      this.items.set(item.id, item);
    }

    this.telemetryTimer = setInterval(() => this.onTelemetryTick(), 1000);
    // Smooth 250ms UI progress updates while downloads are active
    this.progressTimer = setInterval(() => this.onSmoothProgressTick(), 250);
  }

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    this.settings = this.db.updateSettings(patch, this.fallbackDownloadDir);
    // If maxConcurrentDownloads increased, start queued items
    this.processQueue();
    return { ...this.settings };
  }

  getDownloads(): DownloadItem[] {
    return Array.from(this.items.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  getDownload(id: string): DownloadItem | undefined {
    return this.items.get(id);
  }

  getTelemetryPayload(): TelemetryPayload {
    const downloads = this.getDownloads();
    let totalSpeed = 0;
    let activeCount = 0;
    for (const d of downloads) {
      if (d.status === 'downloading') {
        totalSpeed += d.speed;
        activeCount += 1;
      }
    }
    return {
      downloads,
      totalSpeedBytesPerSec: totalSpeed,
      activeCount,
      speedHistory: [...this.speedHistory],
    };
  }

  private emitTelemetry(): void {
    this.emit('telemetry', this.getTelemetryPayload());
  }

  private onSmoothProgressTick(): void {
    if (this.workers.size === 0) return;
    let changed = false;
    for (const id of this.workers.keys()) {
      const item = this.items.get(id);
      if (!item || item.status !== 'downloading') continue;
      if (item.totalBytes && item.totalBytes > 0) {
        const nextPct = Math.min(99.9, (item.downloadedBytes / item.totalBytes) * 100);
        if (Math.abs(nextPct - item.progress) >= 0.05) {
          item.progress = nextPct;
          changed = true;
        }
      } else {
        changed = true;
      }
    }
    if (changed) {
      this.emitTelemetry();
    }
  }

  private onTelemetryTick(): void {
    let totalSpeed = 0;
    let activeCount = 0;
    this.persistTickCounter += 1;

    for (const [id, worker] of this.workers.entries()) {
      const item = this.items.get(id);
      if (!item || item.status !== 'downloading') continue;

      const instantSpeed = worker.bytesSinceLastTick;
      worker.bytesSinceLastTick = 0;

      // Smooth lightly so fluctuations stay readable while still responsive every second
      worker.smoothedSpeed =
        worker.smoothedSpeed === 0
          ? instantSpeed
          : Math.round(worker.smoothedSpeed * 0.35 + instantSpeed * 0.65);

      const effectiveSpeed = instantSpeed === 0 && worker.smoothedSpeed < 512 ? 0 : worker.smoothedSpeed;

      item.speed = effectiveSpeed;
      if (item.totalBytes && item.totalBytes > 0) {
        item.progress = Math.min(99.9, (item.downloadedBytes / item.totalBytes) * 100);
        const remaining = Math.max(0, item.totalBytes - item.downloadedBytes);
        item.etaSeconds = effectiveSpeed > 0 ? Math.ceil(remaining / effectiveSpeed) : null;
      } else {
        item.progress = -1; // indeterminate
        item.etaSeconds = null;
      }

      item.updatedAt = Date.now();
      totalSpeed += effectiveSpeed;
      activeCount += 1;

      // Persist downloaded byte progress asynchronously every 8 seconds to avoid disk I/O jitter
      if (this.persistTickCounter % 8 === 0) {
        this.db.upsertDownload(item);
      }
    }

    this.speedHistory.push({
      timestamp: Date.now(),
      speedBytesPerSec: totalSpeed,
      activeCount,
    });
    if (this.speedHistory.length > SPEED_HISTORY_LEN) {
      this.speedHistory.shift();
    }

    this.emitTelemetry();
  }

  async addDownload(req: AddDownloadRequest): Promise<DownloadItem> {
    const validation = validateDownloadUrl(req.url);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    let inspected = req.inspected || null;
    if (!inspected) {
      if (req.skipInspect) {
        const normalizedUrl = validation.url.toString();
        const mime = (req.mimeType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
        const inferred = req.filename?.trim()
          ? sanitizeFilename(req.filename.trim())
          : inferFilename(normalizedUrl, undefined, mime);
        inspected = {
          url: normalizedUrl,
          finalUrl: normalizedUrl,
          filename: inferred,
          mimeType: mime || 'application/octet-stream',
          category: detectCategory(inferred, mime),
          totalBytes:
            req.totalBytes !== undefined && req.totalBytes !== null && req.totalBytes > 0
              ? req.totalBytes
              : null,
          resumable: true,
          etag: null,
          lastModified: null,
          thumbnailUrl: null,
        };
      } else {
        inspected = await inspectUrl(req.url, req.requestHeaders);
      }
    }

    const saveDir = (req.saveDir || this.settings.defaultDownloadDir).trim();
    const writable = checkDirectoryWritable(saveDir);
    if (!writable.ok) {
      throw new Error(writable.error);
    }

    // Pre-check disk space if file size is known
    if (inspected.totalBytes && inspected.totalBytes > 0) {
      const space = await getDiskSpace(saveDir);
      if (space && space.freeBytes < inspected.totalBytes + 1024 * 1024) {
        throw new Error(
          `Insufficient disk space on drive. Required: ${(inspected.totalBytes / 1048576).toFixed(1)} MB, Available: ${(space.freeBytes / 1048576).toFixed(1)} MB.`
        );
      }
    }

    const reservedPaths = new Set<string>();
    for (const existing of this.items.values()) {
      if (existing.status !== 'cancelled') {
        reservedPaths.add(existing.filePath.toLowerCase());
      }
    }

    const desiredName = req.filename?.trim()
      ? sanitizeFilename(req.filename.trim())
      : inspected.filename;

    const { filename, filePath, partPath } = resolveUniqueFilePath(
      saveDir,
      desiredName,
      reservedPaths
    );

    const now = Date.now();
    const id = crypto.randomUUID();
    const item: DownloadItem = {
      id,
      url: inspected.url,
      finalUrl: inspected.finalUrl,
      filename,
      saveDir,
      filePath,
      partPath,
      mimeType: inspected.mimeType,
      category: detectCategory(filename, inspected.mimeType),
      totalBytes: inspected.totalBytes,
      downloadedBytes: 0,
      speed: 0,
      progress: 0,
      etaSeconds: null,
      status: 'queued',
      resumable: inspected.resumable,
      etag: inspected.etag,
      lastModified: inspected.lastModified,
      error: null,
      retryCount: 0,
      maxRetries: this.settings.maxRetries,
      thumbnailUrl: inspected.thumbnailUrl,
      requestHeaders: req.requestHeaders || null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    this.items.set(id, item);
    this.db.upsertDownload(item, true);
    this.emitTelemetry();

    if (req.startImmediately !== false) {
      this.processQueue();
    }

    return item;
  }

  private getActiveWorkerCount(): number {
    return this.workers.size;
  }

  private processQueue(): void {
    const maxConcurrent = this.settings.maxConcurrentDownloads;
    if (this.getActiveWorkerCount() >= maxConcurrent) return;

    // FIFO order among queued items (oldest createdAt first), skipping items waiting in retry backoff
    const queued = Array.from(this.items.values())
      .filter((i) => i.status === 'queued' && !this.retryTimers.has(i.id))
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const item of queued) {
      if (this.getActiveWorkerCount() >= maxConcurrent) break;
      this.startWorker(item);
    }
  }

  startDownload(id: string): void {
    const item = this.items.get(id);
    if (!item) return;
    if (item.status === 'downloading' || item.status === 'completed') return;

    this.clearRetryTimer(id);
    item.error = null;
    item.status = 'queued';
    item.updatedAt = Date.now();
    this.db.upsertDownload(item);
    this.emitTelemetry();
    this.processQueue();
  }

  async pauseDownload(id: string): Promise<void> {
    const item = this.items.get(id);
    if (!item) return;

    this.clearRetryTimer(id);

    const worker = this.workers.get(id);
    if (worker) {
      worker.abortedByUser = 'pause';
      await this.teardownWorker(worker);
      this.workers.delete(id);
    }

    if (item.status === 'downloading' || item.status === 'queued') {
      // Sync exact written bytes from segments or disk
      if (item.segments && item.totalBytes && areSegmentsValidForResume(item.segments, item.totalBytes)) {
        item.downloadedBytes = item.segments.reduce((acc, s) => acc + s.downloaded, 0);
      } else if (fs.existsSync(item.partPath)) {
        try {
          item.downloadedBytes = fs.statSync(item.partPath).size;
        } catch {
          // keep tracked value
        }
      }
      item.status = 'paused';
      item.speed = 0;
      item.etaSeconds = null;
      item.activeConnections = 0;
      item.updatedAt = Date.now();
      this.db.upsertDownload(item, true);
      this.emitTelemetry();
      this.processQueue();
    }
  }

  resumeDownload(id: string): void {
    const item = this.items.get(id);
    if (!item) return;
    if (item.status !== 'paused' && item.status !== 'failed' && item.status !== 'cancelled') {
      return;
    }

    this.clearRetryTimer(id);
    item.error = null;
    item.retryCount = 0;
    item.maxRetries = this.settings.maxRetries;
    item.status = 'queued';
    item.updatedAt = Date.now();
    this.db.upsertDownload(item, true);
    this.emitTelemetry();
    this.processQueue();
  }

  retryDownload(id: string): void {
    const item = this.items.get(id);
    if (!item) return;
    this.clearRetryTimer(id);
    item.error = null;
    item.retryCount = 0;
    item.maxRetries = this.settings.maxRetries;
    item.status = 'queued';
    item.updatedAt = Date.now();
    this.db.upsertDownload(item, true);
    this.emitTelemetry();
    this.processQueue();
  }

  async cancelDownload(id: string): Promise<void> {
    const item = this.items.get(id);
    if (!item) return;

    this.clearRetryTimer(id);

    const worker = this.workers.get(id);
    if (worker) {
      worker.abortedByUser = 'cancel';
      await this.teardownWorker(worker);
      this.workers.delete(id);
    }

    this.safeUnlink(item.partPath);

    item.status = 'cancelled';
    item.speed = 0;
    item.etaSeconds = null;
    item.downloadedBytes = 0;
    item.progress = 0;
    item.segments = null;
    item.activeConnections = 0;
    item.error = null;
    item.updatedAt = Date.now();
    this.db.upsertDownload(item, true);
    this.emitTelemetry();
    this.processQueue();
  }

  async removeDownload(id: string, deleteFile = false): Promise<void> {
    const item = this.items.get(id);
    if (!item) return;

    this.clearRetryTimer(id);

    const worker = this.workers.get(id);
    if (worker) {
      worker.abortedByUser = 'cancel';
      await this.teardownWorker(worker);
      this.workers.delete(id);
    }

    this.safeUnlink(item.partPath);
    if (deleteFile) {
      this.safeUnlink(item.filePath);
    }

    this.items.delete(id);
    this.db.deleteDownload(id);
    this.emitTelemetry();
    this.processQueue();
  }

  async pauseAll(): Promise<void> {
    const targets = Array.from(this.items.values()).filter(
      (i) => i.status === 'downloading' || i.status === 'queued'
    );
    for (const item of targets) {
      await this.pauseDownload(item.id);
    }
  }

  resumeAll(): void {
    const targets = Array.from(this.items.values())
      .filter((i) => i.status === 'paused')
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const item of targets) {
      item.error = null;
      item.status = 'queued';
      item.updatedAt = Date.now();
      this.db.upsertDownload(item);
    }
    this.db.flushImmediate();
    this.emitTelemetry();
    this.processQueue();
  }

  clearCompleted(): void {
    const completed = Array.from(this.items.values()).filter((i) => i.status === 'completed');
    for (const item of completed) {
      this.items.delete(item.id);
      this.db.deleteDownload(item.id);
    }
    this.emitTelemetry();
  }

  async shutdown(): Promise<void> {
    if (this.telemetryTimer) {
      clearInterval(this.telemetryTimer);
      this.telemetryTimer = null;
    }
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
      this.progressTimer = null;
    }

    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();

    const activeWorkers = Array.from(this.workers.values());
    for (const worker of activeWorkers) {
      worker.abortedByUser = 'shutdown';
      await this.teardownWorker(worker);
      const item = this.items.get(worker.id);
      if (item && item.status === 'downloading') {
        if (item.segments && item.totalBytes && areSegmentsValidForResume(item.segments, item.totalBytes)) {
          item.downloadedBytes = item.segments.reduce((acc, s) => acc + s.downloaded, 0);
        } else if (fs.existsSync(item.partPath)) {
          try {
            item.downloadedBytes = fs.statSync(item.partPath).size;
          } catch {
            // ignore
          }
        }
        item.status = 'paused';
        item.speed = 0;
        item.etaSeconds = null;
        item.activeConnections = 0;
        this.db.upsertDownload(item);
      }
    }
    this.workers.clear();
    this.db.flushImmediate();
  }

  private clearRetryTimer(id: string): void {
    const existing = this.retryTimers.get(id);
    if (existing) {
      clearTimeout(existing);
      this.retryTimers.delete(id);
    }
  }

  private safeUnlink(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // ignore cleanup failures
    }
  }

  private async teardownWorker(worker: ActiveWorker): Promise<void> {
    if (worker.segmented) {
      const seg = worker.segmented;
      worker.segmented = null;
      await seg.abort();
    }

    return new Promise((resolve) => {
      try {
        if (worker.req) {
          worker.req.destroy();
          worker.req = null;
        }
      } catch {
        // ignore
      }
      try {
        if (worker.res) {
          worker.res.unpipe();
          worker.res.destroy();
          worker.res = null;
        }
      } catch {
        // ignore
      }
      try {
        if (worker.throttle) {
          worker.throttle.unpipe();
          worker.throttle.destroy();
          worker.throttle = null;
        }
      } catch {
        // ignore
      }
      const ws = worker.writeStream;
      worker.writeStream = null;
      if (ws && !ws.closed) {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        ws.once('close', finish);
        ws.once('error', finish);
        ws.end();
        setTimeout(finish, 1000);
      } else {
        resolve();
      }
    });
  }

  private getPerDownloadRateLimit(): number {
    const globalLimit = this.settings.speedLimitBytesPerSec;
    if (!globalLimit || globalLimit <= 0) return 0;
    const active = Math.max(1, this.workers.size);
    return Math.max(4096, Math.floor(globalLimit / active));
  }

  private getPerConnectionRateLimit(worker: ActiveWorker): number {
    const downloadLimit = this.getPerDownloadRateLimit();
    if (!downloadLimit || downloadLimit <= 0) return 0;
    const conns = Math.max(1, worker.segmented?.getActiveConnectionCount() || 1);
    return Math.max(4096, Math.floor(downloadLimit / conns));
  }

  private startWorker(item: DownloadItem): void {
    if (this.workers.has(item.id)) return;

    const writable = checkDirectoryWritable(item.saveDir);
    if (!writable.ok) {
      this.handleWorkerFailure(item, writable.error, false);
      return;
    }

    const desiredConnections = Math.max(1, Math.min(16, this.settings.connectionsPerDownload || 8));
    const hasValidSavedSegments =
      item.totalBytes !== null &&
      fs.existsSync(item.partPath) &&
      areSegmentsValidForResume(item.segments, item.totalBytes);

    const canUseSegmented =
      hasValidSavedSegments ||
      (desiredConnections > 1 &&
        item.resumable &&
        item.totalBytes !== null &&
        item.totalBytes >= MIN_SEGMENT_SIZE * 2 &&
        (!fs.existsSync(item.partPath) || item.downloadedBytes === 0));

    if (canUseSegmented && item.totalBytes !== null) {
      item.status = 'downloading';
      item.error = null;
      item.speed = 0;
      item.updatedAt = Date.now();
      this.db.upsertDownload(item, true);

      const worker: ActiveWorker = {
        id: item.id,
        req: null,
        res: null,
        writeStream: null,
        throttle: null,
        segmented: null,
        abortedByUser: null,
        bytesSinceLastTick: 0,
        smoothedSpeed: 0,
      };

      const segmented = new SegmentedWorker(item, {
        getPerConnectionSpeedLimit: () => this.getPerConnectionRateLimit(worker),
        getAutoRetry: () => this.settings.autoRetry,
        onBytesWritten: (deltaBytes, totalDownloaded) => {
          if (worker.abortedByUser) return;
          item.downloadedBytes = totalDownloaded;
          worker.bytesSinceLastTick += deltaBytes;
        },
        onActiveConnectionsChange: (activeCount) => {
          item.activeConnections = activeCount;
        },
        onFallbackToSingle: () => {
          if (worker.abortedByUser) return;
          worker.segmented = null;
          item.activeConnections = 1;
          this.connectAndStream(
            item,
            worker,
            item.finalUrl || item.url,
            0,
            MAX_REDIRECTS,
            item.requestHeaders?.cookie
          );
        },
        onComplete: () => {
          if (worker.abortedByUser) return;
          this.workers.delete(item.id);
          item.segments = null;
          item.activeConnections = 0;
          this.finalizeDownload(item);
        },
        onError: (message, retryable) => {
          if (worker.abortedByUser) return;
          this.workers.delete(item.id);
          item.activeConnections = 0;
          this.handleWorkerFailure(item, message, retryable);
        },
      });

      worker.segmented = segmented;
      this.workers.set(item.id, worker);
      this.emitTelemetry();

      void segmented.start(desiredConnections);
      return;
    }

    // Single-connection mode (non-Range, small files, or unknown totalBytes)
    item.segments = null;
    let startOffset = 0;
    if (fs.existsSync(item.partPath)) {
      try {
        const stat = fs.statSync(item.partPath);
        startOffset = stat.size;
      } catch {
        startOffset = 0;
      }
    }

    // Guard against stale or oversized .part files
    if (item.totalBytes !== null && startOffset > item.totalBytes) {
      this.safeUnlink(item.partPath);
      startOffset = 0;
    } else if (item.totalBytes !== null && item.totalBytes > 0 && startOffset === item.totalBytes) {
      // Already completely downloaded on disk — finalize directly!
      this.finalizeDownload(item);
      return;
    }

    item.downloadedBytes = startOffset;
    item.status = 'downloading';
    item.activeConnections = 1;
    item.error = null;
    item.speed = 0;
    item.updatedAt = Date.now();
    this.db.upsertDownload(item, true);

    const worker: ActiveWorker = {
      id: item.id,
      req: null,
      res: null,
      writeStream: null,
      throttle: null,
      segmented: null,
      abortedByUser: null,
      bytesSinceLastTick: 0,
      smoothedSpeed: 0,
    };

    this.workers.set(item.id, worker);
    this.emitTelemetry();

    this.connectAndStream(
      item,
      worker,
      item.finalUrl || item.url,
      startOffset,
      MAX_REDIRECTS,
      item.requestHeaders?.cookie
    );
  }

  private connectAndStream(
    item: DownloadItem,
    worker: ActiveWorker,
    targetUrl: string,
    startOffset: number,
    redirectsLeft: number,
    cookieHeader?: string
  ): void {
    if (worker.abortedByUser) return;

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      this.finishWorkerWithError(item, worker, 'Invalid download URL.', false);
      return;
    }

    const headers: Record<string, string> = {
      'User-Agent': item.requestHeaders?.userAgent || USER_AGENT,
      Accept: '*/*',
      'Accept-Encoding': 'identity',
    };

    if (item.requestHeaders?.referer) {
      headers['Referer'] = item.requestHeaders.referer;
    }
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }

    if (startOffset > 0) {
      headers['Range'] = `bytes=${startOffset}-`;
      if (item.etag) {
        headers['If-Range'] = item.etag;
      } else if (item.lastModified) {
        headers['If-Range'] = item.lastModified;
      }
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(
      parsed,
      {
        method: 'GET',
        headers,
        timeout: SOCKET_TIMEOUT_MS,
      },
      async (res) => {
        if (worker.abortedByUser) {
          res.destroy();
          return;
        }

        const statusCode = res.statusCode || 0;
        const location = res.headers.location;

        // Handle HTTP redirects with cookie preservation
        if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
          res.resume();
          if (redirectsLeft <= 0) {
            this.finishWorkerWithError(item, worker, 'Too many HTTP redirects.', false);
            return;
          }
          try {
            const nextUrl = new URL(location, parsed).toString();
            const mergedCookie = mergeCookies(cookieHeader, res.headers['set-cookie']);
            item.finalUrl = nextUrl;
            this.connectAndStream(item, worker, nextUrl, startOffset, redirectsLeft - 1, mergedCookie);
          } catch {
            this.finishWorkerWithError(item, worker, 'Invalid redirect URL from server.', false);
          }
          return;
        }

        // Handle 416 Range Not Satisfiable by resetting part file and restarting cleanly once
        if (statusCode === 416 && startOffset > 0) {
          res.resume();
          this.safeUnlink(item.partPath);
          item.downloadedBytes = 0;
          this.connectAndStream(item, worker, targetUrl, 0, redirectsLeft, cookieHeader);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          res.resume();
          const httpErr = formatHttpError(statusCode);
          this.finishWorkerWithError(item, worker, httpErr.message, httpErr.retryable);
          return;
        }

        // Determine if server honored Range (206) or returned full file (200)
        let writeOffset = 0;
        let appendMode = false;

        if (statusCode === 206 && startOffset > 0) {
          const contentRange = String(res.headers['content-range'] || '');
          const match = contentRange.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
          if (match && Number(match[1]) === startOffset) {
            writeOffset = startOffset;
            appendMode = true;
            if (match[3] !== '*') {
              const parsedTotal = Number(match[3]);
              if (Number.isFinite(parsedTotal) && parsedTotal > 0) {
                item.totalBytes = parsedTotal;
              }
            }
            item.resumable = true;
          } else {
            // Unexpected range response — restart from 0 cleanly to prevent corruption
            writeOffset = 0;
            appendMode = false;
            this.safeUnlink(item.partPath);
          }
        } else {
          // 200 OK: full stream from byte 0
          writeOffset = 0;
          appendMode = false;
          const lenHeader = res.headers['content-length'];
          if (lenHeader !== undefined) {
            const parsedLen = Number(lenHeader);
            if (Number.isFinite(parsedLen) && parsedLen >= 0) {
              item.totalBytes = parsedLen;
            }
          }
          if (String(res.headers['accept-ranges'] || '').toLowerCase() === 'bytes') {
            item.resumable = true;
          }
        }

        // Update metadata from actual GET response headers
        if (res.headers.etag) item.etag = String(res.headers.etag);
        if (res.headers['last-modified']) item.lastModified = String(res.headers['last-modified']);
        if (res.headers['content-type']) {
          item.mimeType = String(res.headers['content-type']).split(';')[0].trim().toLowerCase();
          item.category = detectCategory(item.filename, item.mimeType);
        }

        // If starting fresh (offset 0) and server sent a better Content-Disposition filename, adopt it
        if (!appendMode && writeOffset === 0 && res.headers['content-disposition']) {
          const dispName = extractFilenameFromDisposition(String(res.headers['content-disposition']));
          if (dispName && dispName !== item.filename && !fs.existsSync(item.partPath)) {
            const reserved = new Set<string>();
            for (const other of this.items.values()) {
              if (other.id !== item.id && other.status !== 'cancelled') {
                reserved.add(other.filePath.toLowerCase());
              }
            }
            const unique = resolveUniqueFilePath(item.saveDir, dispName, reserved);
            item.filename = unique.filename;
            item.filePath = unique.filePath;
            item.partPath = unique.partPath;
            item.category = detectCategory(item.filename, item.mimeType);
            this.db.upsertDownload(item);
          }
        }

        // Pause response stream explicitly before async disk-space check
        res.pause();

        // Check disk space for remaining bytes
        if (item.totalBytes !== null) {
          const remainingBytes = Math.max(0, item.totalBytes - writeOffset);
          const space = await getDiskSpace(item.saveDir);
          if (space && space.freeBytes < remainingBytes + 1024 * 1024) {
            res.destroy();
            this.finishWorkerWithError(
              item,
              worker,
              `Insufficient disk space on target drive. Need ${(remainingBytes / 1048576).toFixed(1)} MB more.`,
              false
            );
            return;
          }
        }

        if (worker.abortedByUser) {
          res.destroy();
          return;
        }

        item.downloadedBytes = writeOffset;
        worker.res = res;

        let writeStream: fs.WriteStream;
        try {
          writeStream = fs.createWriteStream(item.partPath, {
            flags: appendMode ? 'a' : 'w',
            highWaterMark: 256 * 1024,
          });
        } catch (err: any) {
          res.destroy();
          const classified = classifyError(err);
          this.finishWorkerWithError(item, worker, classified.message, classified.retryable);
          return;
        }

        worker.writeStream = writeStream;
        const throttle = new DynamicThrottleStream(() => this.getPerDownloadRateLimit());
        worker.throttle = throttle;

        let streamEndedNormally = false;
        let settled = false;

        const failStream = (err: any) => {
          if (settled || worker.abortedByUser) return;
          settled = true;
          const classified = classifyError(err);
          this.finishWorkerWithError(item, worker, classified.message, classified.retryable);
        };

        res.on('error', failStream);
        throttle.on('error', failStream);
        writeStream.on('error', failStream);

        res.on('aborted', () => {
          if (settled || worker.abortedByUser) return;
          settled = true;
          this.finishWorkerWithError(
            item,
            worker,
            'Connection was interrupted before the download finished.',
            true
          );
        });

        res.on('end', () => {
          streamEndedNormally = true;
        });

        throttle.on('data', (chunk: Buffer) => {
          if (worker.abortedByUser) return;
          item.downloadedBytes += chunk.length;
          worker.bytesSinceLastTick += chunk.length;
        });

        writeStream.on('finish', () => {
          if (settled || worker.abortedByUser) return;
          settled = true;

          // Verify stream ended cleanly & actual file size matches expected Content-Length
          if (!streamEndedNormally) {
            this.finishWorkerWithError(
              item,
              worker,
              'Download stream closed unexpectedly before completion.',
              true
            );
            return;
          }

          let actualDiskSize = 0;
          try {
            actualDiskSize = fs.statSync(item.partPath).size;
          } catch (err: any) {
            this.finishWorkerWithError(
              item,
              worker,
              `Failed to verify downloaded file on disk: ${err?.message || 'Unknown error'}`,
              false
            );
            return;
          }

          if (item.totalBytes !== null && actualDiskSize !== item.totalBytes) {
            item.downloadedBytes = actualDiskSize;
            this.finishWorkerWithError(
              item,
              worker,
              `Incomplete download: received ${actualDiskSize} of ${item.totalBytes} bytes. File was not marked complete.`,
              true
            );
            return;
          }

          // Success! Clean up worker and atomically rename .part -> final file
          this.workers.delete(item.id);
          item.downloadedBytes = actualDiskSize;
          if (item.totalBytes === null) {
            item.totalBytes = actualDiskSize;
          }
          this.finalizeDownload(item);
        });

        res.pipe(throttle).pipe(writeStream);
      }
    );

    worker.req = req;

    req.on('timeout', () => {
      if (worker.abortedByUser) return;
      req.destroy(new Error('Connection timed out while downloading file.'));
    });

    req.on('error', (err) => {
      if (worker.abortedByUser) return;
      const classified = classifyError(err);
      this.finishWorkerWithError(item, worker, classified.message, classified.retryable);
    });

    req.end();
  }

  private finalizeDownload(item: DownloadItem): void {
    try {
      // Ensure target destination doesn't overwrite an unrelated file created mid-download
      let finalPath = item.filePath;
      let finalFilename = item.filename;
      if (fs.existsSync(finalPath)) {
        const unique = resolveUniqueFilePath(item.saveDir, item.filename);
        finalPath = unique.filePath;
        finalFilename = unique.filename;
      }

      fs.renameSync(item.partPath, finalPath);

      item.filePath = finalPath;
      item.filename = finalFilename;
      item.status = 'completed';
      item.progress = 100;
      item.speed = 0;
      item.etaSeconds = 0;
      item.segments = null;
      item.activeConnections = 0;
      item.error = null;
      item.completedAt = Date.now();
      item.updatedAt = Date.now();

      this.db.upsertDownload(item, true);
      this.emitTelemetry();
      this.emit('completed', { ...item });
      this.processQueue();
    } catch (err: any) {
      const classified = classifyError(err);
      this.handleWorkerFailure(item, `Could not finalize file: ${classified.message}`, false);
    }
  }

  private async finishWorkerWithError(
    item: DownloadItem,
    worker: ActiveWorker,
    message: string,
    retryable: boolean
  ): Promise<void> {
    if (worker.abortedByUser) return;
    await this.teardownWorker(worker);
    this.workers.delete(item.id);

    // Sync exact bytes saved on disk so resume is accurate
    if (fs.existsSync(item.partPath)) {
      try {
        item.downloadedBytes = fs.statSync(item.partPath).size;
      } catch {
        // ignore
      }
    }

    this.handleWorkerFailure(item, message, retryable);
  }

  private handleWorkerFailure(item: DownloadItem, message: string, retryable: boolean): void {
    item.speed = 0;
    item.etaSeconds = null;
    item.activeConnections = 0;
    item.updatedAt = Date.now();

    if (retryable && this.settings.autoRetry && item.retryCount < item.maxRetries) {
      item.retryCount += 1;
      const delayMs = Math.min(15000, 2000 * Math.pow(2, item.retryCount - 1));
      item.status = 'queued';
      item.error = `${message} (Retrying ${item.retryCount}/${item.maxRetries} in ${Math.round(delayMs / 1000)}s...)`;
      this.db.upsertDownload(item, true);
      this.emitTelemetry();

      this.clearRetryTimer(item.id);
      const timer = setTimeout(() => {
        this.retryTimers.delete(item.id);
        const current = this.items.get(item.id);
        if (current && current.status === 'queued') {
          this.processQueue();
        }
      }, delayMs);
      this.retryTimers.set(item.id, timer);
      return;
    }

    item.status = 'failed';
    item.error = message;
    this.db.upsertDownload(item, true);
    this.emitTelemetry();
    this.emit('failed', { ...item });
    this.processQueue();
  }
}
