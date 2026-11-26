"""Headless tests for Ghost Downloader Bangla v1.1.0 engine features.

Covers only downloader.py (no GUI): clipboard URL detection, the
scheduler's delay math, today's-totals accumulation + midnight reset,
and the capped speed-sample list. Run:  python -m unittest test_features -v
"""
import json
import os
import tempfile
import unittest
from datetime import date, datetime, timedelta

from downloader import (
    DailyTotals,
    SpeedSamples,
    extract_download_url,
    is_video_site_url,
    parse_schedule_time,
    seconds_until_run,
)


class TestClipboardUrlDetection(unittest.TestCase):
    def test_plain_http_link(self):
        self.assertEqual(
            extract_download_url("https://example.com/video.mp4"),
            "https://example.com/video.mp4",
        )

    def test_http_link(self):
        self.assertEqual(
            extract_download_url("http://example.com/file.zip"),
            "http://example.com/file.zip",
        )

    def test_url_buried_in_sentence(self):
        self.assertEqual(
            extract_download_url("check this out https://example.com/a.mp4 thanks"),
            "https://example.com/a.mp4",
        )

    def test_trailing_full_stop_stripped(self):
        self.assertEqual(
            extract_download_url("Get it here: https://example.com/a.mp4."),
            "https://example.com/a.mp4",
        )

    def test_magnet_link(self):
        url = "magnet:?xt=urn:btih:ABCDEF1234567890&dn=example"
        self.assertEqual(extract_download_url(url), url)

    def test_plain_text_rejected(self):
        self.assertIsNone(extract_download_url("hello world, no link here"))
        self.assertIsNone(extract_download_url("just some words"))

    def test_empty_and_none_rejected(self):
        self.assertIsNone(extract_download_url(""))
        self.assertIsNone(extract_download_url(None))

    def test_ftp_is_not_a_download_link(self):
        self.assertIsNone(extract_download_url("ftp://example.com/file.zip"))


class TestVideoSiteDetection(unittest.TestCase):
    def test_real_video_sites_detected(self):
        self.assertTrue(is_video_site_url("https://www.youtube.com/watch?v=abc"))
        self.assertTrue(is_video_site_url("https://youtu.be/abc"))
        self.assertTrue(is_video_site_url("https://www.tiktok.com/@user/video/1"))
        self.assertTrue(is_video_site_url("https://x.com/user/status/1"))
        self.assertTrue(is_video_site_url("https://m.facebook.com/watch/?v=1"))

    def test_lookalike_hosts_are_not_video_sites(self):
        # "x.com" as a substring also lives in firefox.com, box.com,
        # linux.com — those are plain file hosts, not video pages.
        self.assertFalse(is_video_site_url("https://www.firefox.com/en-US/download"))
        self.assertFalse(is_video_site_url("https://www.box.com/shared/file.zip"))
        self.assertFalse(is_video_site_url("https://www.linux.com/news/article"))
        self.assertFalse(is_video_site_url("https://fakeyoutube.com/watch?v=1"))
        self.assertFalse(is_video_site_url("https://example.com/file.zip"))


class TestScheduler(unittest.TestCase):
    def test_future_time_is_positive(self):
        now = datetime(2026, 11, 26, 10, 0, 0)
        delay = seconds_until_run(datetime(2026, 11, 26, 11, 0, 0), now=now)
        self.assertAlmostEqual(delay, 3600, delta=1)

    def test_past_time_is_not_positive(self):
        now = datetime(2026, 11, 26, 10, 0, 0)
        delay = seconds_until_run(datetime(2026, 11, 26, 9, 30, 0), now=now)
        self.assertLessEqual(delay, 0)

    def test_string_time_parsed(self):
        now = datetime(2026, 11, 26, 10, 0, 0)
        delay = seconds_until_run("2026-11-26 10:30", now=now)
        self.assertAlmostEqual(delay, 1800, delta=1)

    def test_unparseable_time_is_none(self):
        self.assertIsNone(seconds_until_run("not a date"))
        self.assertIsNone(seconds_until_run(""))
        self.assertIsNone(parse_schedule_time("tomorrow-ish"))

    def test_parse_schedule_time_formats(self):
        self.assertEqual(
            parse_schedule_time("2026-11-26 15:30"),
            datetime(2026, 11, 26, 15, 30),
        )
        self.assertEqual(
            parse_schedule_time("2026-11-26T15:30:05"),
            datetime(2026, 11, 26, 15, 30, 5),
        )
        self.assertIsNone(parse_schedule_time("2026-13-40 99:99"))


class TestDailyTotals(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "totals.json")

    def tearDown(self):
        self.tmp.cleanup()

    def test_accumulates_bytes_and_files(self):
        totals = DailyTotals(self.path)
        totals.add(1024)
        totals.add(2048, files=1)
        self.assertEqual(totals.today(), (3072, 2))

    def test_persists_across_reload(self):
        totals = DailyTotals(self.path)
        totals.add(5000, files=2)
        reloaded = DailyTotals(self.path)
        self.assertEqual(reloaded.today(), (5000, 2))

    def test_yesterdays_file_is_ignored(self):
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump({"date": yesterday, "bytes": 999999, "files": 9}, f)
        totals = DailyTotals(self.path)
        self.assertEqual(totals.today(), (0, 0))

    def test_new_day_resets(self):
        totals = DailyTotals(self.path)
        totals.add(4096, files=1)
        # Simulate the day having changed since the totals were recorded.
        totals.date = (date.today() - timedelta(days=1)).isoformat()
        self.assertEqual(totals.today(), (0, 0))
        totals.add(100)
        self.assertEqual(totals.today(), (100, 1))

    def test_zero_byte_add_still_counts_file(self):
        totals = DailyTotals(self.path)
        totals.add(0)
        self.assertEqual(totals.today(), (0, 1))


class TestSpeedSamples(unittest.TestCase):
    def test_keeps_values_in_order(self):
        samples = SpeedSamples(max_len=5)
        for value in (10, 20, 30):
            samples.add(value)
        self.assertEqual(samples.values(), [10.0, 20.0, 30.0])

    def test_caps_at_max_len(self):
        samples = SpeedSamples(max_len=5)
        for value in range(10):
            samples.add(value)
        self.assertEqual(samples.values(), [5.0, 6.0, 7.0, 8.0, 9.0])

    def test_none_counts_as_zero(self):
        samples = SpeedSamples()
        samples.add(None)
        self.assertEqual(samples.values(), [0.0])


if __name__ == "__main__":
    unittest.main()
