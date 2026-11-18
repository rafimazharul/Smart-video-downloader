import fs from 'fs';
import http from 'http';
import https from 'https';
import { DownloadItem, DownloadSegment } from '../types';
import { DynamicThrottleStream } from './throttle';
import { classifyError, formatHttpError, mergeCookies } from './utils';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_REDIRECTS = 10;
const SOCKET_TIMEOUT_MS = 30000;
const MAX_PENDING_BYTES_PER_SEG = 512 * 1024;
export const MIN_SEGMENT_SIZE = 256 * 1024;

// Shared keep-alive agents for fast parallel TCP/TLS connections
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 });

interface SegmentRuntime {
  segment: DownloadSegment;
  req: http.ClientRequest | null;
  res: http.IncomingMessage | null;
  throttle: DynamicThrottleStream | null;
  writeChain: Promise<void>;
  pendingBytes: number;
  retries: number;
  retryTimer: NodeJS.Timeout | null;
  active: boolean;
}

export interface SegmentedWorkerCallbacks {
  getPerConnectionSpeedLimit: () => number;
  getAutoRetry: () => boolean;
  onBytesWritten: (deltaBytes: number, totalDownloaded: number) => void;
  onActiveConnectionsChange: (activeCount: number) => void;
  onFallbackToSingle: () => void;
  onComplete: () => void;
  onError: (message: string, retryable: boolean) => void;
}

export function buildSegments(totalBytes: number, connections: number): DownloadSegment[] {
  const maxBySize = Math.floor(totalBytes / MIN_SEGMENT_SIZE);
  const count = Math.max(1, Math.min(connections, maxBySize));
  const baseSize = Math.floor(totalBytes / count);
  const segments: DownloadSegment[] = [];

  for (let i = 0; i < count; i++) {
    const start = i * baseSize;
    const end = i === count - 1 ? totalBytes - 1 : (i + 1) * baseSize - 1;
    segments.push({
      index: i,
      start,
      end,
      downloaded: 0,
      done: false,
    });
  }

  return segments;
}

export function areSegmentsValidForResume(
  segments: DownloadSegment[] | null | undefined,
  totalBytes: number
): segments is DownloadSegment[] {
  if (!Array.isArray(segments) || segments.length < 2) return false;
  let expectedStart = 0;
  for (const s of segments) {
    if (s.start !== expectedStart || s.end < s.start) return false;
    const len = s.end - s.start + 1;
    if (s.downloaded < 0 || s.downloaded > len) return false;
    expectedStart = s.end + 1;
  }
  return expectedStart === totalBytes;
}

export class SegmentedWorker {
  private item: DownloadItem;
  private callbacks: SegmentedWorkerCallbacks;
  private fileHandle: fs.promises.FileHandle | null = null;
  private runtimes: SegmentRuntime[] = [];
  private aborted = false;
  private finished = false;
  private fallbackTriggered = false;

  constructor(item: DownloadItem, callbacks: SegmentedWorkerCallbacks) {
    this.item = item;
    this.callbacks = callbacks;
  }

  getActiveConnectionCount(): number {
    let count = 0;
    for (const rt of this.runtimes) {
      if (rt.active) count += 1;
    }
    return count;
  }

  getTotalDownloaded(): number {
    let sum = 0;
    for (const rt of this.runtimes) {
      sum += rt.segment.downloaded;
    }
    return sum;
  }

