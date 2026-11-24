# 👻 Ghost Downloader Bangla

Ghost Downloader-এর মতো বাংলা ডাউনলোড ম্যানেজার — তিনটা সংস্করণ, একটাই প্রজেক্ট।

- **Original inspiration:** [XiaoYouChR/Ghost-Downloader-3](https://github.com/XiaoYouChR/Ghost-Downloader-3) (16.6k stars, Python/PySide6 — HTTP, Magnet/BT, FTP, M3U8, DASH, YouTube, Bilibili)
- **এই প্রজেক্ট:** বাংলা-প্রথম, তিন প্ল্যাটফর্মে একই অভিজ্ঞতা।

## সংস্করণ

| সংস্করণ | ফোল্ডার | কীভাবে চালাবেন |
|---|---|---|
| 🌐 ওয়েব অ্যাপ | `web/` | `index.html` ব্রাউজারে খুলুন — ইনস্টল লাগে না |
| 🐍 Python ডেস্কটপ | `python/` | `pip install -r requirements.txt` → `python app.py` |
| 🖥️ ডেস্কটপ অ্যাপ | `desktop/` | `npm install` → `npm start` (Windows exe GitHub Actions থেকে) |

## যা পারে

- লিংক বসালেই ডাউনলোড — ডাইরেক্ট ফাইল, আসল প্রগ্রেস বার, লাইভ স্পিড, ETA
- Pause / Resume (সার্ভার Range সাপোর্ট করলে থামানো জায়গা থেকে)
- একসাথে অনেক ডাউনলোডের কিউ
- M3U8 প্লেলিস্টের সব সেগমেন্ট জোড়া দিয়ে একটা `.ts` ফাইল
- YouTube / Facebook / TikTok — yt-dlp দিয়ে (ইনস্টল থাকলে), সাথে এমবেড প্লেয়ার
- বাংলা ইন্টারফেস, ডার্ক ডিজাইন, ডাউনলোড হিস্ট্রি

## সৎ সীমা

- YouTube/Facebook/TikTok ডাউনলোডে **yt-dlp ইনস্টল থাকতে হবে** (`pip install -U yt-dlp`); না থাকলে অ্যাপ সেটা বাংলায় বলে দেবে, ভুয়া ডাউনলোড দেখাবে না
- এনক্রিপ্ট করা M3U8 (AES `#EXT-X-KEY`) সাপোর্ট করে না
- Magnet / BitTorrent / FTP এই সংস্করণে নেই (মূল Ghost Downloader-এ আছে)
- কিছু সাইট সরাসরি ডাউনলোড ব্লক করে — তখন yt-dlp মোড ব্যবহার করুন
- ওয়েব সংস্করণে ব্রাউজারের CORS নিয়ম মেনে চলতে হয়; কিছু হোস্ট সরাসরি নামাতে দেবে না

## লাইসেন্স

MIT — নিজের মতো করে ব্যবহার করুন, ক্রেডিট দিলে ভালো লাগবে।
