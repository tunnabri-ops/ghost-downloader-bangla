"""Ghost Downloader Bangla — download engine (no GUI here).

Features:
- Single-file HTTP download with streaming + HTTP Range resume.
- Multi-connection chunked download (4 parallel threads) when the server
  supports Accept-Ranges, parts joined into the final file.
- Pause = stop the worker thread; Resume = continue from downloaded bytes
  (Range header, or per-part resume for chunked downloads).
- M3U8: parse playlist, download .ts segments in order, concat into one file.
- YouTube / video sites: delegated to yt-dlp via subprocess when installed,
  with a quality preset (best / 720p / audio-only).

Only dependency: requests.
"""
import json
import os
import re
import shutil
import subprocess
import threading
import time
from datetime import date, datetime
from urllib.parse import urljoin

import requests

CHUNK_SIZE = 1024 * 256  # 256 KB per read
DEFAULT_CONNECTIONS = 4
MIN_CHUNKED_SIZE = 1024 * 1024  # only chunk files >= 1 MB
USER_AGENT = "Ghost-Downloader-Bangla/1.1 (Python/requests)"
APP_VERSION = "1.1.0"


def format_size(n):
    """Bytes -> human readable string, e.g. 1536 -> '1.5 KB'."""
    if n is None:
        return "—"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} PB"


def format_speed(bps):
    if bps is None or bps <= 0:
        return "—"
    return format_size(bps) + "/s"


def format_eta(seconds):
    if seconds is None:
        return "—"
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds}s"
    m, s = divmod(seconds, 60)
    if m < 60:
        return f"{m}m {s}s"
    h, m = divmod(m, 60)
    return f"{h}h {m}m"


def filename_from_url(url):
    name = url.split("?")[0].rstrip("/").rsplit("/", 1)[-1]
    name = re.sub(r"[^A-Za-z0-9._\- ]+", "_", name) or "download"
    return name


class DownloadError(Exception):
    pass


# ---------------------------------------------------------------------------
# v1.1.0 helpers: clipboard URL detection, scheduled downloads, today's
# totals, and speed samples for the live graph. All pure logic (no GUI),
# so they are covered by test_features.py.
# ---------------------------------------------------------------------------

_URL_RE = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
_MAGNET_RE = re.compile(r"magnet:\?[^\s\"'<>]+", re.IGNORECASE)
_TRAILING_PUNCT = ".,;:!?\"'’)>]}"


def extract_download_url(text):
    """Return the first http(s) URL or magnet link found in *text*, else None.

    Plain text with no link returns None; a URL buried in a sentence is
    found, and trailing punctuation (e.g. a full stop at a sentence end)
    is stripped.
    """
    if not text:
        return None
    match = _URL_RE.search(text)
    if match:
        return match.group(0).rstrip(_TRAILING_PUNCT)
    match = _MAGNET_RE.search(text)
    if match:
        return match.group(0).rstrip(_TRAILING_PUNCT)
    return None


def parse_schedule_time(value):
    """Parse 'YYYY-MM-DD HH:MM' (or ISO 'YYYY-MM-DDTHH:MM[:SS]') -> datetime.

    Returns None for anything unparseable — the caller shows an error
    instead of scheduling a bad time.
    """
    if not value or not isinstance(value, str):
        return None
    value = value.strip().replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def seconds_until_run(when, now=None):
    """Seconds from *now* until *when* (a datetime or a parseable string).

    Positive = in the future, zero/negative = already due (start now).
    Returns None when *when* cannot be parsed.
    """
    if isinstance(when, str):
        when = parse_schedule_time(when)
    if when is None:
        return None
    if now is None:
        now = datetime.now()
    return (when - now).total_seconds()


class DailyTotals:
    """Bytes + file count downloaded 'today', persisted in a small JSON file.

    Rolls over automatically at midnight: the first use on a new calendar
    day starts from zero. A file stamped with an older date is ignored.
    """

    def __init__(self, path):
        self.path = path
        self.date = date.today().isoformat()
        self.bytes = 0
        self.files = 0
        self.load()

    def load(self):
        try:
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            return
        if data.get("date") == date.today().isoformat():
            self.date = data["date"]
            self.bytes = int(data.get("bytes", 0))
            self.files = int(data.get("files", 0))

    def save(self):
        try:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(
                    {"date": self.date, "bytes": self.bytes, "files": self.files},
                    f,
                )
        except OSError:
            pass

    def _rollover(self):
        today = date.today().isoformat()
        if self.date != today:
            self.date = today
            self.bytes = 0
            self.files = 0

    def add(self, nbytes, files=1):
        self._rollover()
        self.bytes += max(0, int(nbytes or 0))
        self.files += files
        self.save()

    def today(self):
        self._rollover()
        return self.bytes, self.files


class SpeedSamples:
    """Capped rolling list of recent speed samples (bytes/sec) for the graph."""

    def __init__(self, max_len=60):
        self.max_len = max_len
        self.samples = []

    def add(self, value):
        self.samples.append(float(value or 0))
        del self.samples[: max(0, len(self.samples) - self.max_len)]

    def values(self):
        return list(self.samples)


