/**
 * End-to-end integration test suite for Smart Video Downloader engine & SQLite persistence.
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { AppDatabase } = require('../dist-electron/db/database');
const { ExtensionBridgeServer, EXTENSION_BRIDGE_PORT } = require('../dist-electron/bridge/extensionServer');
const { DownloadManager } = require('../dist-electron/engine/downloadManager');
const { inspectUrl } = require('../dist-electron/engine/inspector');

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(fp) {
  return sha256Buffer(fs.readFileSync(fp));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForStatus(manager, id, targetStatuses, timeoutMs = 20000) {
  const targets = Array.isArray(targetStatuses) ? targetStatuses : [targetStatuses];
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const item = manager.getDownload(id);
      if (item && targets.includes(item.status)) {
        clearInterval(iv);
        resolve(item);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        reject(
          new Error(
            `Timed out waiting for download ${id} to reach ${targets.join('|')}. Current: ${item?.status} (${item?.error || ''})`
          )
        );
      }
    };
    const iv = setInterval(check, 60);
    check();
  });
}

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartdm-test-'));
  const downloadDir = path.join(tmpDir, 'downloads');
  const dbPath = path.join(tmpDir, 'smartdm.sqlite');
  fs.mkdirSync(downloadDir, { recursive: true });

  // Deterministic 3 MB binary payload simulating an MP4 video
  const payload = crypto.randomBytes(3 * 1024 * 1024);
  const expectedHash = sha256Buffer(payload);
  const smallPayload = crypto.randomBytes(512 * 1024);
  const smallHash = sha256Buffer(smallPayload);

  let rangeRequestsReceived = 0;
  let flakyAttempts = 0;

  const server = http.createServer((req, res) => {
    const url = req.url || '/';

    if (url === '/redirect-video') {
      res.writeHead(302, { Location: '/sample.mp4' });
      res.end();
      return;
    }

    if (url === '/sample.mp4' || url.startsWith('/queue-')) {
      const data = url === '/sample.mp4' ? payload : smallPayload;
      const filename = url === '/sample.mp4' ? 'sample_clip.mp4' : `${url.slice(1)}.mp4`;
      const range = req.headers.range;

      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': data.length,
          'Accept-Ranges': 'bytes',
          'Content-Disposition': `attachment; filename="${filename}"`,
          ETag: '"test-etag-v1"',
        });
        res.end();
        return;
      }

      if (range) {
        const m = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (m) {
          const start = Number(m[1]);
          const end = m[2] ? Math.min(Number(m[2]), data.length - 1) : data.length - 1;
          if (start >= data.length || start > end) {
            res.writeHead(416, { 'Content-Range': `bytes */${data.length}` });
            res.end();
            return;
          }
          rangeRequestsReceived += 1;
          res.writeHead(206, {
            'Content-Type': 'video/mp4',
            'Content-Length': end - start + 1,
            'Content-Range': `bytes ${start}-${end}/${data.length}`,
            'Accept-Ranges': 'bytes',
            'Content-Disposition': `attachment; filename="${filename}"`,
            ETag: '"test-etag-v1"',
          });
          // Stream in 64KB chunks
          const slice = data.subarray(start, end + 1);
          let pos = 0;
          const push = () => {
            while (pos < slice.length) {
              const chunk = slice.subarray(pos, pos + 65536);
              pos += chunk.length;
              if (!res.write(chunk)) {
                res.once('drain', push);
                return;
              }
            }
            res.end();
          };
          push();
          return;
        }
      }

      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': data.length,
        'Accept-Ranges': 'bytes',
        'Content-Disposition': `attachment; filename="${filename}"`,
        ETag: '"test-etag-v1"',
      });
      let pos = 0;
      const push = () => {
        while (pos < data.length) {
          const chunk = data.subarray(pos, pos + 65536);
          pos += chunk.length;
          if (!res.write(chunk)) {
            res.once('drain', push);
            return;
          }
        }
        res.end();
      };
      push();
      return;
    }

    if (url === '/flaky.mp4') {
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': smallPayload.length,
          'Accept-Ranges': 'bytes',
        });
        res.end();
        return;
      }

      flakyAttempts += 1;
      const range = req.headers.range;
      let start = 0;
      if (range) {
        const m = /^bytes=(\d+)-/.exec(range);
        if (m) start = Number(m[1]);
      }

      if (flakyAttempts === 1) {
        // Send first half and forcibly destroy socket to simulate network drop!
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': smallPayload.length,
          'Accept-Ranges': 'bytes',
        });
        res.write(smallPayload.subarray(0, 200 * 1024));
        setTimeout(() => {
          req.socket.destroy();
        }, 50);
        return;
      }

      const slice = smallPayload.subarray(start);
      res.writeHead(start > 0 ? 206 : 200, {
        'Content-Type': 'video/mp4',
        'Content-Length': slice.length,
        ...(start > 0
          ? { 'Content-Range': `bytes ${start}-${smallPayload.length - 1}/${smallPayload.length}` }
          : {}),
        'Accept-Ranges': 'bytes',
      });
      res.end(slice);
      return;
    }

    if (url === '/no-length.bin') {
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.write(smallPayload.subarray(0, 256 * 1024));
      setTimeout(() => {
        res.end(smallPayload.subarray(256 * 1024));
      }, 60);
      return;
    }

    if (url === '/not-found.mp4') {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    if (url === '/webpage-plain') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>Plain Page</title></head><body>Hello world</body></html>');
      return;
    }

    if (url === '/webpage-video') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<html><head><title>Public Video Page</title></head><body><video src="/sample.mp4"></video></body></html>'
      );
      return;
    }

    if (url === '/auth-cookie-video') {
      const cookie = String(req.headers.cookie || '');
      const referer = String(req.headers.referer || '');
      if (!cookie.includes('session=valid123') || !referer.includes('example.org')) {
        res.writeHead(403);
        res.end('Forbidden: missing session cookie or referer');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': smallPayload.length,
        'Content-Disposition': 'attachment; filename="browser_captured_movie.mp4"',
      });
      res.end(smallPayload);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test HTTP server listening on ${baseUrl}`);

  const db = new AppDatabase(dbPath);
  await db.init(downloadDir);
  const manager = new DownloadManager(db, downloadDir);
  manager.init();

  try {
    // TEST 1: URL Inspection + Redirect + Content-Disposition
    console.log('Running Test 1: URL inspection, redirects, metadata detection...');
    const info = await inspectUrl(`${baseUrl}/redirect-video`);
    assert.strictEqual(info.filename, 'sample_clip.mp4');
    assert.strictEqual(info.totalBytes, payload.length);
    assert.strictEqual(info.category, 'video');
    assert.strictEqual(info.resumable, true);
    console.log('  PASS Test 1');

    // TEST 2: Multi-Segment (8x Parallel) + Throttling + Pause + HTTP Range Resume + SHA-256
    console.log('Running Test 2: 8x Multi-Segment, Throttling, Pause, Range Resume & SHA-256...');
    manager.updateSettings({ connectionsPerDownload: 8, speedLimitBytesPerSec: 600 * 1024 });
    const dl1 = await manager.addDownload({
      url: `${baseUrl}/redirect-video`,
      saveDir: downloadDir,
    });

    // Let it stream for ~1.1s then pause across all 8 parallel segments
    await sleep(1100);
    await manager.pauseDownload(dl1.id);
    const pausedItem = manager.getDownload(dl1.id);
    const pausedBytes = pausedItem.downloadedBytes;
    assert.strictEqual(pausedItem.status, 'paused');
    assert(Array.isArray(pausedItem.segments) && pausedItem.segments.length === 8,
      `Expected 8 saved segments on pause, got ${pausedItem.segments?.length}`);
    assert(pausedBytes > 0 && pausedBytes < payload.length,
      `Expected partial download bytes, got ${pausedBytes}`);
    assert(fs.existsSync(pausedItem.partPath), '.part file must exist while paused');
    assert(!fs.existsSync(pausedItem.filePath), 'final file must NOT exist while paused');

    // Remove speed cap and resume all incomplete segments in parallel
    manager.updateSettings({ speedLimitBytesPerSec: 0 });
    manager.resumeDownload(dl1.id);
    const done1 = await waitForStatus(manager, dl1.id, 'completed');
    assert(rangeRequestsReceived >= 8, `Expected >= 8 parallel HTTP Range requests, got ${rangeRequestsReceived}`);
    assert(fs.existsSync(done1.filePath), 'Final file must exist after completion');
    assert(!fs.existsSync(done1.partPath), '.part file must be removed after atomic rename');
    assert.strictEqual(sha256File(done1.filePath), expectedHash, 'SHA-256 mismatch after 8x multi-segment resume!');
    console.log(`  PASS Test 2 (8x segments paused at ${pausedBytes} bytes, ${rangeRequestsReceived} Range requests, SHA-256 verified)`);

    // TEST 3: Duplicate Filename Handling
    console.log('Running Test 3: Automatic duplicate filename handling...');
    const dlDup = await manager.addDownload({
      url: `${baseUrl}/sample.mp4`,
      filename: 'sample_clip.mp4',
      saveDir: downloadDir,
    });
    const doneDup = await waitForStatus(manager, dlDup.id, 'completed');
    assert.strictEqual(doneDup.filename, 'sample_clip (1).mp4');
    assert.strictEqual(sha256File(doneDup.filePath), expectedHash);
    console.log('  PASS Test 3 (auto-renamed to sample_clip (1).mp4)');

    // TEST 4: Auto-Retry after Mid-Stream Network Drop (Corrupt-File Protection)
    console.log('Running Test 4: Auto-retry & corruption protection after network drop...');
    const dlFlaky = await manager.addDownload({
      url: `${baseUrl}/flaky.mp4`,
      saveDir: downloadDir,
    });
    const doneFlaky = await waitForStatus(manager, dlFlaky.id, 'completed', 20000);
    assert(flakyAttempts >= 2, 'Expected server to see retry attempt');
    assert.strictEqual(sha256File(doneFlaky.filePath), smallHash, 'SHA-256 mismatch after retry!');
    console.log(`  PASS Test 4 (recovered across ${flakyAttempts} attempts, SHA-256 verified)`);

    // TEST 5: Missing Content-Length (Unknown File Size)
    console.log('Running Test 5: Missing Content-Length handling...');
    const dlNoLen = await manager.addDownload({
      url: `${baseUrl}/no-length.bin`,
      saveDir: downloadDir,
    });
    const doneNoLen = await waitForStatus(manager, dlNoLen.id, 'completed');
    assert.strictEqual(doneNoLen.downloadedBytes, smallPayload.length);
    assert.strictEqual(sha256File(doneNoLen.filePath), smallHash);
    console.log('  PASS Test 5');

    // TEST 6: Concurrent Queue Management (maxConcurrentDownloads = 2 for 3 items)
    console.log('Running Test 6: Concurrent download queue management...');
    manager.updateSettings({ maxConcurrentDownloads: 2 });
    const q1 = await manager.addDownload({ url: `${baseUrl}/queue-1`, saveDir: downloadDir });
    const q2 = await manager.addDownload({ url: `${baseUrl}/queue-2`, saveDir: downloadDir });
    const q3 = await manager.addDownload({ url: `${baseUrl}/queue-3`, saveDir: downloadDir });
    await Promise.all([
      waitForStatus(manager, q1.id, 'completed'),
      waitForStatus(manager, q2.id, 'completed'),
      waitForStatus(manager, q3.id, 'completed'),
    ]);
    assert.strictEqual(sha256File(manager.getDownload(q1.id).filePath), smallHash);
    assert.strictEqual(sha256File(manager.getDownload(q2.id).filePath), smallHash);
    assert.strictEqual(sha256File(manager.getDownload(q3.id).filePath), smallHash);
    console.log('  PASS Test 6');

    // TEST 7: Error Handling & Public HTML Media Extraction
    console.log('Running Test 7: Error handling & public HTML media detection...');
    await assert.rejects(() => inspectUrl('not-a-valid-url'), /Invalid URL/i);
    await assert.rejects(() => inspectUrl('ftp://example.com/file.mp4'), /Unsupported protocol/i);
    await assert.rejects(() => inspectUrl(`${baseUrl}/not-found.mp4`), /404/i);
    await assert.rejects(() => inspectUrl(`${baseUrl}/webpage-plain`), /webpage/i);

    const extracted = await inspectUrl(`${baseUrl}/webpage-video`);
    assert.strictEqual(extracted.extractedFromPage, true);
    assert.strictEqual(extracted.category, 'video');
    assert.strictEqual(extracted.totalBytes, payload.length);
    console.log('  PASS Test 7');

    // TEST 8: Real Publicly Accessible HTTPS Sample MP4 Video Download
    console.log('Running Test 8: Real publicly accessible HTTPS sample MP4 video download...');
    const publicVideoUrl = 'https://www.w3schools.com/html/mov_bbb.mp4';
    const pubInfo = await inspectUrl(publicVideoUrl);
    assert.strictEqual(pubInfo.category, 'video');
    assert(pubInfo.totalBytes && pubInfo.totalBytes > 500000, 'Expected real MP4 size > 500KB');
    const dlPub = await manager.addDownload({
      url: publicVideoUrl,
      saveDir: downloadDir,
      inspected: pubInfo,
    });
    const donePub = await waitForStatus(manager, dlPub.id, 'completed', 45000);
    assert(fs.existsSync(donePub.filePath), 'Downloaded real MP4 must exist on disk');
    const actualSize = fs.statSync(donePub.filePath).size;
    assert.strictEqual(actualSize, pubInfo.totalBytes, 'Downloaded MP4 size must match Content-Length');
    // Verify valid MP4 magic header ('ftyp' at bytes 4..8)
    const fd = fs.openSync(donePub.filePath, 'r');
    const headerBuf = Buffer.alloc(12);
    fs.readSync(fd, headerBuf, 0, 12, 0);
    fs.closeSync(fd);
    assert.strictEqual(headerBuf.subarray(4, 8).toString('ascii'), 'ftyp', 'Expected valid MP4 ftyp header');
    console.log(`  PASS Test 8 (downloaded real public MP4: ${donePub.filename}, ${actualSize} bytes, valid ftyp header)`);

    // TEST 9: Browser Extension Bridge Security + Cookie/Referer Captured Download
    console.log('Running Test 9: Browser Extension Bridge security & cookie/referer hand-off...');
    const testBridgePort = 48929;
    const bridge = new ExtensionBridgeServer(manager, undefined, undefined, testBridgePort);
    const bridgeStarted = await bridge.start();
    assert.strictEqual(bridgeStarted, true, 'Extension bridge failed to start');

    try {
      // 9a. Reject arbitrary webpage origin (CSRF guard)
      const evilRes = await fetch(`http://127.0.0.1:${testBridgePort}/health`, {
        headers: {
          Origin: 'https://untrusted-site.example',
          'X-SmartDM-Client': 'browser-extension',
        },
      });
      assert.strictEqual(evilRes.status, 403, 'Bridge must reject web origins');

      // 9b. Accept extension health check
      const healthRes = await fetch(`http://127.0.0.1:${testBridgePort}/health`, {
        headers: {
          Origin: 'chrome-extension://abcdefghijklmnop',
          'X-SmartDM-Client': 'browser-extension',
        },
      });
      assert.strictEqual(healthRes.status, 200);
      const healthJson = await healthRes.json();
      assert.strictEqual(healthJson.ok, true);

      // 9c. Capture download with browser Cookie + Referer + Content-Disposition rename
      const capRes = await fetch(`http://127.0.0.1:${testBridgePort}/capture`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'chrome-extension://abcdefghijklmnop',
          'X-SmartDM-Client': 'browser-extension',
        },
        body: JSON.stringify({
          url: `${baseUrl}/auth-cookie-video`,
          referrer: 'https://example.org/downloads',
          cookie: 'session=valid123',
          skipInspect: true,
        }),
      });
      assert.strictEqual(capRes.status, 200);
      const capJson = await capRes.json();
      assert.strictEqual(capJson.ok, true);

      const doneCap = await waitForStatus(manager, capJson.id, 'completed');
      assert.strictEqual(doneCap.filename, 'browser_captured_movie.mp4');
      assert.strictEqual(sha256File(doneCap.filePath), smallHash);
      console.log('  PASS Test 9 (bridge CSRF guard, cookie/referer forwarding, Content-Disposition rename & SHA-256 verified)');
    } finally {
      await bridge.stop();
    }

    // TEST 10: SQLite Persistence Across Shutdown & Restart
    console.log('Running Test 10: SQLite persistence across manager restart...');
    const countBefore = manager.getDownloads().length;
    await manager.shutdown();
    db.close();

    const db2 = new AppDatabase(dbPath);
    await db2.init(downloadDir);
    const manager2 = new DownloadManager(db2, downloadDir);
    manager2.init();
    assert.strictEqual(manager2.getDownloads().length, countBefore);
    assert.strictEqual(manager2.getSettings().maxConcurrentDownloads, 2);
    await manager2.shutdown();
    db2.close();
    console.log(`  PASS Test 10 (${countBefore} history items & settings persisted in SQLite)`);

    console.log('\nALL 10 INTEGRATION TESTS PASSED SUCCESSFULLY!');
  } finally {
    try {
      await manager.shutdown();
    } catch {}
    try {
      db.close();
    } catch {}
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
