const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const { extractDownloadUrl, secondsUntilRun, parseSpeedToBps, DailyTotals } = require('./lib');

let mainWindow = null;
let tray = null;
let isQuitting = false;
const DOWNLOADS_DIR = path.join(app.getPath('downloads'), 'GhostDownloader');
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

// v1.1.0: today's totals (totals.json) + scheduled downloads (schedules.json),
// both in the app's userData folder so they survive restarts.
const TOTALS_FILE = path.join(app.getPath('userData'), 'totals.json');
const SCHEDULES_FILE = path.join(app.getPath('userData'), 'schedules.json');
const todayTotals = new DailyTotals(TOTALS_FILE);
let schedules = []; // { id, url, filename, kind, runAt }
function loadSchedules() {
  try {
    const saved = JSON.parse(fs.readFileSync(SCHEDULES_FILE, 'utf8'));
    if (Array.isArray(saved)) {
      // Drop entries whose time passed while the app was closed — a stale
      // download starting hours late would surprise the user.
      schedules = saved.filter((e) => {
        const delay = secondsUntilRun(e.runAt);
        return delay !== null && delay > 0;
      });
    }
  } catch (_) { schedules = []; }
}
function saveSchedules() {
  try { fs.writeFileSync(SCHEDULES_FILE, JSON.stringify(schedules)); } catch (_) { /* best-effort */ }
}

/** v1.1.0: count a finished download towards today's totals, then notify the UI. */
function recordToday(filePath) {
  let bytes = 0;
  try {
    const st = filePath && fs.statSync(filePath);
    if (st && st.isFile()) bytes = st.size;
  } catch (_) { /* file unknown (e.g. yt-dlp folder): count the file, 0 bytes */ }
  todayTotals.add(bytes, 1);
  send('today-totals', todayTotals.today());
}

// Small built-in tray icon (green ghost, 32x32 PNG, embedded — no icon file needed).
const TRAY_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAjklEQVR4nGNgIACUjsb9pwQTMp8mlpLtGFpZTJRD6GU5TkcMqAPobTmGI0a2AwbKcrgjhpQD2JSlqKqOaAeADETHlKgbWg7AZig2w4lVN/RCYFA4gNTUTfVcQEs89B1ASnBT1QHkJDiqOYDcPD98QoCqaWDAGySjDhgUzfJB4YAB75rRwyEELaaFYwiZDwCS5PJgPMNCegAAAABJRU5ErkJggg==';

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
  tray = new Tray(icon);
  tray.setToolTip('Ghost Downloader Bangla');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'দেখান', click: showWindow },
    { label: 'আপডেট চেক করুন', click: () => checkForUpdate(true) },
    { type: 'separator' },
    { label: 'বন্ধ করুন', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', showWindow);
}

// id -> { id, url, filename, filePath, received, total, status, req, file, startedAt, lastBytes, lastTime }
const downloads = new Map();

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function safeFilename(url, fallback) {
  try {
    const u = new URL(url);
    const base = path.basename(decodeURIComponent(u.pathname));
    if (base && base.includes('.')) return base.replace(/[<>:"/\\|?*]/g, '_');
  } catch (_) { /* fall through */ }
  return fallback;
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec >= 1024 * 1024) return (bytesPerSec / (1024 * 1024)).toFixed(2) + ' MB/s';
  if (bytesPerSec >= 1024) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
  return bytesPerSec + ' B/s';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 640,
    title: 'Ghost Downloader Bangla',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Feature 8a: closing the window hides it to the tray instead of quitting.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  loadSchedules();
  // v1.1.0: clipboard watch + scheduled-download check (app must be running).
  setInterval(checkClipboard, 2000);
  setInterval(checkSchedules, 15000);
  // Feature 9: check for a newer release shortly after startup (silent on failure).
  setTimeout(() => checkForUpdate(false), 3000);
});
app.on('before-quit', () => { isQuitting = true; });
app.on('window-all-closed', () => {
  // Stay alive in the tray when the window is only hidden; quit only if no tray.
  if (process.platform !== 'darwin' && !tray) app.quit();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ---------- direct HTTP/HTTPS download (pause/resume via Range) ----------
function httpGet(url, headers, redirectsLeft, onResponse, onError) {
  const mod = url.startsWith('https://') ? https : http;
  const req = mod.get(url, { headers }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
      const next = new URL(res.headers.location, url).toString();
      httpGet(next, headers, redirectsLeft - 1, onResponse, onError);
      return;
    }
    onResponse(res);
  });
  req.on('error', onError);
  return req;
}

