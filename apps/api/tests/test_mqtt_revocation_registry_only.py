"""MQTT revocation lives in the registry; homepi-acl-sync renders the broker ACL.

The API must not write broker files or signal mosquitto: it has no right to,
and that failure turned a successful suspend into an HTTP 500.
"""
import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SRC = (ROOT / "apps/api/provisioning_api.py").read_text()
TREE = ast.parse(SRC)
SYNC = ast.parse((ROOT / "ansible/roles/mqtt_acl/files/homepi-acl-sync").read_text())


def _function(name):
    for node in TREE.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(SRC, node)
    raise AssertionError(name + " not found")


def _allowed_statuses():
    for node in SYNC.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "ALLOWED" for t in node.targets):
            return set(ast.literal_eval(node.value))
    raise AssertionError("ALLOWED not found in homepi-acl-sync")


def test_api_does_not_touch_broker_files():
    for needle in ("revoked.acl", "/etc/mosquitto", "mosquitto.pid", "os.kill("):
        assert needle not in SRC, f"API still references {needle}"


def test_suspend_writes_a_denied_status():
    assert "status='suspended'" in _function("suspend_device")
    assert "suspended" not in _allowed_statuses()


def test_confirm_writes_an_allowed_status():
    assert "status='approved'" in _function("confirm_device")
    assert "approved" in _allowed_statuses()
