"""Option A guard: the provisioning API holds no CA secret and signs nothing.

Devices enroll with their IDevID (X5C provisioner) and renew with step-ca
directly (/step/renew). The API keeps the registry only.
"""
import ast
from pathlib import Path

SRC = (Path(__file__).resolve().parents[1] / "provisioning_api.py").read_text()
TREE = ast.parse(SRC)

REMOVED_ROUTES = {
    "/api/devices/announce",
    "/api/devices/enroll",
    "/api/devices/{device_id}/renew",
    "/api/admin/pairing/open",
    "/api/admin/pairing/stream/{session_id}",
    "/api/admin/pairing/confirm/{device_id}",
}


def _routes():
    out = set()
    for node in TREE.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for d in node.decorator_list:
                if isinstance(d, ast.Call) and d.args and isinstance(d.args[0], ast.Constant):
                    out.add(d.args[0].value)
    return out


def test_no_ca_secret_is_read():
    for needle in ("ca_password", "master.key", "--provisioner-password-file"):
        assert needle not in SRC, f"API still references {needle}"


def test_api_never_signs_certificates():
    assert "step_sign_csr" not in SRC
    assert '"step", "ca", "certificate"' not in SRC


def test_fallback_routes_removed():
    assert not (REMOVED_ROUTES & _routes())


def test_registry_route_kept():
    assert "/api/devices/x5c-enrolled" in _routes()
