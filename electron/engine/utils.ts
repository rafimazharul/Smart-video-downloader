import fs from 'fs';
import path from 'path';
import { MediaCategory } from '../types';

const MIME_EXTENSION_MAP: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',
  'video/mpeg': '.mpeg',
  'video/ogg': '.ogv',
  'video/3gpp': '.3gp',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/webm': '.weba',
  'audio/flac': '.flac',
  'audio/aac': '.aac',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/x-rar-compressed': '.rar',
  'application/x-7z-compressed': '.7z',
  'application/gzip': '.gz',
  'application/x-tar': '.tar',
  'application/x-msdownload': '.exe',
  'application/x-msi': '.msi',
  'application/vnd.microsoft.portable-executable': '.exe',
  'application/octet-stream': '.bin',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/json': '.json',
};

const EXT_CATEGORY_MAP: Record<string, MediaCategory> = {
  '.mp4': 'video',
  '.webm': 'video',
  '.mkv': 'video',
  '.mov': 'video',
  '.avi': 'video',
  '.wmv': 'video',
  '.flv': 'video',
  '.m4v': 'video',
  '.mpeg': 'video',
  '.mpg': 'video',
  '.ogv': 'video',
  '.3gp': 'video',
  '.ts': 'video',
  '.mp3': 'audio',
  '.m4a': 'audio',
  '.wav': 'audio',
  '.flac': 'audio',
  '.ogg': 'audio',
  '.aac': 'audio',
  '.wma': 'audio',
  '.opus': 'audio',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.svg': 'image',
  '.bmp': 'image',
  '.ico': 'image',
  '.zip': 'archive',
  '.rar': 'archive',
  '.7z': 'archive',
  '.tar': 'archive',
  '.gz': 'archive',
  '.bz2': 'archive',
  '.xz': 'archive',
  '.iso': 'archive',
  '.pdf': 'document',
  '.doc': 'document',
  '.docx': 'document',
  '.xls': 'document',
  '.xlsx': 'document',
  '.ppt': 'document',
  '.pptx': 'document',
  '.txt': 'document',
  '.csv': 'document',
  '.epub': 'document',
  '.exe': 'software',
  '.msi': 'software',
  '.dmg': 'software',
  '.pkg': 'software',
  '.deb': 'software',
  '.rpm': 'software',
  '.apk': 'software',
  '.appimage': 'software',
};

const DIRECT_MEDIA_EXTENSIONS = new Set(Object.keys(EXT_CATEGORY_MAP));

export function validateDownloadUrl(rawUrl: string): { valid: true; url: URL } | { valid: false; error: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: 'Please enter a download URL.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      error: 'Invalid URL format. Please enter a valid http:// or https:// URL.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: `Unsupported protocol "${parsed.protocol}". Only HTTP and HTTPS downloads are supported.`,
    };
  }

  if (!parsed.hostname) {
    return { valid: false, error: 'Invalid URL: missing hostname.' };
  }

  return { valid: true, url: parsed };
}

export function looksLikeDownloadableUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes('\n') || trimmed.includes(' ') || trimmed.length > 2048) {
    return false;
  }
  const res = validateDownloadUrl(trimmed);
  if (!res.valid) return false;
  const pathname = res.url.pathname.toLowerCase();
  const ext = path.extname(pathname);
  if (ext && DIRECT_MEDIA_EXTENSIONS.has(ext)) {
    return true;
  }
  // Also recognize common direct download query patterns
  const query = res.url.search.toLowerCase();
  if (query.includes('download=') || query.includes('response-content-disposition')) {
    return true;
  }
  return false;
}

