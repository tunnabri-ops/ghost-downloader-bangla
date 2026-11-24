# 👻 Ghost Downloader Bangla — ডেস্কটপ অ্যাপ

বাংলা ডাউনলোড ম্যানেজার (ডেস্কটপ সংস্করণ) — XiaoYouChR/Ghost-Downloader-3 থেকে অনুপ্রাণিত, বাংলায় নতুন করে বানানো।

- **ডাইরেক্ট ফাইল** — HTTP/HTTPS লিংক থেকে ডাউনলোড, Pause/Resume (Range header), স্পিড + ETA
- **M3U8 ভিডিও** — প্লেলিস্টের সেগমেন্ট ডাউনলোড করে একটাই `.ts` ফাইলে জোড়া দেয়
- **YouTube / ভিডিও** — yt-dlp দিয়ে ভিডিও (1080p) বা শুধু অডিও MP3
- **ইতিহাস** — সম্পন্ন ডাউনলোডের তালিকা থাকে (localStorage)

## চালানো (লোকালে)

```bash
npm install
npm start
```

## Windows exe বানানো

`main` ব্রাঞ্চে push করলেই GitHub Actions (`build-exe.yml`) exe বানিয়ে artifact হিসেবে দেবে — নাম **GhostDownloaderBangla-Windows**। হাতে বানাতে চাইলে:

```bash
npm run build
```

## সীমা (সত্যি কথা)

- YouTube / Facebook / TikTok ডাউনলোডে কম্পিউটারে **yt-dlp ইনস্টল থাকতে হবে** — `pip install -U yt-dlp`। না থাকলে অ্যাপ বাংলায় পরিষ্কার এরর দেখাবে।
- **এনক্রিপ্টেড M3U8** (AES কী সহ) সমর্থিত নয়।
- কিছু সাইট সরাসরি ডাউনলোড ব্লক করে — তখন yt-dlp মোড চেষ্টা করুন।
- ডাউনলোড যায় `~/Downloads/GhostDownloader` ফোল্ডারে।

---

# Ghost Downloader Bangla — Desktop App (English)

A Bangla download manager for desktop, inspired by XiaoYouChR/Ghost-Downloader-3.

- **Direct files** — HTTP/HTTPS download with Pause/Resume (Range header), speed + ETA
- **M3U8 video** — downloads playlist segments and concatenates them into a single `.ts` file
- **YouTube / video** — via yt-dlp: video up to 1080p or audio-only MP3
- **History** — completed downloads are kept in localStorage

Run locally: `npm install` then `npm start`. The Windows installer is built by GitHub Actions on every push to `main` (artifact: **GhostDownloaderBangla-Windows**), or locally with `npm run build`.

Limits: YouTube/social downloads need yt-dlp installed (`pip install -U yt-dlp`); encrypted M3U8 is not supported; some sites block direct downloads.