function startDirectDownload(id, url, filename) {
  const filePath = path.join(DOWNLOADS_DIR, filename);
  let state = downloads.get(id);
  if (!state) {
    state = {
      id, url, filename, filePath, received: 0, total: 0,
      status: 'downloading', startedAt: Date.now(), lastBytes: 0, lastTime: Date.now()
    };
    downloads.set(id, state);
  }
  state.status = 'downloading';
  state.url = url;

  const headers = {};
  if (state.received > 0) headers.Range = 'bytes=' + state.received + '-';

  const file = fs.createWriteStream(filePath, { flags: state.received > 0 ? 'a' : 'w' });
  state.file = file;

  const req = httpGet(url, headers, 5, (res) => {
    if (res.statusCode === 416) { // range not satisfiable — file already complete
      file.close();
      state.status = 'done';
      send('download-done', { id, filePath });
      return;
    }
    if (res.statusCode !== 200 && res.statusCode !== 206) {
      file.close();
      send('download-error', { id, message: 'সার্ভার এরর: HTTP ' + res.statusCode });
      return;
    }
    if (res.statusCode === 200 && state.received > 0) {
      // server ignored Range — restart from zero
      state.received = 0;
      state.lastBytes = 0;
    }
    if (res.headers['content-length']) {
      const len = parseInt(res.headers['content-length'], 10);
      state.total = state.received + (isNaN(len) ? 0 : len);
    }
    res.on('data', (chunk) => {
      state.received += chunk.length;
      const now = Date.now();
      const dt = (now - state.lastTime) / 1000;
      if (dt >= 0.25) {
        const speed = (state.received - state.lastBytes) / dt;
        const eta = speed > 0 && state.total > 0
          ? Math.round((state.total - state.received) / speed) : 0;
        send('download-progress', {
          id, received: state.received, total: state.total,
          speed: formatSpeed(speed), speedBps: Math.round(speed), eta, percent: state.total > 0
            ? Math.round((state.received / state.total) * 100) : 0
        });
        state.lastBytes = state.received;
        state.lastTime = now;
      }
    });
    res.on('end', () => {
      file.close();
      if (state.status === 'downloading') {
        state.status = 'done';
        send('download-progress', {
          id, received: state.received, total: state.total || state.received,
          speed: '0 B/s', speedBps: 0, eta: 0, percent: 100
        });
        recordToday(filePath);
        send('download-done', { id, filePath });
      }
    });
    res.on('error', () => {
      file.close();
      if (state.status === 'downloading') {
        send('download-error', { id, message: 'ডাউনলোডের মাঝে সংযোগ বিচ্ছিন্ন হয়েছে — Resume চাপুন।' });
      }
    });
  }, () => {
    file.close();
    if (state.status === 'downloading') {
      send('download-error', { id, message: 'ডাউনলোড করা যায়নি — লিংকটি যাচাই করুন।' });
    }
  });
  state.req = req;
}

ipcMain.on('download-file', (_event, payload) => {
  const filename = payload.filename || safeFilename(payload.url, 'download-' + Date.now());
  startDirectDownload(payload.id, payload.url, filename);
});

ipcMain.on('download-pause', (_event, id) => {
  const state = downloads.get(id);
  if (!state || state.status !== 'downloading') return;
  state.status = 'paused';
  if (state.req) state.req.destroy();
  if (state.file) state.file.close();
  send('download-paused', { id });
});

ipcMain.on('download-resume', (_event, id) => {
  const state = downloads.get(id);
  if (!state || state.status !== 'paused') return;
  startDirectDownload(id, state.url, state.filename);
});

ipcMain.on('download-cancel', (_event, id) => {
  const state = downloads.get(id);
  if (!state) return;
  if (state.req) state.req.destroy();
  if (state.file) state.file.close();
  try { fs.unlinkSync(state.filePath); } catch (_) { /* partial file may not exist */ }
  downloads.delete(id);
  send('download-cancelled', { id });
});

// ---------- M3U8 download: fetch playlist, download segments, concat to .ts ----------
function fetchText(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    httpGet(url, {}, redirectsLeft, (res) => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    }, reject);
  });
}

function fetchBinary(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    httpGet(url, {}, redirectsLeft, (res) => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }, reject);
  });
}

