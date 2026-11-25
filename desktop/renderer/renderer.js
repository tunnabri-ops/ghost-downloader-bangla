const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
const historyEl = document.getElementById('history');
const historySearchEl = document.getElementById('historySearch');
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
  // Feature 8b: live filter by filename or URL; empty query shows everything.
  const q = historySearchEl.value.trim().toLowerCase();
  const shown = q
    ? h.filter((e) => (e.filename || '').toLowerCase().includes(q) || (e.url || '').toLowerCase().includes(q))
    : h;
  if (h.length === 0) {
    historyEl.innerHTML = '<li>কোনো সম্পন্ন ডাউনলোড নেই।</li>';
  } else if (shown.length === 0) {
    historyEl.innerHTML = '<li>“' + escapeHtml(historySearchEl.value.trim()) + '” মিলে এমন কিছু ইতিহাসে নেই।</li>';
  } else {
    historyEl.innerHTML = shown.map((e) => '<li>' + escapeHtml(e.filename) + ' <span class="muted">(' + escapeHtml(e.kind) + ' • ' + escapeHtml(e.when) + ')</span></li>').join('');
  }
}
historySearchEl.addEventListener('input', renderHistory);
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
  const item = { id, url, kind, filename, status: 'downloading', percent: 0, speed: '', speedBps: 0, eta: 0, received: 0, total: 0 };
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

// Feature 9: update notice (banner) + on-demand check from the renderer.
const updateBanner = document.getElementById('updateBanner');
const updateText = document.getElementById('updateText');
const updateNote = document.getElementById('updateNote');
let latestReleaseUrl = '';
let noteTimer = null;
function showNote(msg) {
  updateNote.textContent = msg;
  updateNote.hidden = false;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { updateNote.hidden = true; }, 6000);
}
document.getElementById('checkUpdate').addEventListener('click', () => {
  updateBanner.hidden = true;
  showNote('আপডেট যাচাই করা হচ্ছে…');
  window.ghostAPI.checkForUpdate();
});
document.getElementById('openRelease').addEventListener('click', () => {
  if (latestReleaseUrl) window.ghostAPI.openExternal(latestReleaseUrl);
});
document.getElementById('dismissUpdate').addEventListener('click', () => { updateBanner.hidden = true; });
window.ghostAPI.onUpdateAvailable((data) => {
  latestReleaseUrl = data.url || '';
  updateText.textContent = '🎉 নতুন ভার্সন এসেছে: ' + data.version + ' (আপনার ভার্সন: ' + data.currentVersion + ') — রিলিজ পাতা থেকে নতুন exe নামান।';
  updateNote.hidden = true;
  updateBanner.hidden = false;
});
window.ghostAPI.onUpdateCheckDone((data) => {
  updateBanner.hidden = true;
  showNote('✅ আপনি সর্বশেষ ভার্সন (' + data.currentVersion + ') ব্যবহার করছেন।');
});

window.ghostAPI.getDownloadsDir().then((dir) => {
  document.getElementById('dirHint').textContent = 'ফাইল যাবে এখানে: ' + dir;
});

