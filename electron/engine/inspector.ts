import http from 'http';
import https from 'https';
import { InspectedMedia, RequestHeaders } from '../types';
import {
  classifyError,
  detectCategory,
  formatHttpError,
  inferFilename,
  mergeCookies,
  sanitizeFilename,
  validateDownloadUrl,
} from './utils';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_REDIRECTS = 10;
const REQUEST_TIMEOUT_MS = 15000;

interface ProbeResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  finalUrl: string;
  bodySnippet?: string;
}

function performHttpProbe(
  urlStr: string,
  method: 'HEAD' | 'GET',
  extraHeaders: Record<string, string> = {},
  readBodyLimitBytes = 0,
  redirectsLeft = MAX_REDIRECTS
): Promise<ProbeResponse> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch {
      reject(new Error('Invalid redirect or target URL.'));
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(
      parsed,
      {
        method,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: '*/*',
          'Accept-Encoding': 'identity',
          ...extraHeaders,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;

        if ([301, 302, 303, 307, 308].includes(status) && location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error('Too many HTTP redirects while inspecting URL.'));
            return;
          }
          let nextUrl: string;
          try {
            nextUrl = new URL(location, parsed).toString();
          } catch {
            reject(new Error('Server returned an invalid redirect URL.'));
            return;
          }
          const updatedCookie = mergeCookies(extraHeaders['Cookie'], res.headers['set-cookie']);
          const nextHeaders: Record<string, string> = { ...extraHeaders };
          if (updatedCookie) {
            nextHeaders['Cookie'] = updatedCookie;
          }
          performHttpProbe(
            nextUrl,
            status === 303 ? 'GET' : method,
            nextHeaders,
            readBodyLimitBytes,
            redirectsLeft - 1
          )
            .then(resolve)
            .catch(reject);
          return;
        }

        if (readBodyLimitBytes <= 0) {
          // Immediately destroy response stream so we don't download a huge file on GET probe
          res.destroy();
          resolve({
            statusCode: status,
            headers: res.headers,
            finalUrl: urlStr,
          });
          return;
        }

        const chunks: Buffer[] = [];
        let collected = 0;
        let settled = false;

        const finish = () => {
          if (settled) return;
          settled = true;
          resolve({
            statusCode: status,
            headers: res.headers,
            finalUrl: urlStr,
            bodySnippet: Buffer.concat(chunks).toString('utf8'),
          });
        };

        res.on('data', (chunk: Buffer) => {
          const remaining = readBodyLimitBytes - collected;
          if (remaining > 0) {
            chunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk);
            collected += Math.min(chunk.length, remaining);
          }
          if (collected >= readBodyLimitBytes) {
            res.destroy();
            finish();
          }
        });
        res.on('end', finish);
        res.on('close', finish);
        res.on('error', (err) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Connection timed out while inspecting URL.'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

function parseTotalBytes(headers: http.IncomingHttpHeaders, statusCode: number): number | null {
  if (statusCode === 206 && headers['content-range']) {
    const rangeHeader = String(headers['content-range']);
    // Format: bytes 0-0/123456
    const match = rangeHeader.match(/\/(\d+)$/);
    if (match && match[1]) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  const lenHeader = headers['content-length'];
  if (lenHeader !== undefined) {
    const n = Number(lenHeader);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

function extractPublicDirectMediaFromHtml(
  html: string,
  baseUrl: string
): { mediaUrl: string; title?: string; posterUrl?: string } | null {
  const titleMatch = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  const pageTitle = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : undefined;

  const posterMatch =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<video[^>]+poster=["']([^"']+)["']/i);
  let posterUrl: string | undefined;
  if (posterMatch?.[1]) {
    try {
      posterUrl = new URL(posterMatch[1], baseUrl).toString();
    } catch {
      // ignore invalid poster URL
    }
  }

  // Look only for standard publicly embedded direct media URLs (<meta og:video>, <video src>, <source src>)
  const candidates: string[] = [];
  const patterns = [
    /<meta[^>]+property=["']og:video(?::url|:secure_url)?["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::url|:secure_url)?["']/gi,
    /<video[^>]+src=["']([^"']+)["']/gi,
    /<source[^>]+src=["']([^"']+)["'][^>]*type=["'](?:video|audio)\/[^"']+["']/gi,
    /<source[^>]+type=["'](?:video|audio)\/[^"']+["'][^>]*src=["']([^"']+)["']/gi,
  ];

  for (const regex of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      if (match[1]) candidates.push(match[1]);
    }
  }

  for (const raw of candidates) {
    if (!raw || raw.startsWith('blob:') || raw.startsWith('data:')) continue;
    // Skip DRM/adaptive manifest streams that aren't direct downloadable files
    if (/\.(m3u8|mpd)(\?|$)/i.test(raw)) continue;
    try {
      const resolved = new URL(raw, baseUrl);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
        return { mediaUrl: resolved.toString(), title: pageTitle, posterUrl };
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function inspectUrl(
  rawUrl: string,
  requestHeaders?: RequestHeaders | null
): Promise<InspectedMedia> {
  const validation = validateDownloadUrl(rawUrl);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  const normalizedUrl = validation.url.toString();

  const baseHeaders: Record<string, string> = {};
  if (requestHeaders?.userAgent) baseHeaders['User-Agent'] = requestHeaders.userAgent;
  if (requestHeaders?.referer) baseHeaders['Referer'] = requestHeaders.referer;
  if (requestHeaders?.cookie) baseHeaders['Cookie'] = requestHeaders.cookie;

  let probe: ProbeResponse;
  try {
    probe = await performHttpProbe(normalizedUrl, 'HEAD', baseHeaders);
    // Fallback to ranged GET if server rejects HEAD or omits Content-Length
    if (
      probe.statusCode === 400 ||
      probe.statusCode === 403 ||
      probe.statusCode === 405 ||
      probe.statusCode === 500 ||
      probe.statusCode === 501 ||
      (probe.statusCode >= 200 && probe.statusCode < 300 && !probe.headers['content-length'])
    ) {
      try {
        const rangeProbe = await performHttpProbe(probe.finalUrl, 'GET', {
          ...baseHeaders,
          Range: 'bytes=0-0',
        });
        if (rangeProbe.statusCode >= 200 && rangeProbe.statusCode < 300) {
          probe = rangeProbe;
        } else if (rangeProbe.statusCode === 400 || rangeProbe.statusCode === 416 || rangeProbe.statusCode === 403) {
          // Some servers reject Range: bytes=0-0; fall back to plain GET header peek
          const plainGet = await performHttpProbe(probe.finalUrl, 'GET', baseHeaders);
          if (plainGet.statusCode >= 200 && plainGet.statusCode < 300) {
            probe = plainGet;
          } else if (probe.statusCode >= 400) {
            probe = plainGet;
          }
        } else if (probe.statusCode >= 400) {
          probe = rangeProbe;
        }
      } catch {
        // Fallback to plain GET if ranged probe threw
        try {
          const plainGet = await performHttpProbe(probe.finalUrl, 'GET', baseHeaders);
          if (plainGet.statusCode >= 200 && plainGet.statusCode < 300) {
            probe = plainGet;
          }
        } catch {
          // keep original HEAD probe
        }
      }
    }
  } catch (err: any) {
    const classified = classifyError(err);
    throw new Error(classified.message);
  }

  if (probe.statusCode >= 400) {
    throw new Error(formatHttpError(probe.statusCode).message);
  }

  const contentType = String(probe.headers['content-type'] || 'application/octet-stream')
    .split(';')[0]
    .trim()
    .toLowerCase();

  // If the URL points to an HTML webpage, inspect safely for publicly embedded direct media
  if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
    let pageProbe: ProbeResponse;
    try {
      pageProbe = await performHttpProbe(probe.finalUrl, 'GET', baseHeaders, 128 * 1024);
    } catch (err: any) {
      throw new Error(classifyError(err).message);
    }

    const extracted = extractPublicDirectMediaFromHtml(
      pageProbe.bodySnippet || '',
      pageProbe.finalUrl
    );
    if (!extracted) {
      throw new Error(
        'This URL points to a webpage rather than a direct downloadable media file, or the site uses protected/DRM streaming that is not supported. Please paste a direct video or file URL.'
      );
    }

    // Re-inspect the extracted direct media link
    const mediaInfo = await inspectUrl(extracted.mediaUrl, {
      ...requestHeaders,
      referer: probe.finalUrl,
    });
    return {
      ...mediaInfo,
      extractedFromPage: true,
      pageTitle: extracted.title,
      thumbnailUrl: mediaInfo.thumbnailUrl || extracted.posterUrl || null,
      filename:
        extracted.title && mediaInfo.filename.startsWith('download_')
          ? sanitizeFilename(
              `${extracted.title}${mediaInfo.filename.slice(mediaInfo.filename.lastIndexOf('.'))}`
            )
          : mediaInfo.filename,
    };
  }

  const contentDisposition = probe.headers['content-disposition']
    ? String(probe.headers['content-disposition'])
    : undefined;

  const totalBytes = parseTotalBytes(probe.headers, probe.statusCode);
  const acceptRanges = String(probe.headers['accept-ranges'] || '').toLowerCase();
  const resumable = probe.statusCode === 206 || acceptRanges === 'bytes';
  const filename = inferFilename(probe.finalUrl, contentDisposition, contentType);
  const category = detectCategory(filename, contentType);

  const etag = probe.headers.etag ? String(probe.headers.etag) : null;
  const lastModified = probe.headers['last-modified']
    ? String(probe.headers['last-modified'])
    : null;

  const thumbnailUrl = category === 'image' ? probe.finalUrl : null;

  return {
    url: normalizedUrl,
    finalUrl: probe.finalUrl,
    filename,
    mimeType: contentType || 'application/octet-stream',
    category,
    totalBytes,
    resumable,
    etag,
    lastModified,
    thumbnailUrl,
  };
}
