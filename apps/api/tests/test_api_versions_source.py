"""Source-level guards: the API must compare firmware versions through versions.py.

provisioning_api.py reads production secrets when imported, so it cannot be imported
in a test; these tests inspect its source text instead.
"""
import re
import unittest
from pathlib import Path

SOURCE = (Path(__file__).resolve().parents[1] / "provisioning_api.py").read_text(encoding="utf-8")


def _function_text(name):
    pattern = r"^(?:async )?def %s\(.*?(?=^(?:async def |def |@app))" % name
    match = re.search(pattern, SOURCE, re.S | re.M)
    return match.group(0) if match else ""


class ApiVersionComparisonTests(unittest.TestCase):
    def test_no_raw_version_comparison(self):
        self.assertIsNone(re.search(r'fw_version"\]\s*[!=]=\s*version', SOURCE))
        self.assertIsNone(re.search(r'latest\["version"\]\s*!=\s*req\.fw_version', SOURCE))
        self.assertNotIn("AND fw_version != ?", SOURCE)

    def test_latest_firmware_is_not_chosen_by_upload_date(self):
        body = _function_text("get_latest_firmware")
        self.assertIn("get_latest_firmware", body)
        self.assertNotIn("ORDER BY uploaded_at DESC", body)

    def test_audit_detail_does_not_double_the_v_prefix(self):
        self.assertNotIn('f"v{req.fw_version}->', SOURCE)

    def test_helper_is_imported(self):
        self.assertIn("from versions import", SOURCE)


if __name__ == "__main__":
    unittest.main()
