import fs from 'fs';
import path from 'path';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { AppSettings, DownloadItem } from '../types';

function resolveWasmFile(): string {
  const candidates = [
    path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    path.join(__dirname, '..', '..', '..', 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  ];

  if (process.resourcesPath) {
    candidates.unshift(
      path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'sql.js',
        'dist',
        'sql-wasm.wasm'
      )
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback to require.resolve
  try {
    return require.resolve('sql.js/dist/sql-wasm.wasm');
  } catch {
    return candidates[0];
  }
}

export class AppDatabase {
  private db!: SqlJsDatabase;
  private dbPath: string;
  private dirty = false;
  private closed = false;
  private flushing = false;
  private flushQueued = false;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async init(defaultDownloadDir: string): Promise<void> {
    const dir = path.dirname(this.dbPath);
    fs.mkdirSync(dir, { recursive: true });

    const wasmPath = resolveWasmFile();
    const SQL = await initSqlJs({
      locateFile: () => wasmPath,
    });

    if (fs.existsSync(this.dbPath)) {
      try {
        const buffer = fs.readFileSync(this.dbPath);
        this.db = new SQL.Database(new Uint8Array(buffer));
      } catch {
        // Backup corrupt DB and create fresh
        try {
          fs.renameSync(this.dbPath, `${this.dbPath}.bak.${Date.now()}`);
        } catch {
          // ignore
        }
        this.db = new SQL.Database();
      }
    } else {
      this.db = new SQL.Database();
    }

    this.createSchema();
    this.ensureDefaultSettings(defaultDownloadDir);
    this.flushImmediate();
  }

  private createSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS downloads (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        final_url TEXT NOT NULL,
        filename TEXT NOT NULL,
        save_dir TEXT NOT NULL,
        file_path TEXT NOT NULL,
        part_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        category TEXT NOT NULL,
        total_bytes INTEGER,
        downloaded_bytes INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        resumable INTEGER NOT NULL DEFAULT 0,
        etag TEXT,
        last_modified TEXT,
        error TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 3,
        thumbnail_url TEXT,
        request_headers TEXT,
        segments TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_downloads_created ON downloads(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Safe migrations for existing databases
    try {
      this.db.run('ALTER TABLE downloads ADD COLUMN request_headers TEXT');
    } catch {
      // Column already exists
    }
    try {
      this.db.run('ALTER TABLE downloads ADD COLUMN segments TEXT');
    } catch {
      // Column already exists
    }
  }

  private ensureDefaultSettings(defaultDownloadDir: string): void {
    const defaults: AppSettings = {
      defaultDownloadDir,
      maxConcurrentDownloads: 3,
      connectionsPerDownload: 8,
      speedLimitBytesPerSec: 0,
      autoRetry: true,
      maxRetries: 3,
      theme: 'dark',
      notificationsEnabled: true,
      clipboardMonitorEnabled: true,
      minimizeToTrayOnClose: true,
      launchAtStartup: false,
      startMinimized: false,
    };

    const existing = this.getSettingsRaw();
    for (const [key, val] of Object.entries(defaults)) {
      if (!(key in existing)) {
        this.setSettingKey(key, JSON.stringify(val));
      }
    }
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushAsync();
    }, 600);
  }

  async flushAsync(): Promise<void> {
    if (!this.db || this.closed) return;
    if (this.flushing) {
      this.flushQueued = true;
      return;
    }
    this.flushing = true;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      const tmpPath = `${this.dbPath}.tmp`;
      await fs.promises.writeFile(tmpPath, buffer);
      await fs.promises.rename(tmpPath, this.dbPath);
      this.dirty = false;
    } catch (err) {
      console.error('Failed to persist SQLite database:', err);
    } finally {
      this.flushing = false;
      if (this.flushQueued && !this.closed) {
        this.flushQueued = false;
        void this.flushAsync();
      }
    }
  }

  flushImmediate(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.db || this.closed) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      const tmpPath = `${this.dbPath}.tmp`;
      fs.writeFileSync(tmpPath, buffer);
      fs.renameSync(tmpPath, this.dbPath);
      this.dirty = false;
    } catch (err) {
      console.error('Failed to persist SQLite database:', err);
    }
  }

  close(): void {
    if (this.closed) return;
    if (this.dirty) {
      this.flushImmediate();
    }
    this.closed = true;
    if (this.db) {
      this.db.close();
    }
  }

  private setSettingKey(key: string, jsonValue: string): void {
    this.db.run(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, jsonValue]
    );
    this.scheduleFlush();
  }

  private getSettingsRaw(): Record<string, string> {
    const stmt = this.db.prepare('SELECT key, value FROM settings');
    const map: Record<string, string> = {};
    while (stmt.step()) {
      const row = stmt.getAsObject() as { key: string; value: string };
      map[row.key] = row.value;
    }
    stmt.free();
    return map;
  }

  getSettings(fallbackDir: string): AppSettings {
    const raw = this.getSettingsRaw();
    const parse = <T>(k: string, fallback: T): T => {
      if (!(k in raw)) return fallback;
      try {
        return JSON.parse(raw[k]) as T;
      } catch {
        return fallback;
      }
    };

    return {
      defaultDownloadDir: parse('defaultDownloadDir', fallbackDir),
      maxConcurrentDownloads: Math.max(1, Math.min(10, parse('maxConcurrentDownloads', 3))),
      connectionsPerDownload: Math.max(1, Math.min(16, parse('connectionsPerDownload', 8))),
      speedLimitBytesPerSec: Math.max(0, parse('speedLimitBytesPerSec', 0)),
      autoRetry: parse('autoRetry', true),
      maxRetries: Math.max(0, Math.min(10, parse('maxRetries', 3))),
      theme: parse<string>('theme', 'dark') === 'light' ? 'light' : 'dark',
      notificationsEnabled: parse('notificationsEnabled', true),
      clipboardMonitorEnabled: parse('clipboardMonitorEnabled', true),
      minimizeToTrayOnClose: parse('minimizeToTrayOnClose', true),
      launchAtStartup: parse('launchAtStartup', false),
      startMinimized: parse('startMinimized', false),
    };
  }

  updateSettings(patch: Partial<AppSettings>, fallbackDir: string): AppSettings {
    for (const [key, val] of Object.entries(patch)) {
      if (val !== undefined) {
        this.setSettingKey(key, JSON.stringify(val));
      }
    }
    this.flushImmediate();
    return this.getSettings(fallbackDir);
  }

  upsertDownload(item: DownloadItem, immediate = false): void {
    this.db.run(
      `INSERT INTO downloads (
        id, url, final_url, filename, save_dir, file_path, part_path,
        mime_type, category, total_bytes, downloaded_bytes, status,
        resumable, etag, last_modified, error, retry_count, max_retries,
        thumbnail_url, request_headers, segments, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        url = excluded.url,
        final_url = excluded.final_url,
        filename = excluded.filename,
        save_dir = excluded.save_dir,
        file_path = excluded.file_path,
        part_path = excluded.part_path,
        mime_type = excluded.mime_type,
        category = excluded.category,
        total_bytes = excluded.total_bytes,
        downloaded_bytes = excluded.downloaded_bytes,
        status = excluded.status,
        resumable = excluded.resumable,
        etag = excluded.etag,
        last_modified = excluded.last_modified,
        error = excluded.error,
        retry_count = excluded.retry_count,
        max_retries = excluded.max_retries,
        thumbnail_url = excluded.thumbnail_url,
        request_headers = excluded.request_headers,
        segments = excluded.segments,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at`,
      [
        item.id,
        item.url,
        item.finalUrl,
        item.filename,
        item.saveDir,
        item.filePath,
        item.partPath,
        item.mimeType,
        item.category,
        item.totalBytes,
        item.downloadedBytes,
        item.status,
        item.resumable ? 1 : 0,
        item.etag,
        item.lastModified,
        item.error,
        item.retryCount,
        item.maxRetries,
        item.thumbnailUrl,
        item.requestHeaders ? JSON.stringify(item.requestHeaders) : null,
        item.segments ? JSON.stringify(item.segments) : null,
        item.createdAt,
        item.updatedAt,
        item.completedAt,
      ]
    );
    if (immediate) {
      this.flushImmediate();
    } else {
      this.scheduleFlush();
    }
  }

  deleteDownload(id: string): void {
    this.db.run('DELETE FROM downloads WHERE id = ?', [id]);
    this.flushImmediate();
  }

  getAllDownloads(): DownloadItem[] {
    const stmt = this.db.prepare('SELECT * FROM downloads ORDER BY created_at DESC');
    const items: DownloadItem[] = [];
    while (stmt.step()) {
      const r = stmt.getAsObject() as Record<string, any>;
      const totalBytes = r.total_bytes === null ? null : Number(r.total_bytes);
      const downloadedBytes = Number(r.downloaded_bytes || 0);
      const status = String(r.status) as DownloadItem['status'];

      let progress = 0;
      if (status === 'completed') {
        progress = 100;
      } else if (totalBytes && totalBytes > 0) {
        progress = Math.min(100, (downloadedBytes / totalBytes) * 100);
      }

      items.push({
        id: String(r.id),
        url: String(r.url),
        finalUrl: String(r.final_url),
        filename: String(r.filename),
        saveDir: String(r.save_dir),
        filePath: String(r.file_path),
        partPath: String(r.part_path),
        mimeType: String(r.mime_type || 'application/octet-stream'),
        category: String(r.category || 'other') as DownloadItem['category'],
        totalBytes,
        downloadedBytes,
        speed: 0,
        progress,
        etaSeconds: null,
        status,
        resumable: Boolean(r.resumable),
        etag: r.etag ? String(r.etag) : null,
        lastModified: r.last_modified ? String(r.last_modified) : null,
        error: r.error ? String(r.error) : null,
        retryCount: Number(r.retry_count || 0),
        maxRetries: Number(r.max_retries || 3),
        thumbnailUrl: r.thumbnail_url ? String(r.thumbnail_url) : null,
        requestHeaders: r.request_headers
          ? (() => {
              try {
                return JSON.parse(String(r.request_headers));
              } catch {
                return null;
              }
            })()
          : null,
        segments: r.segments
          ? (() => {
              try {
                return JSON.parse(String(r.segments));
              } catch {
                return null;
              }
            })()
          : null,
        activeConnections: 0,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
        completedAt: r.completed_at === null ? null : Number(r.completed_at),
      });
    }
    stmt.free();
    return items;
  }
}
