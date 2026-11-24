# 👻 Ghost Downloader Bangla

[![Download Manager](https://img.shields.io/badge/type-download%20manager-blue)](https://github.com/tunnabri-ops/ghost-downloader-bangla)
[![Platforms](https://img.shields.io/badge/platforms-Web%20%7C%20Python%20%7C%20Electron-green)](https://github.com/tunnabri-ops/ghost-downloader-bangla)
[![Language](https://img.shields.io/badge/UI-Bangla%20%2B%20English-orange)](https://github.com/tunnabri-ops/ghost-downloader-bangla)

**A Bangla-first download manager for everyone — web, Python desktop, and Electron desktop in one project.**

**One app that downloads anything — with a Bangla-first interface and three ways to run it.**

> বাংলা সংস্করণ নিচে আছে। / Bangla version below.

## ✨ Features

- Paste a link, download it — direct files with a real progress bar, live speed and ETA
- **Pause / Resume** (continues from where it stopped, when the server supports Range)
- **Download queue** — many downloads at once, with filters
- **M3U8 playlists** — downloads every segment and joins them into one `.ts` file
- **YouTube / Facebook / TikTok** — via yt-dlp (when installed), plus an in-page player
- **Multi-connection chunked downloads** (Python + desktop) for faster speeds
- **M3U8 quality picker** — choose 1080p / 720p / 480p instead of always taking the best stream
- **Download history** (web + desktop) — finished downloads are saved; re-download any of them in one click, search your history on desktop
- **Auto-retry** — a network failure retries by itself up to 3 times
- **Speed limit** — cap downloads at 1 MB/s or 5 MB/s (web)
- **Light theme** — one-tap dark / light switch, remembered in the browser
- **yt-dlp quality picker** (Python desktop) — Best / 720p / Audio only
- **Auto-shutdown** (Python desktop) — optionally shut the computer down when the queue finishes (60-second countdown, cancellable)
- **Minimize to tray** (Electron desktop) — closing the window hides it in the system tray
- **Update check** (Electron desktop) — checks GitHub releases and tells you when a newer version is out

## 🚀 Three versions

| Version | Folder | Run it |
|---|---|---|
| 🌐 Web app | `web/` | Open `index.html` in a browser — nothing to install |
| 🐍 Python desktop | `python/` | `pip install -r requirements.txt` → `python app.py` |
| 🖥️ Desktop app | `desktop/` | `npm install` → `npm start` (Windows `.exe` is built by GitHub Actions) |

## ⚠️ Honest limits

- YouTube / Facebook / TikTok downloads need **yt-dlp installed** (`pip install -U yt-dlp`). Without it the app says so in Bangla — it never shows a fake download.
- Encrypted M3U8 (AES `#EXT-X-KEY`) is not supported.
- Magnet / BitTorrent / FTP are **not** in this version yet.
- Some sites block direct downloads — use the yt-dlp mode then.
- The web version follows the browser's CORS rules; some hosts will refuse a direct download.

## 🇧🇩 বাংলা

**Ghost Downloader বাংলা — সবার জন্য বাংলা ডাউনলোড ম্যানেজার।**

- লিংক বসালেই ডাউনলোড — আসল প্রগ্রেস বার, লাইভ স্পিড, ETA
- Pause / Resume (সার্ভার Range সাপোর্ট করলে থামানো জায়গা থেকে)
- একসাথে অনেক ডাউনলোডের কিউ
- M3U8 প্লেলিস্টের সব সেগমেন্ট জোড়া দিয়ে একটা `.ts` ফাইল
- YouTube / Facebook / TikTok — yt-dlp দিয়ে (ইনস্টল থাকলে), সাথে এমবেড প্লেয়ার
- বাংলা ইন্টারফেস, ডার্ক ডিজাইন, ডাউনলোড হিস্ট্রি

## 📄 License

MIT — use it however you like; credit is appreciated.
