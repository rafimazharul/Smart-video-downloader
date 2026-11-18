function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 KB/s';
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
  return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
}

const statusPill = document.getElementById('statusPill');
const liveStats = document.getElementById('liveStats');
const offlineBanner = document.getElementById('offlineBanner');
const activeCountEl = document.getElementById('activeCount');
const liveSpeedEl = document.getElementById('liveSpeed');
const totalCountEl = document.getElementById('totalCount');
const enabledToggle = document.getElementById('enabledToggle');
const minSizeSelect = document.getElementById('minSizeSelect');
const manualForm = document.getElementById('manualForm');
const manualUrl = document.getElementById('manualUrl');
const sendBtn = document.getElementById('sendBtn');
const feedback = document.getElementById('feedback');
const recentList = document.getElementById('recentList');

function renderRecent(items) {
  recentList.innerHTML = '';
  if (!items || items.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No browser downloads captured yet.';
    recentList.appendChild(li);
    return;
  }

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'recent-item';

    const name = document.createElement('div');
    name.className = 'recent-name';
    name.textContent = item.filename || 'Download';
    name.title = item.filename || '';

    const url = document.createElement('div');
    url.className = 'recent-url';
    url.textContent = item.url || '';
    url.title = item.url || '';

    li.appendChild(name);
    li.appendChild(url);
    recentList.appendChild(li);
  }
}

function loadStatus() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (res) => {
    if (!res) return;
    const { prefs, health } = res;

    enabledToggle.checked = Boolean(prefs.enabled);
    minSizeSelect.value = String(prefs.minSizeMb || 0);
    renderRecent(prefs.recentCaptures || []);

    if (health && health.ok) {
      statusPill.textContent = 'Connected';
      statusPill.className = 'pill pill-online';
      liveStats.classList.remove('hidden');
      offlineBanner.classList.add('hidden');
      activeCountEl.textContent = String(health.activeCount || 0);
      liveSpeedEl.textContent = formatSpeed(health.totalSpeedBytesPerSec || 0);
      totalCountEl.textContent = String(health.totalDownloads || 0);
    } else {
      statusPill.textContent = 'App Offline';
      statusPill.className = 'pill pill-offline';
      liveStats.classList.add('hidden');
      offlineBanner.classList.remove('hidden');
    }
  });
}

enabledToggle.addEventListener('change', () => {
  chrome.runtime.sendMessage({
    type: 'UPDATE_PREFS',
    patch: { enabled: enabledToggle.checked },
  });
});

minSizeSelect.addEventListener('change', () => {
  chrome.runtime.sendMessage({
    type: 'UPDATE_PREFS',
    patch: { minSizeMb: Number(minSizeSelect.value) || 0 },
  });
});

manualForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = manualUrl.value.trim();
  if (!url) return;

  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';
  feedback.className = 'feedback hidden';

  chrome.runtime.sendMessage({ type: 'SEND_MANUAL_URL', url }, (res) => {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Download';
    if (res && res.ok) {
      feedback.textContent = `Queued in Smart Video Downloader: ${res.result?.filename || 'File'}`;
      feedback.className = 'feedback ok';
      manualUrl.value = '';
      loadStatus();
    } else {
      feedback.textContent = res?.error || 'Could not reach Smart Video Downloader.';
      feedback.className = 'feedback err';
    }
  });
});

loadStatus();
setInterval(loadStatus, 2000);
