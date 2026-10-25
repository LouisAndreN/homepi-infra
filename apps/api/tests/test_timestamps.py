"""Regression tests: SQLite timestamps must be real UTC with a trailing Z, whatever the host timezone."""
import os
import re
import sqlite3
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

API_SOURCE = Path(__file__).resolve().parents[1] / "provisioning_api.py"
ISO_UTC = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")


def _query(sql):
    return sqlite3.connect(":memory:").execute(sql).fetchone()[0]


def _hours_behind(value, fmt):
    parsed = datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - parsed).total_seconds() / 3600


class TimestampTests(unittest.TestCase):
    def setUp(self):
        # The production Pi runs in JST; reproduce it on whatever machine runs the tests
        os.environ["TZ"] = "Asia/Tokyo"
        time.tzset()

    def test_old_expression_lags_utc_by_nine_hours(self):
        value = _query("select datetime('now','utc')")
        self.assertAlmostEqual(_hours_behind(value, "%Y-%m-%d %H:%M:%S"), 9, delta=0.1)

    def test_new_expression_is_utc_with_z(self):
        value = _query("select strftime('%Y-%m-%dT%H:%M:%SZ','now')")
        self.assertRegex(value, ISO_UTC)
        self.assertAlmostEqual(_hours_behind(value, "%Y-%m-%dT%H:%M:%SZ"), 0, delta=0.01)

    def test_api_source_has_no_utc_modifier(self):
        source = API_SOURCE.read_text(encoding="utf-8")
        self.assertIsNone(re.search(r"datetime\('now',\s*'utc'\)", source))


if __name__ == "__main__":
    unittest.main()
