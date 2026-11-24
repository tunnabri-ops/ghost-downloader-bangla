"""Ghost Downloader Bangla — PySide6 desktop download manager.

Bangla UI: paste a URL, Add, and the download runs in the list with
progress bar, speed and ETA. Pause / Resume / Cancel per task.
Downloads are saved to ~/Downloads/GhostDownloaderBangla by default.
Finished downloads are recorded in downloads.json next to this file.

Run:  python app.py
"""
import json
import os
import platform
import subprocess
import sys
import threading

from PySide6.QtCore import Qt, QTimer, Signal, QObject
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLineEdit, QPushButton, QTableWidget, QTableWidgetItem,
    QProgressBar, QMessageBox, QFileDialog, QLabel,
    QComboBox, QCheckBox, QDialog,
)

from downloader import (
    Task, format_size, format_speed, format_eta,
    is_m3u8_url, is_video_site_url, yt_dlp_available,
    download_with_yt_dlp, filename_from_url, DownloadError,
)

DOWNLOAD_DIR = os.path.join(os.path.expanduser("~"), "Downloads", "GhostDownloaderBangla")
HISTORY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "downloads.json")

COLUMNS = ["নাম", "সাইজ", "অগ্রগতি", "গতি", "সময় বাকি", "অবস্থা"]


