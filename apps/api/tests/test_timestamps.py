"""Regression tests: SQLite timestamps must be real UTC with a trailing Z, whatever the host timezone."""
import os
import re
import subprocess
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

API_SOURCE = Path(__file__).resolve().parents[1] / "provisioning_api.py"
ISO_UTC = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
ZONEINFO = Path("/usr/share/zoneinfo/Asia/Tokyo")


def _query_in_jst(sql):
    # SQLite reads the zone through libc, so TZ must be set when the process starts;
    # setting it later from Python does not reach SQLite on every build
    code = "import sqlite3,sys;print(sqlite3.connect(':memory:').execute(sys.argv[1]).fetchone()[0])"
    env = dict(os.environ, TZ="Asia/Tokyo")
    result = subprocess.run([sys.executable, "-c", code, sql], env=env,
                            capture_output=True, text=True, check=True)
    return result.stdout.strip()


def _hours_behind(value, fmt):
    parsed = datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - parsed).total_seconds() / 3600


@unittest.skipUnless(ZONEINFO.exists(), "tzdata is not installed")
class TimestampTests(unittest.TestCase):
    def test_old_expression_lags_utc_by_nine_hours(self):
        lag = _hours_behind(_query_in_jst("select datetime('now','utc')"), "%Y-%m-%d %H:%M:%S")
        if lag < 1:
            self.skipTest("this SQLite build ignores TZ; the 9 h shift was measured on the Pi instead")
        self.assertAlmostEqual(lag, 9, delta=0.1)

    def test_new_expression_is_utc_with_z(self):
        value = _query_in_jst("select strftime('%Y-%m-%dT%H:%M:%SZ','now')")
        self.assertRegex(value, ISO_UTC)
        self.assertAlmostEqual(_hours_behind(value, "%Y-%m-%dT%H:%M:%SZ"), 0, delta=0.01)

    def test_api_source_has_no_utc_modifier(self):
        source = API_SOURCE.read_text(encoding="utf-8")
        self.assertIsNone(re.search(r"datetime\('now',\s*'utc'\)", source))


if __name__ == "__main__":
    unittest.main()
