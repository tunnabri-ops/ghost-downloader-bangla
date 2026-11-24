# Ghost Downloader Bangla — ভূত ডাউনলোডার

বাংলা ডাউনলোড ম্যানেজার (ডেস্কটপ অ্যাপ)। XiaoYouChR/Ghost-Downloader-3 থেকে অনুপ্রাণিত — তবে এটা ছোট, বাংলা-প্রথম সংস্করণ, শুধু আসল কাজটুকু নিয়ে।

## যা করে / Features

- **সরাসরি ফাইল ডাউনলোড** — যেকোনো http/https লিংক, প্রগ্রেস বার + গতি + বাকি সময় সহ।
- **Pause / Resume** — HTTP Range দিয়ে যেখান থেকে থেমেছে সেখান থেকেই আবার শুরু।
- **৪-সংযোগ চাঙ্কড ডাউনলোড** — সার্ভার Range সাপোর্ট করলে ৪টা থ্রেডে ভাগ করে নামায়, তারপর জোড়া দেয়।
- **M3U8** — প্লেলিস্ট পড়ে .ts সেগমেন্টগুলো একে একে নামিয়ে একটা ফাইলে জোড়া দেয়।
- **YouTube / Facebook / TikTok** — yt-dlp থাকলে সেরা মানের mp4 (১০৮০p পর্যন্ত) নামায়।
- **ভিডিও কোয়ালিটি বাছাই** — YouTube/Facebook/TikTok লিংকের জন্য Best / 720p / শুধু অডিও — ডাউনলোড শুরুর আগে বেছে নেওয়া যায়।
- **কিউ শেষে কম্পিউটার বন্ধ** — চেকবক্স চালু থাকলে সব ডাউনলোড শেষ হলে ৬০ সেকেন্ডের কাউন্টডাউন দেখায়; বাতিল না করলে কম্পিউটার বন্ধ হয়ে যায় (কোনো ডাউনলোড চলতে থাকলে বন্ধ হয় না)।
- **একসাথে অনেক ডাউনলোড** — কিউতে একাধিক লিংক যোগ করা যায়।
- **ইতিহাস** — সম্পন্ন ডাউনলোড `downloads.json`-এ সংরক্ষিত হয়।

## চালানো / How to run

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
python app.py
```

ভিডিও সাইটের জন্য (ঐচ্ছিক, তবে দরকারি):

```bash
pip install yt-dlp
```

ডাউনলোড ফাইল যায় `~/Downloads/GhostDownloaderBangla`-এ।

## সৎ সীমা / Honest limits

- YouTube/Facebook/TikTok-এর জন্য **yt-dlp ইনস্টল থাকা লাগবেই** — না থাকলে অ্যাপ মিথ্যা ডাউনলোড দেখাবে না, পরিষ্কার বার্তা দেবে।
- কিছু সাইট সরাসরি ডাউনলোড ব্লক করে (লগইন/অ্যান্টি-বট) — সেগুলো চলবে না।
- **এনক্রিপ্টেড M3U8 (EXT-X-KEY) সাপোর্ট করে না।**
- Magnet / BitTorrent / FTP — এই সংস্করণে নেই (Ghost Downloader-এর মতো বড় অ্যাপে আছে)।
- ৪-সংযোগ চাঙ্কড ডাউনলোড শুধু তখনই হয় যখন সার্ভার `Accept-Ranges: bytes` দেয়; না দিলে এক সংযোগে নামে।

## ফাইল / Files

- `app.py` — PySide6 GUI (বাংলা ইন্টারফেস)
- `downloader.py` — ডাউনলোড ইঞ্জিন (GUI ছাড়াই টেস্ট করা যায়)
- `requirements.txt` — PySide6, requests

---

## English (short)

Bangla-first desktop download manager inspired by Ghost-Downloader-3: direct HTTP downloads with progress/speed/ETA, Pause/Resume via HTTP Range, 4-connection chunked downloads when the server supports ranges, M3U8 segment download + concat, and YouTube/video-site downloads via yt-dlp when installed. Honest limits: video sites need yt-dlp; encrypted M3U8, Magnet/BT and FTP are not supported in this version.
