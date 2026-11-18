const BRIDGE_BASE = 'http://127.0.0.1:48921';
const CLIENT_HEADER = { 'X-SmartDM-Client': 'browser-extension' };

const DEFAULT_PREFS = {
  enabled: true,
  minSizeMb: 0,
  recentCaptures: [],
};

// Track download IDs we already handled to prevent double-capture
const handledIds = new Set();

async function getPrefs() {
  const data = await chrome.storage.local.get(['enabled', 'minSizeMb', 'recentCaptures']);
  return {
    enabled: data.enabled !== undefined ? Boolean(data.enabled) : DEFAULT_PREFS.enabled,
    minSizeMb: typeof data.minSizeMb === 'number' ? data.minSizeMb : DEFAULT_PREFS.minSizeMb,
    recentCaptures: Array.isArray(data.recentCaptures) ? data.recentCaptures : [],
  };
}

async function saveRecentCapture(entry) {
  const prefs = await getPrefs();
  const next = [entry, ...prefs.recentCaptures].slice(0, 6);
  await chrome.storage.local.set({ recentCaptures: next });
}

async function checkBridgeHealth(timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BRIDGE_BASE}/health`, {
      method: 'GET',
      headers: CLIENT_HEADER,
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getCookieHeaderForUrl(targetUrl) {
  try {
    const cookies = await chrome.cookies.getAll({ url: targetUrl });
    if (!cookies || cookies.length === 0) return '';
    return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  } catch {
    return '';
  }
}

function extractBasename(filePath) {
  if (!filePath) return undefined;
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : undefined;
}

async function sendToDesktopApp(payload) {
  const res = await fetch(`${BRIDGE_BASE}/capture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...CLIENT_HEADER,
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({ ok: false, error: 'Invalid response from app.' }));
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `Desktop app returned HTTP ${res.status}`);
  }
  return json;
}

function flashBadge(text, color) {
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeText({ text });
  setTimeout(() => {
    void refreshBadge();
  }, 2500);
}

async function refreshBadge() {
  const prefs = await getPrefs();
  if (!prefs.enabled) {
    chrome.action.setBadgeBackgroundColor({ color: '#64748B' });
    chrome.action.setBadgeText({ text: 'OFF' });
    return;
  }
  chrome.action.setBadgeText({ text: '' });
}

// Create right-click context menu on install / startup
function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'smartdm-download-link',
      title: 'Download with Smart Video Downloader',
      contexts: ['link', 'video', 'audio', 'image'],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
  void refreshBadge();
});

chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();
  void refreshBadge();
});

// Handle right-click "Download with Smart Video Downloader"
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'smartdm-download-link') return;

  const targetUrl = info.linkUrl || info.srcUrl;
  if (!targetUrl || (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://'))) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Smart Video Downloader',
      message: 'Only HTTP/HTTPS links can be sent to Smart Video Downloader.',
    });
    return;
  }

  const health = await checkBridgeHealth(900);
  if (!health) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Smart Video Downloader is not running',
      message: 'Please launch the Smart Video Downloader desktop app first.',
    });
    return;
  }

  try {
    const cookie = await getCookieHeaderForUrl(targetUrl);
    const result = await sendToDesktopApp({
      url: targetUrl,
      referrer: info.pageUrl || tab?.url || '',
      cookie,
      userAgent: navigator.userAgent,
      skipInspect: false,
    });
    await saveRecentCapture({
      filename: result.filename || targetUrl,
      url: targetUrl,
      timestamp: Date.now(),
    });
    flashBadge('OK', '#10B981');
  } catch (err) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Could not download link',
      message: err?.message || 'Failed to send link to Smart Video Downloader.',
    });
    flashBadge('ERR', '#EF4444');
  }
});

// Intercept browser downloads automatically when user clicks any Download button on a website
chrome.downloads.onCreated.addListener(async (downloadItem) => {
  if (!downloadItem || handledIds.has(downloadItem.id)) return;

  // Prefer finalUrl when available, fallback to url
  const downloadUrl = downloadItem.finalUrl || downloadItem.url || '';
  if (!downloadUrl.startsWith('http://') && !downloadUrl.startsWith('https://')) {
    return;
  }

  // Never intercept browser extensions (.crx) or already completed items
  if (downloadItem.state && downloadItem.state !== 'in_progress') {
    return;
  }
  if (downloadUrl.toLowerCase().includes('.crx')) {
    return;
  }

  const prefs = await getPrefs();
  if (!prefs.enabled) return;

  // Respect optional minimum file size filter (if browser knows the fileSize upfront)
  if (
    prefs.minSizeMb > 0 &&
    typeof downloadItem.fileSize === 'number' &&
    downloadItem.fileSize > 0 &&
    downloadItem.fileSize < prefs.minSizeMb * 1024 * 1024
  ) {
    return;
  }

  // Verify desktop app is running before cancelling browser download
  const health = await checkBridgeHealth(1500);
  if (!health) {
    // Desktop app is closed -> let browser download proceed normally
    return;
  }

  handledIds.add(downloadItem.id);

  try {
    const cookie = await getCookieHeaderForUrl(downloadUrl);
    const suggestedName = extractBasename(downloadItem.filename);

    // Pause browser download immediately while handing off so bandwidth isn't wasted
    try {
      await chrome.downloads.pause(downloadItem.id);
    } catch {
      // ignore if already finished/cancelled
    }

    const result = await sendToDesktopApp({
      url: downloadUrl,
      filename: suggestedName,
      referrer: downloadItem.referrer || '',
      cookie,
      userAgent: navigator.userAgent,
      mimeType: downloadItem.mime || undefined,
      totalBytes:
        typeof downloadItem.fileSize === 'number' && downloadItem.fileSize > 0
          ? downloadItem.fileSize
          : null,
      skipInspect: true,
    });

    // Cancel & remove duplicate browser download
    try {
      await chrome.downloads.cancel(downloadItem.id);
      await chrome.downloads.erase({ id: downloadItem.id });
    } catch {
      // ignore
    }

    await saveRecentCapture({
      filename: result.filename || suggestedName || downloadUrl,
      url: downloadUrl,
      timestamp: Date.now(),
    });

    flashBadge('+1', '#10B981');
  } catch (err) {
    console.warn('SmartDM hand-off failed, resuming browser download:', err);
    // Fallback: resume browser download so the user's click still works!
    try {
      await chrome.downloads.resume(downloadItem.id);
    } catch {
      // ignore
    }
  } finally {
    setTimeout(() => handledIds.delete(downloadItem.id), 10000);
  }
});

// Handle messages from popup UI
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_STATUS') {
    Promise.all([getPrefs(), checkBridgeHealth(1500)]).then(([prefs, health]) => {
      sendResponse({ prefs, health });
    });
    return true;
  }

  if (msg?.type === 'UPDATE_PREFS') {
    chrome.storage.local.set(msg.patch || {}).then(async () => {
      await refreshBadge();
      const prefs = await getPrefs();
      sendResponse({ ok: true, prefs });
    });
    return true;
  }

  if (msg?.type === 'SEND_MANUAL_URL') {
    (async () => {
      try {
        const url = String(msg.url || '').trim();
        const cookie = await getCookieHeaderForUrl(url);
        const result = await sendToDesktopApp({
          url,
          cookie,
          userAgent: navigator.userAgent,
          skipInspect: false,
        });
        await saveRecentCapture({
          filename: result.filename || url,
          url,
          timestamp: Date.now(),
        });
        flashBadge('OK', '#10B981');
        sendResponse({ ok: true, result });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'Failed to send URL.' });
      }
    })();
    return true;
  }
});