class Bridge(QObject):
    """Carries progress callbacks from worker threads to the Qt GUI thread."""
    updated = Signal(object)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Ghost Downloader Bangla — ভূত ডাউনলোডার")
        self.resize(900, 500)
        self.tasks = []          # list[Task]
        self.bridge = Bridge()
        self.bridge.updated.connect(self.refresh_row)
        # Auto-shutdown state.
        self._ytdlp_active = False   # a yt-dlp download is running
        self._had_downloads = False  # any download has started this session
        self._shutdown_offered = False
        self._shutdown_dialog = None
        self._shutdown_timer = None
        self._shutdown_seconds = 0
        self._shutdown_label = None
        os.makedirs(DOWNLOAD_DIR, exist_ok=True)

        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)

        # URL input row
        top = QHBoxLayout()
        self.url_input = QLineEdit()
        self.url_input.setPlaceholderText("ডাউনলোড লিংক বসান… (http, .m3u8, YouTube)")
        self.url_input.returnPressed.connect(self.add_download)
        top.addWidget(self.url_input, 1)
        self.add_btn = QPushButton("➕ যোগ করুন")
        self.add_btn.clicked.connect(self.add_download)
        top.addWidget(self.add_btn)
        self.folder_btn = QPushButton("📁 ফোল্ডার")
        self.folder_btn.clicked.connect(self.open_folder)
        top.addWidget(self.folder_btn)
        layout.addLayout(top)

        hint = "টিপস: সরাসরি ফাইল, M3U8 লাইভ/ভিডিও লিংক চলবে। YouTube/Facebook/TikTok-এর জন্য yt-dlp লাগবে।"
        if not yt_dlp_available():
            hint += " ⚠️ yt-dlp ইনস্টল করা নেই — ভিডিও সাইটের লিংক চলবে না (pip install yt-dlp)।"
        layout.addWidget(QLabel(hint))

        # Video quality picker + auto-shutdown
        opts = QHBoxLayout()
        opts.addWidget(QLabel("ভিডিও কোয়ালিটি:"))
        self.quality_combo = QComboBox()
        self.quality_combo.addItem("সেরা মান (Best)", "best")
        self.quality_combo.addItem("720p", "720p")
        self.quality_combo.addItem("শুধু অডিও (Audio only)", "audio")
        self.quality_combo.setCurrentIndex(0)
        opts.addWidget(self.quality_combo)
        self.shutdown_check = QCheckBox("কিউ শেষে কম্পিউটার বন্ধ করো")
        self.shutdown_check.toggled.connect(self._on_shutdown_toggled)
        opts.addWidget(self.shutdown_check)
        opts.addStretch(1)
        layout.addLayout(opts)

        # Download list
        self.table = QTableWidget(0, len(COLUMNS))
        self.table.setHorizontalHeaderLabels(COLUMNS)
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setColumnWidth(0, 260)
        self.table.setColumnWidth(2, 180)
        layout.addWidget(self.table, 1)

        # Action buttons
        actions = QHBoxLayout()
        self.pause_btn = QPushButton("⏸ Pause")
        self.pause_btn.clicked.connect(self.pause_selected)
        actions.addWidget(self.pause_btn)
        self.resume_btn = QPushButton("▶ Resume")
        self.resume_btn.clicked.connect(self.resume_selected)
        actions.addWidget(self.resume_btn)
        self.cancel_btn = QPushButton("✖ Cancel")
        self.cancel_btn.clicked.connect(self.cancel_selected)
        actions.addWidget(self.cancel_btn)
        actions.addStretch(1)
        self.status_label = QLabel("তৈরি — লিংক বসিয়ে যোগ করুন")
        actions.addWidget(self.status_label)
        layout.addLayout(actions)

        # Refresh timer (speed/ETA labels stay fresh even between callbacks)
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh_all)
        self.timer.start(500)

        self.load_history()

    # -- history ------------------------------------------------------------
    def load_history(self):
        if not os.path.exists(HISTORY_FILE):
            return
        try:
            with open(HISTORY_FILE, encoding="utf-8") as f:
                for item in json.load(f):
                    row = self.table.rowCount()
                    self.table.insertRow(row)
                    self.table.setItem(row, 0, QTableWidgetItem(item.get("name", "")))
                    self.table.setItem(row, 1, QTableWidgetItem(format_size(item.get("size"))))
                    bar = QProgressBar()
                    bar.setValue(100)
                    self.table.setCellWidget(row, 2, bar)
                    self.table.setItem(row, 3, QTableWidgetItem("—"))
                    self.table.setItem(row, 4, QTableWidgetItem("—"))
                    self.table.setItem(row, 5, QTableWidgetItem("সম্পন্ন ✓"))
        except (OSError, ValueError, KeyError):
            pass

    def save_history(self, task):
        history = []
        if os.path.exists(HISTORY_FILE):
            try:
                with open(HISTORY_FILE, encoding="utf-8") as f:
                    history = json.load(f)
            except (OSError, ValueError):
                history = []
        history.append({
            "name": task.name, "url": task.url,
            "size": task.total, "dest": task.dest,
        })
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=False, indent=2)

    # -- adding ---------------------------------------------------------------
    def add_download(self):
        url = self.url_input.text().strip()
        if not url:
            QMessageBox.warning(self, "লিংক নেই", "প্রথমে একটি ডাউনলোড লিংক বসান।")
            return
        if not url.startswith(("http://", "https://")):
            QMessageBox.warning(self, "ভুল লিংক", "লিংকটি http:// বা https:// দিয়ে শুরু হতে হবে।")
            return
        self.url_input.clear()
        # A new download cancels any pending auto-shutdown countdown.
        self._cancel_shutdown()
        self._shutdown_offered = False
        self._had_downloads = True

        if is_video_site_url(url):
            self.download_video_site(url)
            return

        if is_m3u8_url(url):
            dest = os.path.join(DOWNLOAD_DIR, filename_from_url(url).replace(".m3u8", "") + ".ts")
        else:
            dest = os.path.join(DOWNLOAD_DIR, filename_from_url(url))
        # Avoid overwriting a finished file.
        base, ext = os.path.splitext(dest)
        n = 1
        while os.path.exists(dest) and not os.path.exists(dest + ".part0"):
            dest = f"{base} ({n}){ext}"
            n += 1
        task = Task(url, dest, on_progress=lambda t: self.bridge.updated.emit(t))
        self.tasks.append(task)
        self.add_row(task)
        task.start()
        self.status_label.setText(f"ডাউনলোড হচ্ছে: {task.name}")

    def download_video_site(self, url):
        """Video-page URLs go through yt-dlp in a background thread."""
        if not yt_dlp_available():
            QMessageBox.warning(
                self, "yt-dlp নেই",
                "YouTube / Facebook / TikTok লিংক ডাউনলোড করতে yt-dlp লাগবে।\n"
                "ইনস্টল করুন: pip install yt-dlp\nতারপর আবার চেষ্টা করুন।",
            )
            return
        self.status_label.setText("ভিডিও ডাউনলোড হচ্ছে (yt-dlp)…")
        quality = self.quality_combo.currentData() or "best"
        self._ytdlp_active = True

        def run():
            try:
                download_with_yt_dlp(url, DOWNLOAD_DIR, quality=quality)
                self.bridge.updated.emit(None)  # refresh status label
                QMessageBox.information(self, "সম্পন্ন", "ভিডিও ডাউনলোড সম্পন্ন হয়েছে।")
            except DownloadError as exc:
                QMessageBox.warning(self, "ডাউনলোড ব্যর্থ", str(exc))
            finally:
                self._ytdlp_active = False
                self.status_label.setText("তৈরি")

        threading.Thread(target=run, daemon=True).start()

    # -- table ----------------------------------------------------------------
    def add_row(self, task):
        row = self.table.rowCount()
        self.table.insertRow(row)
        self.table.setItem(row, 0, QTableWidgetItem(task.name))
        self.table.setItem(row, 1, QTableWidgetItem("…"))
        bar = QProgressBar()
        bar.setRange(0, 100)
        bar.setValue(0)
        self.table.setCellWidget(row, 2, bar)
        self.table.setItem(row, 3, QTableWidgetItem("—"))
        self.table.setItem(row, 4, QTableWidgetItem("—"))
        self.table.setItem(row, 5, QTableWidgetItem("ডাউনলোড হচ্ছে…"))
        task._row = row

    def refresh_row(self, task):
        if task is None:
            return
        row = getattr(task, "_row", None)
        if row is None or row >= self.table.rowCount():
            return
        bar = self.table.cellWidget(row, 2)
        if task.total:
            pct = int(task.downloaded * 100 / task.total)
            if bar:
                bar.setValue(min(pct, 100))
            self.table.setItem(row, 1, QTableWidgetItem(format_size(task.total)))
        else:
            self.table.setItem(row, 1, QTableWidgetItem(format_size(task.downloaded)))
        self.table.setItem(row, 3, QTableWidgetItem(format_speed(task.speed)))
        self.table.setItem(row, 4, QTableWidgetItem(format_eta(task.eta)))
        status_bn = {
            "downloading": "ডাউনলোড হচ্ছে…",
            "paused": "থেমে আছে",
            "done": "সম্পন্ন ✓",
            "error": f"ব্যর্থ: {task.error[:60]}",
            "cancelled": "বাতিল",
        }.get(task.status, task.status)
        self.table.setItem(row, 5, QTableWidgetItem(status_bn))
        if task.status == "done":
            self.save_history(task)
            self.status_label.setText(f"সম্পন্ন: {task.name}")

    def refresh_all(self):
        for task in self.tasks:
            if task.status == "downloading":
                self.refresh_row(task)
        self._maybe_offer_shutdown()

    # -- actions --------------------------------------------------------------
    def selected_task(self):
        row = self.table.currentRow()
        if row < 0:
            return None
        for task in self.tasks:
            if getattr(task, "_row", None) == row:
                return task
        return None

    def pause_selected(self):
        task = self.selected_task()
        if task:
            task.pause()
            self.refresh_row(task)

    def resume_selected(self):
        task = self.selected_task()
        if task and task.status in ("paused", "error"):
            task.start()
            self.refresh_row(task)

    def cancel_selected(self):
        task = self.selected_task()
        if task:
            task.cancel()
            self.refresh_row(task)

    # -- auto-shutdown --------------------------------------------------------
    def _on_shutdown_toggled(self, checked):
        if not checked:
            self._cancel_shutdown()

    def _maybe_offer_shutdown(self):
        """Offer the 60s shutdown countdown once the queue is fully done."""
        if not self.shutdown_check.isChecked():
            return
        if self._shutdown_offered or self._shutdown_dialog is not None:
            return
        if not self._had_downloads or self._ytdlp_active:
            return
        # Never shut down while anything is still active or paused.
        if any(t.status not in ("done", "cancelled", "error") for t in self.tasks):
            return
        self._shutdown_offered = True
        self._show_shutdown_dialog()

    def _show_shutdown_dialog(self):
        self._shutdown_seconds = 60
        dlg = QDialog(self)
        dlg.setWindowTitle("কম্পিউটার বন্ধ হচ্ছে")
        box = QVBoxLayout(dlg)
        self._shutdown_label = QLabel(
            "সব ডাউনলোড শেষ হয়েছে।\nকম্পিউটার ৬০ সেকেন্ডের মধ্যে বন্ধ হবে।"
        )
        box.addWidget(self._shutdown_label)
        cancel_btn = QPushButton("বাতিল করুন")
        cancel_btn.clicked.connect(self._cancel_shutdown)
        box.addWidget(cancel_btn)
        dlg.rejected.connect(self._cancel_shutdown)
        self._shutdown_dialog = dlg
        self._shutdown_timer = QTimer(self)
        self._shutdown_timer.timeout.connect(self._shutdown_tick)
        self._shutdown_timer.start(1000)
        dlg.show()

    def _shutdown_tick(self):
        # User closed the dialog with the window X button: treat as cancel.
        if self._shutdown_dialog is not None and not self._shutdown_dialog.isVisible():
            self._cancel_shutdown()
            return
        self._shutdown_seconds -= 1
        if self._shutdown_seconds <= 0:
            if self._shutdown_timer is not None:
                self._shutdown_timer.stop()
                self._shutdown_timer = None
            dlg = self._shutdown_dialog
            self._shutdown_dialog = None
            if dlg is not None:
                dlg.close()
            self._do_shutdown()
            return
        if self._shutdown_label is not None:
            self._shutdown_label.setText(
                "সব ডাউনলোড শেষ হয়েছে।\n"
                f"কম্পিউটার {self._shutdown_seconds} সেকেন্ডের মধ্যে বন্ধ হবে।"
            )

    def _cancel_shutdown(self):
        if self._shutdown_timer is None and self._shutdown_dialog is None:
            return
        if self._shutdown_timer is not None:
            self._shutdown_timer.stop()
            self._shutdown_timer = None
        if self._shutdown_dialog is not None:
            dlg = self._shutdown_dialog
            self._shutdown_dialog = None
            dlg.close()
        self._shutdown_offered = True  # don't nag again for this queue
        self.status_label.setText("অটো-শাটডাউন বাতিল করা হয়েছে")

    def _do_shutdown(self):
        system = platform.system()
        if system == "Windows":
            cmd = ["shutdown", "/s", "/t", "0"]
        elif system == "Darwin":
            cmd = ["osascript", "-e", 'tell app "System Events" to shut down']
        elif system == "Linux":
            cmd = ["shutdown", "-h", "now"]
        else:
            QMessageBox.warning(
                self, "বন্ধ করা যায়নি",
                f"এই সিস্টেমে ({system}) অটো-শাটডাউন সাপোর্ট করে না।",
            )
            return
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        except OSError as exc:
            QMessageBox.warning(
                self, "বন্ধ করা যায়নি",
                f"কম্পিউটার বন্ধ করা যায়নি: {exc}\n(অ্যাডমিন অনুমতি লাগতে পারে।)",
            )
            return
        if proc.returncode != 0:
            QMessageBox.warning(
                self, "বন্ধ করা যায়নি",
                "কম্পিউটার বন্ধ করা যায়নি — শাটডাউন কমান্ড ব্যর্থ হয়েছে।\n"
                "(Linux-এ সাধারণত root/sudo অনুমতি লাগে।)",
            )

    def open_folder(self):
        QFileDialog.getExistingDirectory(self, "ডাউনলোড ফোল্ডার", DOWNLOAD_DIR)


def main():
    app = QApplication(sys.argv)
    win = MainWindow()
    win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
