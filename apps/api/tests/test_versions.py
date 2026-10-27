"""Unit tests for versions.py (pure functions, no production files needed)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from versions import same_version, version_key  # noqa: E402


class VersionTests(unittest.TestCase):
    def test_leading_v_is_ignored(self):
        self.assertTrue(same_version("v2.3.2", "2.3.2"))
        self.assertTrue(same_version("2.3.2", "V2.3.2"))

    def test_different_releases_differ(self):
        self.assertFalse(same_version("v2.3.2", "2.1.0"))

    def test_modified_builds_never_match_a_release(self):
        self.assertFalse(same_version("v2.3.2-dirty", "2.3.2"))
        self.assertFalse(same_version("v2.3.2-3-gabc1234", "2.3.2"))

    def test_empty_values_do_not_match_a_release(self):
        self.assertFalse(same_version("", "2.3.2"))
        self.assertFalse(same_version(None, "2.3.2"))

    def test_latest_is_the_highest_version_not_the_last_uploaded(self):
        uploaded_in_order = ["2.3.2", "2.1.0"]  # an old release re-uploaded last
        self.assertEqual(max(uploaded_in_order, key=version_key), "2.3.2")

    def test_numeric_order_not_string_order(self):
        self.assertEqual(max(["2.9.0", "2.10.0"], key=version_key), "2.10.0")


if __name__ == "__main__":
    unittest.main()
