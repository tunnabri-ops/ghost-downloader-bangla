const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const historyEl = document.getElementById('history');
const urlInput = document.getElementById('url');
const kindSelect = document.getElementById('kind');

const items = new Map(); // id -> { id, url, kind, filename, status, percent, speed, eta, received, total }

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem('ghost-history') || '[]');
  } catch (_) {
    return [];
  }
}
function saveHistory(entry) {
  const h = loadHistory();
  h.unshift(entry);
  localStorage.setItem('ghost-history', JSON.stringify(h.slice(0, 50)));
}
function renderHistory() {
  const h = loadHistory();
  historyEl.innerHTML = h.length === 0
    ? '<li>কোনো সম্পন্ন ডাউনলোড নেই।</li>'
    : h.map((e) => '<li>' + escapeHtml(e.filename) + ' <span class="muted">(' + escapeHtml(e.kind) + ' • ' + escapeHtml(e.when) + ')</span></li>').join('');
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtBytes(n) {
  if (!n) return '—';
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(2) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}
function fmtEta(sec) {
  if (!sec) return '—';
  if (sec < 60) return sec + ' সে';
  return Math.floor(sec / 60) + ' মি ' + (sec % 60) + ' সে';
}

function detectKind(url, chosen) {
  if (chosen !== 'auto') return chosen;
  if (url.includes('.m3u8')) return 'm3u8';
  if (/(youtube\.com|youtu\.be|facebook\.com|tiktok\.com|instagram\.com)/i.test(url)) return 'video';
  return 'direct';
}

function guessFilename(url) {
  try {
    const base = decodeURIComponent(new URL(url).pathname.split('/').pop());
    if (base && base.includes('.')) return base;
  } catch (_) { /* ignore */ }
  return null;
}

function render() {
  emptyEl.style.display = items.size === 0 ? 'block' : 'none';
  listEl.innerHTML = '';
  for (const item of items.values()) {
    const card = document.createElement('div');
    card.className = 'card';
    const statusText = {
      downloading: '⬇ ডাউনলোড হচ্ছে…', paused: '⏸ থামানো', done: '✅ সম্পন্ন',
      error: '❌ ব্যর্থ', cancelled: '🚫 বাতিল'
    }[item.status] || item.status;
    card.innerHTML =
      '<div class="row"><b>' + escapeHtml(item.filename) + '</b><span class="badge">' + escapeHtml(item.kind) + '</span></div>' +
      '<div class="row muted small">' + escapeHtml(item.url) + '</div>' +
      '<div class="bar"><div class="fill" style="width:' + (item.percent || 0) + '%"></div></div>' +
      '<div class="row small"><span>' + (item.percent || 0) + '% • ' + fmtBytes(item.received) +
      (item.total ? ' / ' + fmtBytes(item.total) : '') + '</span><span>' +
      escapeHtml(item.speed || '') + ' • ETA ' + fmtEta(item.eta) + '</span><span>' + statusText + '</span></div>' +
      (item.error ? '<div class="error">' + escapeHtml(item.error) + '</div>' : '') +
      '<div class="actions">' +
      (item.status === 'downloading' ? '<button data-act="pause">⏸ Pause</button>' : '') +
      (item.status === 'paused' ? '<button data-act="resume">▶ Resume</button>' : '') +
      (item.status === 'downloading' || item.status === 'paused' ? '<button data-act="cancel">✖ Cancel</button>' : '') +
      '</div>';
    card.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.getAttribute('data-act');
        if (act === 'pause') window.ghostAPI.pauseDownload(item.id);
        if (act === 'resume') window.ghostAPI.resumeDownload(item.id);
        if (act === 'cancel') window.ghostAPI.cancelDownload(item.id);
      });
    });
    listEl.appendChild(card);
  }
}

function addDownload() {
  const url = urlInput.value.trim();
  if (!url) { alert('প্রথমে একটি লিংক বসান।'); return; }
  if (!/^https?:\/\//i.test(url)) { alert('লিংকটি http:// বা https:// দিয়ে শুরু হতে হবে।'); return; }
  const kind = detectKind(url, kindSelect.value);
  const id = 'dl-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  const filename = guessFilename(url) || (kind === 'm3u8' ? 'video-' + Date.now() + '.ts' : 'download-' + Date.now());
  const item = { id, url, kind, filename, status: 'downloading', percent: 0, speed: '', eta: 0, received: 0, total: 0 };
  items.set(id, item);
  if (kind === 'm3u8') window.ghostAPI.downloadM3U8({ id, url, filename });
  else if (kind === 'video') window.ghostAPI.ytDlpDownload({ id, url, format: 'video', filename });
  else if (kind === 'audio') window.ghostAPI.ytDlpDownload({ id, url, format: 'audio', filename });
  else window.ghostAPI.downloadFile({ id, url, filename });
  urlInput.value = '';
  render();
}

document.getElementById('add').addEventListener('click', addDownload);
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addDownload(); });
document.getElementById('openFolder').addEventListener('click', () => window.ghostAPI.openDownloadsFolder());

window.ghostAPI.getDownloadsDir().then((dir) => {
  document.getElementById('dirHint').textContent = 'ফাইল যাবে এখানে: ' + dir;
});

window.ghostAPI.onProgress((data) => {
  const item = items.get(data.id);
  if (!item) return;
  item.percent = data.percent || 0;
  item.speed = data.speed || '';
  item.eta = data.eta || 0;
  item.received = data.received || 0;
  item.total = data.total || 0;
  render();
});
window.ghostAPI.onDone((data) => {
  const item = items.get(data.id);
  if (!item) return;
  item.status = 'done';
  item.percent = 100;
  saveHistory({ filename: item.filename, kind: item.kind, when: new Date().toLocaleString('bn-BD') });
  render();
  renderHistory();
});
window.ghostAPI.onError((data) => {
  const item = items.get(data.id);
  if (!item) return;
  item.status = 'error';
  item.error = data.message;
  render();
});
window.ghostAPI.onPaused((data) => {
  const item = items.get(data.id);
  if (!item) return;
  item.status = 'paused';
  render();
});
window.ghostAPI.onCancelled((data) => {
  items.delete(data.id);
  render();
});

render();
renderHistory();
