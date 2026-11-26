'use strict';
/**
 * Headless Node tests for Ghost Downloader Bangla v1.1.0 (desktop/lib.js).
 * No Electron needed. Run:  node test-v110.js
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  extractDownloadUrl, secondsUntilRun, parseSpeedToBps, DailyTotals, SpeedSamples
} = require('./lib');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok - ' + name);
  } catch (err) {
    console.error('FAIL - ' + name + ': ' + err.message);
    process.exitCode = 1;
  }
}

// --- clipboard URL detection ---
check('clipboard: plain http link', () => {
  assert.strictEqual(extractDownloadUrl('https://example.com/video.mp4'), 'https://example.com/video.mp4');
});
check('clipboard: url buried in sentence', () => {
  assert.strictEqual(extractDownloadUrl('see https://example.com/a.mp4 ok'), 'https://example.com/a.mp4');
});
check('clipboard: trailing full stop stripped', () => {
  assert.strictEqual(extractDownloadUrl('Get it: https://example.com/a.mp4.'), 'https://example.com/a.mp4');
});
check('clipboard: magnet link', () => {
  const url = 'magnet:?xt=urn:btih:ABCDEF1234567890&dn=example';
  assert.strictEqual(extractDownloadUrl(url), url);
});
check('clipboard: plain text rejected', () => {
  assert.strictEqual(extractDownloadUrl('hello world, no link here'), null);
  assert.strictEqual(extractDownloadUrl(''), null);
  assert.strictEqual(extractDownloadUrl(null), null);
});
check('clipboard: ftp rejected', () => {
  assert.strictEqual(extractDownloadUrl('ftp://example.com/file.zip'), null);
});

// --- scheduler delay math ---
check('scheduler: future time is positive (~3600s)', () => {
  const now = new Date('2026-11-26T10:00:00').getTime();
  const delay = secondsUntilRun('2026-11-26T11:00:00', now);
  assert.ok(Math.abs(delay - 3600) < 1, 'got ' + delay);
});
check('scheduler: past time is not positive', () => {
  const now = new Date('2026-11-26T10:00:00').getTime();
  assert.ok(secondsUntilRun('2026-11-26T09:30:00', now) <= 0);
});
check('scheduler: unparseable time is null', () => {
  assert.strictEqual(secondsUntilRun('not a date'), null);
});

// --- speed string parsing ---
check('speed: MB/s parsed to bytes', () => {
  assert.strictEqual(parseSpeedToBps('1.5 MB/s'), 1572864);
});
check('speed: KB/s and B/s parsed', () => {
  assert.strictEqual(parseSpeedToBps('512 KB/s'), 524288);
  assert.strictEqual(parseSpeedToBps('42 B/s'), 42);
});
check('speed: segment-rate and empty are 0', () => {
  assert.strictEqual(parseSpeedToBps('3.2 সেগমেন্ট/সে'), 0);
  assert.strictEqual(parseSpeedToBps(''), 0);
});

// --- today's totals ---
check('totals: accumulates bytes and files', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gdb-')), 'totals.json');
  const t = new DailyTotals(file);
  t.add(1024);
  t.add(2048);
  assert.deepStrictEqual([t.today().bytes, t.today().files], [3072, 2]);
});
check('totals: persists across reload', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdb-'));
  const file = path.join(dir, 'totals.json');
  new DailyTotals(file).add(5000, 2);
  const reloaded = new DailyTotals(file);
  assert.deepStrictEqual([reloaded.today().bytes, reloaded.today().files], [5000, 2]);
});
check('totals: yesterday stamped file is ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdb-'));
  const file = path.join(dir, 'totals.json');
  const yesterday = new Date(Date.now() - 86400000);
  const y = yesterday.getFullYear() + '-' + String(yesterday.getMonth() + 1).padStart(2, '0') + '-' + String(yesterday.getDate()).padStart(2, '0');
  fs.writeFileSync(file, JSON.stringify({ date: y, bytes: 999999, files: 9 }));
  const t = new DailyTotals(file);
  assert.deepStrictEqual([t.today().bytes, t.today().files], [0, 0]);
});
check('totals: new day resets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdb-'));
  const file = path.join(dir, 'totals.json');
  const t = new DailyTotals(file);
  t.add(4096, 1);
  t.date = '2000-01-01'; // simulate the day having changed
  assert.deepStrictEqual([t.today().bytes, t.today().files], [0, 0]);
});

// --- speed samples ---
check('samples: capped at max length', () => {
  const s = new SpeedSamples(5);
  for (let i = 0; i < 10; i++) s.add(i);
  assert.deepStrictEqual(s.values(), [5, 6, 7, 8, 9]);
});
check('samples: keeps order', () => {
  const s = new SpeedSamples();
  s.add(10); s.add(20);
  assert.deepStrictEqual(s.values(), [10, 20]);
});

// --- video-site detection: hostname match, not substring ---
// detectKind lives in renderer/renderer.js (DOM file); extract the real
// function source and run it here — it only uses `new URL`, so plain
// Node can execute it.
const rendererSrc = fs.readFileSync(path.join(__dirname, 'renderer', 'renderer.js'), 'utf8');
const detectKindSrc = rendererSrc.match(/function detectKind\(url, chosen\) \{[\s\S]*?\n\}/);
if (!detectKindSrc) throw new Error('detectKind not found in renderer.js');
const detectKind = new Function(detectKindSrc[0] + '; return detectKind;')();
check('detectKind: real youtube goes to yt-dlp', () => {
  assert.strictEqual(detectKind('https://www.youtube.com/watch?v=abc123', 'auto'), 'video');
  assert.strictEqual(detectKind('https://youtu.be/abc123', 'auto'), 'video');
});
check('detectKind: lookalike hosts stay direct', () => {
  assert.strictEqual(detectKind('https://fakeyoutube.com/watch?v=1', 'auto'), 'direct');
  assert.strictEqual(detectKind('https://myfacebook.com/page', 'auto'), 'direct');
  assert.strictEqual(detectKind('https://example.com/file.zip', 'auto'), 'direct');
});
check('detectKind: m3u8 still detected', () => {
  assert.strictEqual(detectKind('https://example.com/stream.m3u8', 'auto'), 'm3u8');
});

console.log(passed + ' checks passed' + (process.exitCode ? ' (with failures)' : ''));