class Task:
    """One download job. Progress is reported via on_progress callback."""

    def __init__(self, url, dest, on_progress=None):
        self.url = url
        self.dest = dest
        self.name = os.path.basename(dest) or filename_from_url(url)
        self.total = None          # total bytes, None = unknown
        self.downloaded = 0
        self.status = "queued"     # queued/downloading/paused/done/error/cancelled
        self.error = ""
        self.speed = 0.0
        self.eta = None
        self.on_progress = on_progress
        self.stop_event = threading.Event()
        self._thread = None
        self._last_report = 0.0
        self._last_downloaded = 0
        self._speed_time = None

    # -- progress reporting -------------------------------------------------
    def _report(self, force=False):
        now = time.time()
        if self._speed_time is None:
            self._speed_time = now
            self._last_downloaded = self.downloaded
        dt = now - self._speed_time
        if dt >= 0.5 or force:
            if dt > 0:
                self.speed = (self.downloaded - self._last_downloaded) / dt
            if self.speed > 0 and self.total:
                self.eta = (self.total - self.downloaded) / self.speed
            self._speed_time = now
            self._last_downloaded = self.downloaded
        if self.on_progress and (force or now - self._last_report >= 0.2):
            self._last_report = now
            self.on_progress(self)

    # -- lifecycle ----------------------------------------------------------
    def start(self):
        self.stop_event.clear()
        self.status = "downloading"
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def pause(self):
        if self.status == "downloading":
            self.stop_event.set()
            self.status = "paused"
            self._report(force=True)

    def cancel(self):
        self.stop_event.set()
        self.status = "cancelled"
        self._report(force=True)

    def is_alive(self):
        return self._thread is not None and self._thread.is_alive()

    # -- engine -------------------------------------------------------------
    def _run(self):
        try:
            if is_m3u8_url(self.url):
                self._run_m3u8()
            else:
                self._run_http()
        except Exception as exc:  # noqa: BLE001 - surface any failure
            if self.status != "cancelled":
                self.status = "error"
                self.error = str(exc)
        finally:
            self._report(force=True)

    def _run_http(self):
        session = requests.Session()
        # Identity encoding: sizes must be exact bytes, no gzip decompression.
        session.headers.update({"User-Agent": USER_AGENT, "Accept-Encoding": "identity"})
        # Probe: size + range support.
        total = None
        accept_ranges = False
        try:
            head = session.head(self.url, allow_redirects=True, timeout=15)
            head.raise_for_status()
            if head.headers.get("Content-Length"):
                total = int(head.headers["Content-Length"])
            accept_ranges = "bytes" in head.headers.get("Accept-Ranges", "")
        except requests.RequestException:
            pass  # fall back to GET; size stays unknown
        self.total = total

        existing = os.path.getsize(self.dest) if os.path.exists(self.dest) else 0
        if total and existing >= total:
            self.downloaded = total
            self.status = "done"
            return

        if accept_ranges and total and total >= MIN_CHUNKED_SIZE:
            self._run_chunked(session, total)
        else:
            self._run_single(session, existing)
        if self.status == "downloading":
            self.status = "done"

    def _run_single(self, session, existing):
        """One connection, streaming, resume with Range if a partial file exists."""
        headers = {}
        mode = "wb"
        self.downloaded = 0
        if existing > 0:
            headers["Range"] = f"bytes={existing}-"
            mode = "ab"
            self.downloaded = existing
        resp = session.get(self.url, headers=headers, stream=True, timeout=30)
        if existing > 0 and resp.status_code == 200:
            # Server ignored Range — restart from scratch.
            mode = "wb"
            self.downloaded = 0
        resp.raise_for_status()
        if self.total is None and resp.headers.get("Content-Length"):
            self.total = self.downloaded + int(resp.headers["Content-Length"])
        with open(self.dest, mode) as f:
            for chunk in resp.iter_content(chunk_size=CHUNK_SIZE):
                if self.stop_event.is_set():
                    return
                if chunk:
                    f.write(chunk)
                    self.downloaded += len(chunk)
                    self._report()

    def _run_chunked(self, session, total):
        """4 parallel connections, each downloading one byte range to a part file."""
        parts = []
        part_size = total // DEFAULT_CONNECTIONS
        for i in range(DEFAULT_CONNECTIONS):
            start = i * part_size
            end = total - 1 if i == DEFAULT_CONNECTIONS - 1 else (i + 1) * part_size - 1
            parts.append((i, start, end))
        part_files = [f"{self.dest}.part{i}" for i in range(DEFAULT_CONNECTIONS)]
        # Already-downloaded bytes from previous (paused) runs.
        self.downloaded = sum(
            os.path.getsize(p) for p in part_files if os.path.exists(p)
        )
        self._report(force=True)
        errors = []
        lock = threading.Lock()

        def worker(i, start, end, part_file):
            done = os.path.getsize(part_file) if os.path.exists(part_file) else 0
            pos = start + done
            if pos > end:
                return
            try:
                resp = session.get(
                    self.url,
                    headers={"Range": f"bytes={pos}-{end}"},
                    stream=True,
                    timeout=30,
                )
                resp.raise_for_status()
                with open(part_file, "ab") as f:
                    for chunk in resp.iter_content(chunk_size=CHUNK_SIZE):
                        if self.stop_event.is_set():
                            return
                        if chunk:
                            f.write(chunk)
                            with lock:
                                self.downloaded += len(chunk)
                            self._report()
            except Exception as exc:  # noqa: BLE001 - collect, report later
                errors.append(exc)

        threads = [
            threading.Thread(target=worker, args=(i, s, e, pf), daemon=True)
            for (i, s, e), pf in zip(parts, part_files)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        if self.stop_event.is_set():
            return
        if errors:
            raise DownloadError(str(errors[0]))
        # Join parts into the final file.
        with open(self.dest, "wb") as out:
            for pf in part_files:
                with open(pf, "rb") as f:
                    shutil.copyfileobj(f, out, length=CHUNK_SIZE)
                os.remove(pf)
        self.downloaded = total

    # -- M3U8 ---------------------------------------------------------------
    def _run_m3u8(self):
        session = requests.Session()
        session.headers.update({"User-Agent": USER_AGENT, "Accept-Encoding": "identity"})
        resp = session.get(self.url, timeout=30)
        resp.raise_for_status()
        text = resp.text
        if "#EXT-X-KEY" in text:
            raise DownloadError(
                "Encrypted M3U8 (EXT-X-KEY) is not supported by this version."
            )
        segments = []
        for line in text.splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                segments.append(urljoin(self.url, line))
        if not segments:
            raise DownloadError("No segments found in the M3U8 playlist.")
        self.total = len(segments)
        existing = 0
        if os.path.exists(self.dest):
            # Count already-downloaded segments by size marker file.
            marker = self.dest + ".segments"
            if os.path.exists(marker):
                existing = int(open(marker, encoding="utf-8").read().strip() or 0)
        self.downloaded = existing
        mode = "ab" if existing else "wb"
        with open(self.dest, mode) as out:
            for idx, seg_url in enumerate(segments):
                if self.stop_event.is_set():
                    with open(self.dest + ".segments", "w", encoding="utf-8") as m:
                        m.write(str(idx))
                    return
                if idx < existing:
                    continue
                r = session.get(seg_url, timeout=30)
                r.raise_for_status()
                out.write(r.content)
                self.downloaded = idx + 1
                self._report()
        marker = self.dest + ".segments"
        if os.path.exists(marker):
            os.remove(marker)
        if self.status == "downloading":
            self.status = "done"


def is_m3u8_url(url):
    return ".m3u8" in url.split("?")[0].lower()


def is_video_site_url(url):
    """True when the URL is probably a video page (YouTube etc.) — needs yt-dlp."""
    host = url.lower()
    return any(
        d in host
        for d in (
            "youtube.com", "youtu.be", "facebook.com", "fb.watch",
            "tiktok.com", "instagram.com", "twitter.com", "x.com",
            "vimeo.com", "dailymotion.com", "twitch.tv",
        )
    )


def yt_dlp_available():
    return shutil.which("yt-dlp") is not None


# yt-dlp quality presets: GUI combo key -> yt-dlp -f selector.
YT_DLP_FORMATS = {
    "best": "bestvideo+bestaudio/best",
    "720p": "bestvideo[height<=720]+bestaudio/best[height<=720]",
    "audio": "bestaudio/best",
}


def yt_dlp_format_selector(quality):
    """Map a quality key ('best' / '720p' / 'audio') to the yt-dlp -f selector.

    Unknown keys fall back to 'best' so a bad value never breaks the call.
    """
    return YT_DLP_FORMATS.get(quality, YT_DLP_FORMATS["best"])


def download_with_yt_dlp(url, out_dir, progress_cb=None, quality="best"):
    """Download a video-page URL with yt-dlp.

    quality: 'best' (best video+audio), '720p' (video up to 720p + audio),
    or 'audio' (audio only, saved as mp3).

    Returns (returncode, output). Raises DownloadError when yt-dlp is missing.
    """
    if not yt_dlp_available():
        raise DownloadError(
            "yt-dlp ইনস্টল করা নেই। ইনস্টল করুন: pip install yt-dlp — তারপর আবার চেষ্টা করুন।"
        )
    os.makedirs(out_dir, exist_ok=True)
    selector = yt_dlp_format_selector(quality)
    cmd = ["yt-dlp", "-f", selector]
    if quality == "audio":
        cmd += ["--extract-audio", "--audio-format", "mp3"]
    else:
        cmd += ["--merge-output-format", "mp4"]
    cmd += [
        "-o", os.path.join(out_dir, "%(title)s.%(ext)s"),
        url,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=3600)
    if progress_cb:
        progress_cb(proc.stdout + proc.stderr)
    if proc.returncode != 0:
        raise DownloadError(f"yt-dlp failed: {proc.stderr.strip()[-500:]}")
    return proc.returncode, proc.stdout