export function sanitizeFilename(name: string): string {
  let clean = name
    .replace(/[\r\n\t\0]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip leading/trailing dots & spaces (Windows limitation)
  clean = clean.replace(/^[.\s]+|[.\s]+$/g, '');

  // Avoid Windows reserved device names
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;
  if (reserved.test(clean)) {
    clean = `_${clean}`;
  }

  if (!clean) {
    clean = `download_${Date.now()}`;
  }

  // Keep filename length safe for Windows MAX_PATH
  if (clean.length > 180) {
    const ext = path.extname(clean);
    const base = path.basename(clean, ext).slice(0, 180 - ext.length);
    clean = `${base}${ext}`;
  }

  return clean;
}

export function extractFilenameFromDisposition(header: string | undefined): string | null {
  if (!header) return null;

  // RFC 5987 filename*=UTF-8''...
  const starMatch = header.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')?([^;\r\n]+)/i);
  if (starMatch && starMatch[1]) {
    const raw = starMatch[1].trim().replace(/^["']|["']$/g, '');
    try {
      const decoded = decodeURIComponent(raw);
      if (decoded.trim()) return sanitizeFilename(decoded);
    } catch {
      if (raw.trim()) return sanitizeFilename(raw);
    }
  }

  // Standard filename="..." or filename=...
  const basicMatch = header.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;\r\n]+)/i);
  if (basicMatch) {
    const raw = (basicMatch[1] || basicMatch[2] || '').trim().replace(/^["']|["']$/g, '');
    if (raw) {
      try {
        return sanitizeFilename(decodeURIComponent(raw));
      } catch {
        return sanitizeFilename(raw);
      }
    }
  }

  return null;
}

export function inferFilename(
  urlStr: string,
  contentDisposition?: string,
  contentType?: string
): string {
  const fromDisposition = extractFilenameFromDisposition(contentDisposition);
  if (fromDisposition) {
    return ensureExtension(fromDisposition, contentType);
  }

  try {
    const parsed = new URL(urlStr);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      let last = segments[segments.length - 1];
      try {
        last = decodeURIComponent(last);
      } catch {
        // ignore bad percent-encoding
      }
      if (last && last !== '/' && last.length > 0) {
        return ensureExtension(sanitizeFilename(last), contentType);
      }
    }
  } catch {
    // fallback below
  }

  const ext = getExtensionFromMime(contentType) || '.bin';
  return sanitizeFilename(`download_${Date.now()}${ext}`);
}

export function getExtensionFromMime(contentType?: string): string {
  if (!contentType) return '';
  const cleanMime = contentType.split(';')[0].trim().toLowerCase();
  return MIME_EXTENSION_MAP[cleanMime] || '';
}

function ensureExtension(filename: string, contentType?: string): string {
  const existingExt = path.extname(filename);
  if (existingExt && existingExt.length >= 2 && existingExt.length <= 10) {
    return filename;
  }
  const inferred = getExtensionFromMime(contentType);
  if (inferred && inferred !== '.bin') {
    return `${filename}${inferred}`;
  }
  return filename;
}

export function detectCategory(filename: string, mimeType?: string): MediaCategory {
  const ext = path.extname(filename).toLowerCase();
  if (ext && EXT_CATEGORY_MAP[ext]) {
    return EXT_CATEGORY_MAP[ext];
  }
  const mime = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  if (
    mime.includes('zip') ||
    mime.includes('tar') ||
    mime.includes('gzip') ||
    mime.includes('rar') ||
    mime.includes('7z')
  ) {
    return 'archive';
  }
  if (mime.includes('pdf') || mime.startsWith('text/') || mime.includes('document')) {
    return 'document';
  }
  if (mime.includes('msdownload') || mime.includes('msi') || mime.includes('executable')) {
    return 'software';
  }
  return 'other';
}

export function resolveUniqueFilePath(
  saveDir: string,
  desiredFilename: string,
  reservedPaths: Set<string> = new Set()
): { filename: string; filePath: string; partPath: string } {
  const safeName = sanitizeFilename(desiredFilename);
  const ext = path.extname(safeName);
  const base = ext ? safeName.slice(0, -ext.length) : safeName;

  let candidateName = safeName;
  let counter = 1;

  while (true) {
    const candidatePath = path.join(saveDir, candidateName);
    const candidatePart = `${candidatePath}.smartdm.part`;
    const lowerPath = candidatePath.toLowerCase();

    const existsOnDisk = fs.existsSync(candidatePath) || fs.existsSync(candidatePart);
    const isReserved = reservedPaths.has(lowerPath);

    if (!existsOnDisk && !isReserved) {
      return {
        filename: candidateName,
        filePath: candidatePath,
        partPath: candidatePart,
      };
    }

    candidateName = `${base} (${counter})${ext}`;
    counter += 1;
    if (counter > 9999) {
      candidateName = `${base}_${Date.now()}${ext}`;
      const fp = path.join(saveDir, candidateName);
      return { filename: candidateName, filePath: fp, partPath: `${fp}.smartdm.part` };
    }
  }
}

export async function getDiskSpace(targetDir: string): Promise<{ freeBytes: number; totalBytes: number } | null> {
  try {
    let checkPath = targetDir;
    while (!fs.existsSync(checkPath)) {
      const parent = path.dirname(checkPath);
      if (parent === checkPath) break;
      checkPath = parent;
    }
    const stat = await fs.promises.statfs(checkPath);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    const totalBytes = Number(stat.blocks) * Number(stat.bsize);
    return { freeBytes, totalBytes };
  } catch {
    return null;
  }
}

export function checkDirectoryWritable(dir: string): { ok: true } | { ok: false; error: string } {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return { ok: true };
  } catch (err: any) {
    const code = err?.code || '';
    if (code === 'EACCES' || code === 'EPERM') {
      return {
        ok: false,
        error: `Permission denied: cannot write to folder "${dir}". Please choose another download folder.`,
      };
    }
    if (code === 'ENOENT') {
      return {
        ok: false,
        error: `Download folder "${dir}" does not exist and could not be created.`,
      };
    }
    return {
      ok: false,
      error: `Cannot access download folder "${dir}": ${err?.message || 'Unknown error'}`,
    };
  }
}