  async start(connections: number): Promise<void> {
    const totalBytes = this.item.totalBytes;
    if (!totalBytes || totalBytes < MIN_SEGMENT_SIZE * 2) {
      this.callbacks.onFallbackToSingle();
      return;
    }

    const canResume =
      fs.existsSync(this.item.partPath) &&
      areSegmentsValidForResume(this.item.segments, totalBytes);

    let segments: DownloadSegment[];
    if (canResume && this.item.segments) {
      segments = this.item.segments.map((s) => ({
        ...s,
        done: s.downloaded >= s.end - s.start + 1,
      }));
    } else {
      segments = buildSegments(totalBytes, connections);
    }

    this.item.segments = segments;
    this.item.downloadedBytes = segments.reduce((acc, s) => acc + s.downloaded, 0);

    try {
      this.fileHandle = await fs.promises.open(this.item.partPath, canResume ? 'r+' : 'w+');
    } catch (err: any) {
      const classified = classifyError(err);
      this.callbacks.onError(classified.message, classified.retryable);
      return;
    }

    if (this.aborted) {
      await this.closeHandle();
      return;
    }

    this.runtimes = segments.map((segment) => ({
      segment,
      req: null,
      res: null,
      throttle: null,
      writeChain: Promise.resolve(),
      pendingBytes: 0,
      retries: 0,
      retryTimer: null,
      active: false,
    }));

    const incomplete = this.runtimes.filter((rt) => !rt.segment.done);
    if (incomplete.length === 0) {
      await this.verifyAndComplete();
      return;
    }

    for (const rt of incomplete) {
      this.launchSegment(rt, this.item.finalUrl || this.item.url, MAX_REDIRECTS, this.item.requestHeaders?.cookie);
    }
  }

  async abort(): Promise<void> {
    if (this.aborted) return;
    this.aborted = true;

    for (const rt of this.runtimes) {
      if (rt.retryTimer) {
        clearTimeout(rt.retryTimer);
        rt.retryTimer = null;
      }
      rt.active = false;
      try {
        rt.req?.destroy();
      } catch {
        // ignore
      }
      try {
        rt.res?.unpipe();
        rt.res?.destroy();
      } catch {
        // ignore
      }
      try {
        rt.throttle?.destroy();
      } catch {
        // ignore
      }
      rt.req = null;
      rt.res = null;
      rt.throttle = null;
    }

    this.callbacks.onActiveConnectionsChange(0);

    // Wait for all in-flight positional disk writes to flush before closing FileHandle
    await Promise.allSettled(this.runtimes.map((rt) => rt.writeChain));
    await this.closeHandle();
  }

  private async closeHandle(): Promise<void> {
    const fh = this.fileHandle;
    this.fileHandle = null;
    if (fh) {
      try {
        await fh.close();
      } catch {
        // ignore
      }
    }
  }

  private notifyActiveCount(): void {
    this.callbacks.onActiveConnectionsChange(this.getActiveConnectionCount());
  }

  private launchSegment(
    rt: SegmentRuntime,
    targetUrl: string,
    redirectsLeft: number,
    cookieHeader?: string
  ): void {
    if (this.aborted || this.finished || this.fallbackTriggered) return;

    rt.pendingBytes = 0;
    const seg = rt.segment;
    const rangeStart = seg.start + seg.downloaded;
    if (rangeStart > seg.end) {
      seg.done = true;
      rt.active = false;
      this.notifyActiveCount();
      void this.checkAllDone();
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      void this.failFatal('Invalid download URL.', false);
      return;
    }

    const headers: Record<string, string> = {
      'User-Agent': this.item.requestHeaders?.userAgent || USER_AGENT,
      Accept: '*/*',
      'Accept-Encoding': 'identity',
      Range: `bytes=${rangeStart}-${seg.end}`,
    };

    if (this.item.requestHeaders?.referer) {
      headers['Referer'] = this.item.requestHeaders.referer;
    }
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }
    if (this.item.etag) {
      headers['If-Range'] = this.item.etag;
    } else if (this.item.lastModified) {
      headers['If-Range'] = this.item.lastModified;
    }

