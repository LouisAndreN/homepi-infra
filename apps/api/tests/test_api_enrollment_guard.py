"""Source-level guards: unauthenticated device enrollment routes must be off by default."""
import unittest
from pathlib import Path

SOURCE = (Path(__file__).resolve().parents[1] / "provisioning_api.py").read_text(encoding="utf-8")
ROUTES = ('"/api/devices/x5c-enrolled"',)


class SelfEnrollmentGuardTests(unittest.TestCase):
    def test_routes_depend_on_the_guard(self):
        for route in ROUTES:
            decorators = [l for l in SOURCE.splitlines() if route in l and l.lstrip().startswith("@app.")]
            self.assertEqual(len(decorators), 1, route)
            self.assertIn("dependencies=[Depends(_self_enrollment_enabled)]", decorators[0])

    def test_guard_defaults_to_off(self):
        self.assertIn('os.environ.get("API_ALLOW_DEVICE_SELF_ENROLLMENT", "0")', SOURCE)


if __name__ == "__main__":
    unittest.main()