export function classifyError(err: any): { message: string; retryable: boolean } {
  const code = err?.code || '';
  const msg = String(err?.message || 'Unknown error');

  if (code === 'ENOSPC') {
    return {
      message: 'Insufficient disk space on the target drive. Free up space or choose another drive.',
      retryable: false,
    };
  }
  if (code === 'EACCES' || code === 'EPERM') {
    if (err?.syscall === 'connect' || err?.address) {
      return {
        message: 'Network connection was blocked by firewall or system security policy.',
        retryable: false,
      };
    }
    return {
      message: 'Permission denied while writing file. Check folder permissions or choose another download folder.',
      retryable: false,
    };
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return {
      message: 'Network error: could not resolve server hostname. Check your internet connection.',
      retryable: true,
    };
  }
  if (code === 'ECONNREFUSED') {
    return {
      message: 'Connection refused by the remote server.',
      retryable: true,
    };
  }
  if (code === 'ECONNRESET' || code === 'EPIPE' || msg.toLowerCase().includes('socket hang up')) {
    return {
      message: 'Connection interrupted by remote server or network drop.',
      retryable: true,
    };
  }
  if (code === 'ETIMEDOUT' || msg.toLowerCase().includes('timed out')) {
    return {
      message: 'Connection timed out while waiting for server response.',
      retryable: true,
    };
  }
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
    return {
      message: 'SSL/TLS certificate verification failed for this server.',
      retryable: false,
    };
  }

  return { message: msg, retryable: false };
}

export function mergeCookies(
  existingCookie: string | undefined,
  setCookieHeaders: string | string[] | undefined
): string | undefined {
  const jar = new Map<string, string>();
  if (existingCookie) {
    for (const part of existingCookie.split(';')) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k) jar.set(k, v);
      }
    }
  }
  if (setCookieHeaders) {
    const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
    for (const raw of list) {
      const firstPair = raw.split(';')[0];
      const idx = firstPair.indexOf('=');
      if (idx > 0) {
        const k = firstPair.slice(0, idx).trim();
        const v = firstPair.slice(idx + 1).trim();
        if (k) jar.set(k, v);
      }
    }
  }
  if (jar.size === 0) return undefined;
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

export function formatHttpError(statusCode: number): { message: string; retryable: boolean } {
  switch (statusCode) {
    case 400:
      return { message: 'HTTP 400 Bad Request: The server could not process this download URL.', retryable: false };
    case 401:
      return { message: 'HTTP 401 Unauthorized: This resource requires authentication and cannot be downloaded.', retryable: false };
    case 403:
      return { message: 'HTTP 403 Forbidden: Access to this file is restricted by the server.', retryable: false };
    case 404:
      return { message: 'HTTP 404 Not Found: The requested file does not exist on the server.', retryable: false };
    case 410:
      return { message: 'HTTP 410 Gone: This file is no longer available on the server.', retryable: false };
    case 416:
      return { message: 'HTTP 416 Range Not Satisfiable: Resume offset invalid.', retryable: false };
    case 429:
      return { message: 'HTTP 429 Too Many Requests: Rate limited by server. Retrying shortly.', retryable: true };
    case 500:
    case 502:
    case 503:
    case 504:
      return { message: `HTTP ${statusCode} Server Error: The remote server is temporarily unavailable.`, retryable: true };
    default:
      return {
        message: `HTTP ${statusCode}: Server rejected the download request.`,
        retryable: statusCode >= 500,
      };
  }
}
