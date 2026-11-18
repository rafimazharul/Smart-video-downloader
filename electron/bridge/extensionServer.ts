import http from 'http';
import { DownloadManager } from '../engine/downloadManager';
import { DownloadItem } from '../types';

export const EXTENSION_BRIDGE_PORT = 48921;
const MAX_BODY_BYTES = 64 * 1024;
const RETRY_INTERVAL_MS = 2000;

interface CaptureRequestBody {
  url?: string;
  filename?: string;
  referrer?: string;
  cookie?: string;
  userAgent?: string;
  mimeType?: string;
  totalBytes?: number | null;
  skipInspect?: boolean;
}

export class ExtensionBridgeServer {
  private server: http.Server | null = null;
  private manager: DownloadManager;
  private port: number;
  private onCaptured?: (item: DownloadItem) => void;
  private onStatusChange?: (running: boolean) => void;
  private listening = false;
  private stopped = false;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(
    manager: DownloadManager,
    onCaptured?: (item: DownloadItem) => void,
    onStatusChange?: (running: boolean) => void,
    port: number = EXTENSION_BRIDGE_PORT
  ) {
    this.manager = manager;
    this.onCaptured = onCaptured;
    this.onStatusChange = onStatusChange;
    this.port = port;
  }

  isRunning(): boolean {
    return this.listening;
  }

  start(): Promise<boolean> {
    this.stopped = false;
    this.clearRetryTimer();
    return this.tryBind();
  }

  async restart(): Promise<boolean> {
    await this.stop();
    return this.start();
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private scheduleRetry(): void {
    if (this.stopped || this.listening || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped && !this.listening) {
        void this.tryBind();
      }
    }, RETRY_INTERVAL_MS);
  }

  private tryBind(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.stopped) {
        resolve(false);
        return;
      }
      if (this.server && this.listening) {
        resolve(true);
        return;
      }

      if (this.server) {
        try {
          this.server.close();
        } catch {
          // ignore
        }
        this.server = null;
      }

      const srv = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      let settled = false;

      srv.on('error', (err: any) => {
        console.error('Extension bridge server error:', err?.message || err);
        this.listening = false;
        this.onStatusChange?.(false);

        if (this.server === srv) {
          this.server = null;
        }
        try {
          srv.close();
        } catch {
          // ignore
        }

        // Automatically retry if another instance was still releasing the port
        if (err?.code === 'EADDRINUSE' && !this.stopped) {
          this.scheduleRetry();
        }

        if (!settled) {
          settled = true;
          resolve(false);
        }
      });

      this.server = srv;
      srv.listen(this.port, '127.0.0.1', () => {
        this.listening = true;
        this.clearRetryTimer();
        this.onStatusChange?.(true);
        if (!settled) {
          settled = true;
          resolve(true);
        }
      });
    });
  }

  stop(): Promise<void> {
    this.stopped = true;
    this.clearRetryTimer();
    return new Promise((resolve) => {
      if (!this.server) {
        this.listening = false;
        resolve();
        return;
      }
      const srv = this.server;
      this.server = null;
      this.listening = false;
      this.onStatusChange?.(false);
      srv.close(() => resolve());
    });
  }

  private isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    return (
      origin.startsWith('chrome-extension://') ||
      origin.startsWith('edge-extension://') ||
      origin.startsWith('moz-extension://')
    );
  }

  private buildCorsHeaders(origin?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Cache-Control': 'no-store',
    };
    if (origin && this.isAllowedOrigin(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Headers'] = 'Content-Type, X-SmartDM-Client';
      headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
      headers['Access-Control-Allow-Private-Network'] = 'true';
      headers['Access-Control-Max-Age'] = '600';
    }
    return headers;
  }

  private sendJson(
    res: http.ServerResponse,
    statusCode: number,
    payload: Record<string, any>,
    origin?: string
  ): void {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      ...this.buildCorsHeaders(origin),
    };
    res.writeHead(statusCode, headers);
    res.end(JSON.stringify(payload));
  }

  private readJsonBody(req: http.IncomingMessage): Promise<CaptureRequestBody> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;

      req.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_BODY_BYTES) {
          req.destroy();
          reject(new Error('Request payload too large.'));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8').trim();
          resolve(text ? (JSON.parse(text) as CaptureRequestBody) : {});
        } catch {
          reject(new Error('Invalid JSON payload.'));
        }
      });

      req.on('error', reject);
    });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const origin = req.headers.origin;
    const method = (req.method || 'GET').toUpperCase();
    const urlPath = (req.url || '/').split('?')[0];

    // Strict origin guard so arbitrary websites cannot contact the local bridge
    if (!this.isAllowedOrigin(origin)) {
      this.sendJson(res, 403, { ok: false, error: 'Forbidden origin.' });
      return;
    }

    if (method === 'OPTIONS') {
      res.writeHead(204, this.buildCorsHeaders(origin));
      res.end();
      return;
    }

    const clientHeader = String(req.headers['x-smartdm-client'] || '');
    if (clientHeader !== 'browser-extension') {
      this.sendJson(res, 403, { ok: false, error: 'Missing extension client header.' }, origin);
      return;
    }

    if (method === 'GET' && urlPath === '/health') {
      const telemetry = this.manager.getTelemetryPayload();
      this.sendJson(
        res,
        200,
        {
          ok: true,
          app: 'Smart Video Downloader',
          version: '1.0.0',
          port: this.port,
          activeCount: telemetry.activeCount,
          totalSpeedBytesPerSec: telemetry.totalSpeedBytesPerSec,
          totalDownloads: telemetry.downloads.length,
        },
        origin
      );
      return;
    }

    if (method === 'POST' && urlPath === '/capture') {
      try {
        const body = await this.readJsonBody(req);
        if (!body.url || typeof body.url !== 'string') {
          this.sendJson(res, 400, { ok: false, error: 'Missing download URL.' }, origin);
          return;
        }

        const item = await this.manager.addDownload({
          url: body.url,
          filename: body.filename,
          mimeType: body.mimeType,
          totalBytes: typeof body.totalBytes === 'number' && body.totalBytes > 0 ? body.totalBytes : null,
          skipInspect: body.skipInspect !== false,
          startImmediately: true,
          requestHeaders: {
            referer: body.referrer || undefined,
            cookie: body.cookie || undefined,
            userAgent: body.userAgent || undefined,
          },
        });

        this.onCaptured?.(item);

        this.sendJson(
          res,
          200,
          {
            ok: true,
            id: item.id,
            filename: item.filename,
            status: item.status,
          },
          origin
        );
      } catch (err: any) {
        this.sendJson(
          res,
          400,
          { ok: false, error: err?.message || 'Failed to queue download.' },
          origin
        );
      }
      return;
    }

    this.sendJson(res, 404, { ok: false, error: 'Not found.' }, origin);
  }
}