async function downloadM3U8(id, url, filename) {
  const filePath = path.join(DOWNLOADS_DIR, filename);
  try {
    let playlist = await fetchText(url, 5);
    // Variant playlist? Pick the first variant stream.
    const variantLines = playlist.split('\n').map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('.m3u8'));
    if (variantLines.length > 0) {
      const variantUrl = new URL(variantLines[0], url).toString();
      playlist = await fetchText(variantUrl, 5);
      url = variantUrl;
    }
    if (playlist.includes('#EXT-X-KEY')) {
      send('download-error', { id, message: 'এনক্রিপ্টেড M3U8 সমর্থিত নয়।' });
      return;
    }
    const segments = playlist.split('\n').map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => new URL(l, url).toString());
    if (segments.length === 0) {
      send('download-error', { id, message: 'প্লেলিস্টে কোনো সেগমেন্ট পাওয়া যায়নি।' });
      return;
    }
    const out = fs.createWriteStream(filePath);
    const startedAt = Date.now();
    for (let i = 0; i < segments.length; i++) {
      const data = await fetchBinary(segments[i], 5);
      out.write(data);
      const elapsed = (Date.now() - startedAt) / 1000;
      const speed = elapsed > 0 ? (i + 1) / elapsed : 0;
      send('download-progress', {
        id, received: i + 1, total: segments.length,
        speed: speed.toFixed(1) + ' সেগমেন্ট/সে', speedBps: 0, eta: speed > 0 ? Math.round((segments.length - i - 1) / speed) : 0,
        percent: Math.round(((i + 1) / segments.length) * 100)
      });
    }
    out.end(() => {
      recordToday(filePath);
      send('download-done', { id, filePath });
    });
  } catch (err) {
    send('download-error', { id, message: 'M3U8 ডাউনলোড ব্যর্থ: ' + err.message });
  }
}

ipcMain.on('download-m3u8', (_event, payload) => {
  const filename = payload.filename || safeFilename(payload.url, 'video-' + Date.now() + '.ts');
  const name = filename.endsWith('.ts') ? filename : filename.replace(/\.[^.]+$/, '') + '.ts';
  downloadM3U8(payload.id, payload.url, name);
});

// ---------- YouTube / social video via yt-dlp (must be installed) ----------
function startYtDlpDownload(id, url, format, filename) {
  const isAudio = format === 'audio';
  const ext = isAudio ? 'mp3' : 'mp4';
  const outPath = path.join(DOWNLOADS_DIR, '%(title)s.' + ext);
  const args = isAudio
    ? ['-x', '--audio-format', 'mp3', '--newline', '-o', outPath, url]
    : ['-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]', '--merge-output-format', 'mp4', '--newline', '-o', outPath, url];
  let proc;
  try {
    proc = spawn('yt-dlp', args);
  } catch (err) {
    send('download-error', { id, message: 'yt-dlp চালু করা যায়নি: ' + err.message });
    return;
  }
  proc.on('error', () => {
    send('download-error', {
      id,
      message: 'yt-dlp পাওয়া যায়নি — প্রথমে ইনস্টল করুন: pip install -U yt-dlp (তারপর আবার চেষ্টা করুন)'
    });
  });
  let buf = '';
  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%.*?of\s+([\d.]+(?:KiB|MiB|GiB)).*?at\s+([\d.]+(?:KiB|MiB|GiB)\/s).*?ETA\s+(\d+:\d+)/);
      if (m) {
        send('download-progress', {
          id, received: 0, total: 0,
          speed: m[3], speedBps: parseSpeedToBps(m[3]), eta: m[4], percent: Math.round(parseFloat(m[1]))
        });
      }
    }
  });
  proc.stderr.on('data', () => { /* yt-dlp warnings go here; ignore */ });
  proc.on('close', (code) => {
    if (code === 0) {
      // yt-dlp names the file itself, so no single file path is known —
      // count the file, 0 bytes (see README: today's totals skip yt-dlp bytes).
      recordToday(null);
      send('download-done', { id, filePath: DOWNLOADS_DIR });
    } else {
      send('download-error', { id, message: 'yt-dlp ব্যর্থ হয়েছে (exit ' + code + ') — লিংকটি যাচাই করুন।' });
    }
  });
}

ipcMain.on('yt-dlp-download', (_event, payload) => {
  startYtDlpDownload(payload.id, payload.url, payload.format, payload.filename);
});

// ---------- misc ----------
ipcMain.on('open-downloads-folder', () => {
  shell.openPath(DOWNLOADS_DIR);
});

ipcMain.handle('get-downloads-dir', () => DOWNLOADS_DIR);

