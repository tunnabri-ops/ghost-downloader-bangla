'use strict';
/**
 * Ghost Downloader Bangla v1.1.0 — pure helpers shared by main.js.
 * No Electron imports here, so this file is unit-testable with plain Node:
 *   node test-v110.js
 *
 * Mirrors the same logic in python/downloader.py (extract_download_url,
 * seconds_until_run, DailyTotals, SpeedSamples).
 */
const fs = require('fs');

const URL_RE = /https?:\/\/[^\s"'<>]+/i;
const MAGNET_RE = /magnet:\?[^\s"'<>]+/i;
const TRAILING_PUNCT = /[.,;:!?"'’)>\]}]+$/;

/** First http(s) URL or magnet link in `text`, else null. Plain text -> null. */
function extractDownloadUrl(text) {
  if (!text) return null;
  let m = String(text).match(URL_RE);
  if (m) return m[0].replace(TRAILING_PUNCT, '');
  m = String(text).match(MAGNET_RE);
  if (m) return m[0].replace(TRAILING_PUNCT, '');
  return null;
}

/** Seconds from `nowMs` (default Date.now()) until an ISO date string. */
function secondsUntilRun(isoString, nowMs) {
  const t = new Date(isoString).getTime();
  if (Number.isNaN(t)) return null;
  return (t - (nowMs === undefined ? Date.now() : nowMs)) / 1000;
}

/** "2026-11-26" for the local calendar day (not UTC). */
function localDateStr(d) {
  const dt = d || new Date();
  const y = dt.getFullYear();
  const mo = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return y + '-' + mo + '-' + day;
}

/** "1.23 MB/s" / "512 KB/s" / "42 B/s" -> bytes per second; anything else -> 0. */
function parseSpeedToBps(s) {
  if (!s) return 0;
  const m = String(s).match(/([\d.]+)\s*(GB|MB|KB|B)\/s/i);
  if (!m) return 0;
  const mult = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
  return Math.round(parseFloat(m[1]) * (mult[m[2].toUpperCase()] || 1));
}

/** Bytes + file count downloaded "today", persisted in a small JSON file. */
class DailyTotals {
  constructor(filePath) {
    this.filePath = filePath;
    this.date = localDateStr();
    this.bytes = 0;
    this.files = 0;
    this.load();
  }
  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (data && data.date === localDateStr()) {
        this.date = data.date;
        this.bytes = data.bytes || 0;
        this.files = data.files || 0;
      }
    } catch (_) { /* missing/corrupt file: start from zero */ }
  }
  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify({ date: this.date, bytes: this.bytes, files: this.files }));
    } catch (_) { /* totals are best-effort; never crash a download over them */ }
  }
  rollover() {
    const today = localDateStr();
    if (this.date !== today) {
      this.date = today;
      this.bytes = 0;
      this.files = 0;
    }
  }
  add(nbytes, files) {
    this.rollover();
    this.bytes += Math.max(0, nbytes || 0);
    this.files += (files === undefined ? 1 : files);
    this.save();
  }
  today() {
    this.rollover();
    return { date: this.date, bytes: this.bytes, files: this.files };
  }
}

/** Capped rolling list of recent speed samples (bytes/sec) for the graph. */
class SpeedSamples {
  constructor(maxLen) {
    this.maxLen = maxLen || 60;
    this.samples = [];
  }
  add(value) {
    this.samples.push(value || 0);
    if (this.samples.length > this.maxLen) {
      this.samples.splice(0, this.samples.length - this.maxLen);
    }
  }
  values() {
    return this.samples.slice();
  }
}

module.exports = { extractDownloadUrl, secondsUntilRun, localDateStr, parseSpeedToBps, DailyTotals, SpeedSamples };