window.ghostAPI.onProgress((data) => {
  const item = items.get(data.id);
  if (!item) return;
  item.percent = data.percent || 0;
  item.speed = data.speed || '';
  item.speedBps = data.speedBps || 0;
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
  saveHistory({ filename: item.filename, kind: item.kind, when: new Date().toLocaleString('bn-BD'), url: item.url });
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

// ---------- v1.1.0: clipboard monitor ----------
// Main process polls the clipboard and sends a found link; the user decides.
const clipBar = document.getElementById('clipBar');
const clipUrlEl = document.getElementById('clipUrl');
const clipToggle = document.getElementById('clipToggle');
let clipOfferedUrl = '';
try {
  const savedClip = localStorage.getItem('ghost-clip-monitor');
  if (savedClip !== null) clipToggle.checked = savedClip === '1';
} catch (_) { /* ignore */ }
window.ghostAPI.setClipboardMonitor(clipToggle.checked);
clipToggle.addEventListener('change', () => {
  window.ghostAPI.setClipboardMonitor(clipToggle.checked);
  try { localStorage.setItem('ghost-clip-monitor', clipToggle.checked ? '1' : '0'); } catch (_) { /* ignore */ }
});
window.ghostAPI.onClipboardLink((data) => {
  if (!data || !data.url) return;
  clipOfferedUrl = data.url;
  clipUrlEl.textContent = data.url;
  clipBar.hidden = false;
});
document.getElementById('clipAdd').addEventListener('click', () => {
  clipBar.hidden = true;
  if (!clipOfferedUrl) return;
  urlInput.value = clipOfferedUrl;
  clipOfferedUrl = '';
  addDownload();
});
document.getElementById('clipDismiss').addEventListener('click', () => {
  clipBar.hidden = true;
  clipOfferedUrl = '';
});

// ---------- v1.1.0: scheduled downloads ----------
const schedTimeEl = document.getElementById('schedTime');
const schedListEl = document.getElementById('schedList');
function fmtSchedTime(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
schedTimeEl.value = fmtSchedTime(new Date(Date.now() + 3600 * 1000));
function renderSchedules(list) {
  if (!list.length) {
    schedListEl.innerHTML = '<li>কোনো নির্ধারিত ডাউনলোড নেই।</li>';
    return;
  }
  schedListEl.innerHTML = '';
  for (const e of list) {
    const li = document.createElement('li');
    const when = new Date(e.runAt).toLocaleString('bn-BD');
    li.innerHTML = '<span>⏰ ' + escapeHtml(when) + ' — ' + escapeHtml(e.url) + '</span> ';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ghost small';
    btn.textContent = 'বাতিল';
    btn.addEventListener('click', () => window.ghostAPI.cancelSchedule(e.id));
    li.appendChild(btn);
    schedListEl.appendChild(li);
  }
}
document.getElementById('scheduleAdd').addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (!url) { alert('প্রথমে একটি লিংক বসান।'); return; }
  if (!/^https?:\/\//i.test(url)) { alert('লিংকটি http:// বা https:// দিয়ে শুরু হতে হবে।'); return; }
  if (!schedTimeEl.value) { alert('একটি তারিখ ও সময় বেছে নিন।'); return; }
  const runAt = new Date(schedTimeEl.value);
  if (Number.isNaN(runAt.getTime()) || runAt.getTime() <= Date.now()) {
    alert('নির্ধারিত সময়টি ভবিষ্যতের হতে হবে।');
    return;
  }
  const kind = detectKind(url, kindSelect.value);
  const id = 'sched-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  window.ghostAPI.scheduleDownload({
    id, url, kind,
    filename: guessFilename(url) || (kind === 'm3u8' ? 'video-' + Date.now() + '.ts' : 'download-' + Date.now()),
    runAt: runAt.toISOString()
  });
  urlInput.value = '';
  showNote('⏰ নির্ধারিত হয়েছে: ' + runAt.toLocaleString('bn-BD'));
});
window.ghostAPI.getSchedules().then(renderSchedules);
window.ghostAPI.onScheduleUpdated((list) => renderSchedules(list || []));
window.ghostAPI.onScheduleDue((entry) => {
  showNote('⏰ নির্ধারিত ডাউনলোড শুরু হয়েছে: ' + (entry && entry.url ? entry.url : ''));
});

// ---------- v1.1.0: live speed graph + today's totals ----------
const speedCanvas = document.getElementById('speedGraph');
const todayEl = document.getElementById('todayTotals');
const speedSamples = [];
function renderTodayTotals(t) {
  if (!t) return;
  todayEl.textContent = '📊 আজ নামানো: ' + fmtBytes(t.bytes) + ' • ' + t.files + ' ফাইল';
}
function drawSpeedGraph() {
  const ctx = speedCanvas.getContext('2d');
  const w = speedCanvas.width;
  const h = speedCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);
  if (speedSamples.length < 2) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('ডাউনলোড চললে এখানে লাইভ গতি গ্রাফ উঠবে', 12, h / 2 + 5);
    return;
  }
  const peak = Math.max.apply(null, speedSamples) || 1;
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < speedSamples.length; i++) {
    const x = (i / 59) * w;
    const y = h - 6 - (speedSamples[i] / peak) * (h - 12);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText('সর্বোচ্চ: ' + fmtBytes(Math.round(peak)) + '/s', 8, 14);
}
setInterval(() => {
  let total = 0;
  for (const item of items.values()) {
    if (item.status === 'downloading') total += item.speedBps || 0;
  }
  speedSamples.push(total);
  if (speedSamples.length > 60) speedSamples.shift();
  drawSpeedGraph();
}, 1000);
window.ghostAPI.getTodayTotals().then(renderTodayTotals);
window.ghostAPI.onTodayTotals((t) => renderTodayTotals(t));
drawSpeedGraph();

render();
renderHistory();