// ---------- v1.1.0: clipboard monitor ----------
// Polls the system clipboard every 2s while the app runs. When a fresh
// http(s)/magnet link appears, the renderer is asked to offer it — the
// link is never added automatically, and each URL is offered only once.
let clipMonitorEnabled = true;
let lastClipText = '';
const clipOffered = new Set();
function checkClipboard() {
  if (!clipMonitorEnabled) return;
  let text = '';
  try { text = clipboard.readText(); } catch (_) { return; }
  if (!text || text === lastClipText) return;
  lastClipText = text;
  const url = extractDownloadUrl(text);
  if (!url || clipOffered.has(url)) return;
  clipOffered.add(url);
  send('clipboard-link-found', { url });
}
ipcMain.on('clipboard-monitor-set', (_event, enabled) => {
  clipMonitorEnabled = !!enabled;
});

// ---------- v1.1.0: scheduled downloads ----------
// Schedules persist in schedules.json; every 15s the due ones start.
// The app (even hidden in the tray) must be running at the due time.
function dispatchDownload(entry) {
  if (entry.kind === 'm3u8') {
    const name = entry.filename.endsWith('.ts') ? entry.filename : entry.filename.replace(/\.[^.]+$/, '') + '.ts';
    downloadM3U8(entry.id, entry.url, name);
  } else if (entry.kind === 'video' || entry.kind === 'audio') {
    startYtDlpDownload(entry.id, entry.url, entry.kind, entry.filename);
  } else {
    startDirectDownload(entry.id, entry.url, entry.filename);
  }
}
function checkSchedules() {
  const now = Date.now();
  const due = schedules.filter((e) => {
    const delay = secondsUntilRun(e.runAt, now);
    return delay !== null && delay <= 0;
  });
  if (!due.length) return;
  schedules = schedules.filter((e) => due.indexOf(e) < 0);
  saveSchedules();
  send('schedule-updated', schedules);
  for (const entry of due) {
    send('schedule-due', entry);
    dispatchDownload(entry);
  }
}
ipcMain.on('schedule-download', (_event, payload) => {
  if (!payload || !payload.url || !payload.runAt) return;
  if (secondsUntilRun(payload.runAt) === null || secondsUntilRun(payload.runAt) <= 0) return;
  schedules.push({
    id: payload.id || ('sched-' + Date.now()),
    url: payload.url,
    filename: payload.filename || safeFilename(payload.url, 'download-' + Date.now()),
    kind: payload.kind || 'direct',
    runAt: payload.runAt
  });
  saveSchedules();
  send('schedule-updated', schedules);
});
ipcMain.on('schedule-cancel', (_event, id) => {
  schedules = schedules.filter((e) => e.id !== id);
  saveSchedules();
  send('schedule-updated', schedules);
});
ipcMain.handle('get-schedules', () => schedules);

// ---------- v1.1.0: today's totals ----------
ipcMain.handle('get-today-totals', () => todayTotals.today());

// ---------- update check (Feature 9): never downloads or installs anything ----------
const RELEASES_API = 'https://api.github.com/repos/tunnabri-ops/ghost-downloader-bangla/releases/latest';
const RELEASES_PAGE = 'https://github.com/tunnabri-ops/ghost-downloader-bangla/releases/latest';

function compareVersions(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function checkForUpdate(manual) {
  let req;
  try {
    req = https.get(RELEASES_API, {
      headers: { 'User-Agent': 'Ghost-Downloader-Bangla', 'Accept': 'application/vnd.github+json' },
      timeout: 8000
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) return; // no releases / rate-limited: fail silently
          const rel = JSON.parse(body);
          const tag = rel && rel.tag_name;
          if (!tag) return;
          if (compareVersions(tag, app.getVersion()) > 0) {
            send('update-available', {
              version: tag,
              currentVersion: app.getVersion(),
              url: rel.html_url || RELEASES_PAGE
            });
          } else if (manual) {
            send('update-check-done', { available: false, version: tag, currentVersion: app.getVersion() });
          }
        } catch (_) { /* malformed response: fail silently */ }
      });
      res.on('error', () => { /* fail silently */ });
    });
  } catch (_) { return; /* fail silently */ }
  req.on('timeout', () => req.destroy());
  req.on('error', () => { /* no network: fail silently */ });
}

ipcMain.on('check-for-update', () => checkForUpdate(true));

ipcMain.on('open-external', (_event, url) => {
  // Only allow our own GitHub releases pages — never open arbitrary URLs.
  if (typeof url === 'string' && url.startsWith('https://github.com/tunnabri-ops/ghost-downloader-bangla/releases/')) {
    shell.openExternal(url);
  }
});