    rt.active = true;
    this.notifyActiveCount();

    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    const req = client.request(
      parsed,
      {
        method: 'GET',
        headers,
        agent: isHttps ? httpsAgent : httpAgent,
        timeout: SOCKET_TIMEOUT_MS,
      },
      (res) => {
        if (this.aborted || this.finished || this.fallbackTriggered) {
          res.destroy();
          return;
        }

        const statusCode = res.statusCode || 0;
        const location = res.headers.location;

        if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
          res.resume();
          if (redirectsLeft <= 0) {
            void this.failFatal('Too many HTTP redirects.', false);
            return;
          }
          try {
            const nextUrl = new URL(location, parsed).toString();
            const mergedCookie = mergeCookies(cookieHeader, res.headers['set-cookie']);
            this.item.finalUrl = nextUrl;
            this.launchSegment(rt, nextUrl, redirectsLeft - 1, mergedCookie);
          } catch {
            void this.failFatal('Invalid redirect URL from server.', false);
          }
          return;
        }

        // Server ignored Range and returned 200 OK -> cleanly fall back to single-connection mode!
        if (statusCode === 200) {
          res.destroy();
          void this.triggerFallbackToSingle();
          return;
        }

        if (statusCode !== 206) {
          res.resume();
          const httpErr = formatHttpError(statusCode);
          this.handleSegmentError(rt, httpErr.message, httpErr.retryable);
          return;
        }

        // Verify Content-Range matches our requested rangeStart
        const contentRange = String(res.headers['content-range'] || '');
        const rangeMatch = contentRange.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
        if (rangeMatch && Number(rangeMatch[1]) !== rangeStart) {
          res.destroy();
          void this.triggerFallbackToSingle();
          return;
        }

        rt.res = res;

        // Zero-overhead fast path when unlimited; throttle stream only when a speed cap is set
        const limit = this.callbacks.getPerConnectionSpeedLimit();
        let sourceStream: NodeJS.ReadableStream = res;
        if (limit > 0) {
          const throttle = new DynamicThrottleStream(() =>
            this.callbacks.getPerConnectionSpeedLimit()
          );
          rt.throttle = throttle;
          res.pipe(throttle);
          sourceStream = throttle;
        }

        let streamEnded = false;
        let segmentSettled = false;

        const onStreamFailure = (err: any) => {
          if (segmentSettled || this.aborted || this.finished || this.fallbackTriggered) return;
          segmentSettled = true;
          const classified = classifyError(err);
          this.handleSegmentError(rt, classified.message, classified.retryable);
        };

        res.on('error', onStreamFailure);
        if (rt.throttle) {
          rt.throttle.on('error', onStreamFailure);
        }

        res.on('aborted', () => {
          if (segmentSettled || this.aborted || this.finished || this.fallbackTriggered) return;
          segmentSettled = true;
          this.handleSegmentError(
            rt,
            'Connection interrupted on download segment.',
            true
          );
        });

        sourceStream.on('data', (chunk: Buffer) => {
          if (this.aborted || this.finished || this.fallbackTriggered) return;

          const segTotal = seg.end - seg.start + 1;
          const remaining = segTotal - (seg.downloaded + rt.pendingBytes);
          if (remaining <= 0) {
            return;
          }

          const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
          const writeOffset = seg.start + seg.downloaded + rt.pendingBytes;
          rt.pendingBytes += slice.length;

          if (rt.pendingBytes >= MAX_PENDING_BYTES_PER_SEG) {
            sourceStream.pause();
          }

          rt.writeChain = rt.writeChain
            .then(async () => {
              if (this.aborted || !this.fileHandle) return;
              let writtenTotal = 0;
              while (writtenTotal < slice.length) {
                const result = await this.fileHandle.write(
                  slice,
                  writtenTotal,
                  slice.length - writtenTotal,
                  writeOffset + writtenTotal
                );
                writtenTotal += result.bytesWritten;
              }
              seg.downloaded += writtenTotal;
              rt.pendingBytes = Math.max(0, rt.pendingBytes - slice.length);
              this.callbacks.onBytesWritten(writtenTotal, this.getTotalDownloaded());

              if (
                !this.aborted &&
                rt.pendingBytes < MAX_PENDING_BYTES_PER_SEG / 2 &&
                !streamEnded
              ) {
                sourceStream.resume();
              }
            })
            .catch((err) => {
              onStreamFailure(err);
            });
        });

        sourceStream.on('end', () => {
          streamEnded = true;
          if (segmentSettled || this.aborted || this.finished || this.fallbackTriggered) return;

          rt.writeChain
            .then(() => {
              if (segmentSettled || this.aborted || this.finished || this.fallbackTriggered) return;
              segmentSettled = true;

              const expectedLen = seg.end - seg.start + 1;
              if (seg.downloaded < expectedLen) {
                // Premature EOF on this segment — retry this segment from exact written byte!
                this.handleSegmentError(
                  rt,
                  `Segment ${seg.index + 1} ended early (${seg.downloaded}/${expectedLen} bytes).`,
                  true
                );
                return;
              }

              seg.done = true;
              rt.active = false;
              rt.req = null;
              rt.res = null;
              rt.throttle = null;
              this.notifyActiveCount();
              void this.checkAllDone();
            })
            .catch((err) => {
              onStreamFailure(err);
            });
        });
      }
    );

    rt.req = req;

    req.on('timeout', () => {
      if (this.aborted || this.finished || this.fallbackTriggered) return;
      req.destroy(new Error('Segment connection timed out.'));
    });

    req.on('error', (err) => {
      if (this.aborted || this.finished || this.fallbackTriggered) return;
      const classified = classifyError(err);
      this.handleSegmentError(rt, classified.message, classified.retryable);
    });

    req.end();
  }

  private handleSegmentError(rt: SegmentRuntime, message: string, retryable: boolean): void {
    if (this.aborted || this.finished || this.fallbackTriggered) return;

    rt.active = false;
    try {
      rt.req?.destroy();
    } catch {
      // ignore
    }
    try {
      rt.res?.unpipe();
      rt.res?.destroy();
    } catch {
      // ignore
    }
    try {
      rt.throttle?.destroy();
    } catch {
      // ignore
    }
    rt.req = null;
    rt.res = null;
    rt.throttle = null;
    this.notifyActiveCount();

    // Retry ONLY this failed segment if retryable & within retry budget
    if (retryable && this.callbacks.getAutoRetry() && rt.retries < this.item.maxRetries) {
      rt.retries += 1;
      const delayMs = Math.min(10000, 1500 * Math.pow(2, rt.retries - 1));
      rt.retryTimer = setTimeout(() => {
        rt.retryTimer = null;
        if (!this.aborted && !this.finished && !this.fallbackTriggered) {
          // Wait for any pending write before re-requesting from exact byte offset
          void rt.writeChain.finally(() => {
            if (!this.aborted && !this.finished && !this.fallbackTriggered) {
              this.launchSegment(
                rt,
                this.item.finalUrl || this.item.url,
                MAX_REDIRECTS,
                this.item.requestHeaders?.cookie
              );
            }
          });
        }
      }, delayMs);
      return;
    }

    void this.failFatal(message, retryable);
  }

  private async triggerFallbackToSingle(): Promise<void> {
    if (this.fallbackTriggered || this.aborted || this.finished) return;
    this.fallbackTriggered = true;
    await this.abort();
    this.item.segments = null;
    this.item.resumable = false;
    this.item.downloadedBytes = 0;
    try {
      if (fs.existsSync(this.item.partPath)) {
        fs.unlinkSync(this.item.partPath);
      }
    } catch {
      // ignore
    }
    this.callbacks.onFallbackToSingle();
  }

  private async failFatal(message: string, retryable: boolean): Promise<void> {
    if (this.finished || this.aborted) return;
    this.finished = true;
    await this.abort();
    this.callbacks.onError(message, retryable);
  }

  private async checkAllDone(): Promise<void> {
    if (this.aborted || this.finished) return;
    if (this.runtimes.every((rt) => rt.segment.done)) {
      await this.verifyAndComplete();
    }
  }

  private async verifyAndComplete(): Promise<void> {
    if (this.aborted || this.finished) return;
    this.finished = true;

    await Promise.allSettled(this.runtimes.map((rt) => rt.writeChain));
    await this.closeHandle();

    const expectedTotal = this.item.totalBytes;
    const sumDownloaded = this.getTotalDownloaded();

    let diskSize = 0;
    try {
      diskSize = fs.statSync(this.item.partPath).size;
    } catch (err: any) {
      this.callbacks.onError(
        `Failed to verify downloaded file on disk: ${err?.message || 'Unknown error'}`,
        false
      );
      return;
    }

    if (expectedTotal !== null && (sumDownloaded !== expectedTotal || diskSize !== expectedTotal)) {
      this.callbacks.onError(
        `Incomplete multi-segment download: ${diskSize} of ${expectedTotal} bytes written.`,
        true
      );
      return;
    }

    this.item.downloadedBytes = diskSize;
    this.item.activeConnections = 0;
    this.callbacks.onComplete();
  }
}
