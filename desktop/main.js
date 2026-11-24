const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

let mainWindow = null;
const DOWNLOADS_DIR = path.join(app.getPath('downloads'), 'GhostDownloader');
fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

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
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
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
          speed: formatSpeed(speed), eta, percent: state.total > 0
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
          speed: '0 B/s', eta: 0, percent: 100
        });
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
        speed: speed.toFixed(1) + ' সেগমেন্ট/সে', eta: speed > 0 ? Math.round((segments.length - i - 1) / speed) : 0,
        percent: Math.round(((i + 1) / segments.length) * 100)
      });
    }
    out.end();
    send('download-done', { id, filePath });
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
ipcMain.on('yt-dlp-download', (_event, payload) => {
  const isAudio = payload.format === 'audio';
  const ext = isAudio ? 'mp3' : 'mp4';
  const filename = (payload.filename || 'video-' + Date.now()) + '.' + ext;
  const outPath = path.join(DOWNLOADS_DIR, '%(title)s.' + ext);
  const args = isAudio
    ? ['-x', '--audio-format', 'mp3', '--newline', '-o', outPath, payload.url]
    : ['-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]', '--merge-output-format', 'mp4', '--newline', '-o', outPath, payload.url];
  let proc;
  try {
    proc = spawn('yt-dlp', args);
  } catch (err) {
    send('download-error', { id: payload.id, message: 'yt-dlp চালু করা যায়নি: ' + err.message });
    return;
  }
  proc.on('error', () => {
    send('download-error', {
      id: payload.id,
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
          id: payload.id, received: 0, total: 0,
          speed: m[3], eta: m[4], percent: Math.round(parseFloat(m[1]))
        });
      }
    }
  });
  proc.stderr.on('data', () => { /* yt-dlp warnings go here; ignore */ });
  proc.on('close', (code) => {
    if (code === 0) {
      send('download-done', { id: payload.id, filePath: DOWNLOADS_DIR });
    } else {
      send('download-error', { id: payload.id, message: 'yt-dlp ব্যর্থ হয়েছে (exit ' + code + ') — লিংকটি যাচাই করুন।' });
    }
  });
});

// ---------- misc ----------
ipcMain.on('open-downloads-folder', () => {
  shell.openPath(DOWNLOADS_DIR);
});

ipcMain.handle('get-downloads-dir', () => DOWNLOADS_DIR);
