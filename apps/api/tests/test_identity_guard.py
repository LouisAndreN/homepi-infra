"""Identity guard of the device routes, tested from the source without importing the application."""
import ast
from pathlib import Path

import pytest

SOURCE = Path(__file__).resolve().parents[1] / "provisioning_api.py"
TREE = ast.parse(SOURCE.read_text(encoding="utf-8"))


class FakeHTTPException(Exception):
    def __init__(self, status_code, detail=""):
        super().__init__(detail)
        self.status_code = status_code


class FakeRequest:
    def __init__(self, headers):
        self.headers = headers


def _load_guard():
    wanted = {"_client_cn", "_require_client_identity"}
    nodes = [n for n in TREE.body if isinstance(n, ast.FunctionDef) and n.name in wanted]
    assert {n.name for n in nodes} == wanted
    namespace = {"HTTPException": FakeHTTPException, "Request": FakeRequest}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), "exec"), namespace)
    return namespace["_require_client_identity"]


GUARD = _load_guard()


@pytest.mark.parametrize("dn", ["CN=esp32-a", "C=JP,O=HomePi,CN=esp32-a", "CN=esp32-a,O=HomePi,C=JP", "/C=JP/O=HomePi/CN=esp32-a"])
def test_verified_certificate_of_the_device_passes(dn):
    GUARD(FakeRequest({"X-SSL-Verify": "SUCCESS", "X-SSL-Client-DN": dn}), "esp32-a")


@pytest.mark.parametrize("headers", [
    {},
    {"X-SSL-Client-DN": "CN=esp32-a"},
    {"X-SSL-Verify": "NONE", "X-SSL-Client-DN": "CN=esp32-a"},
    {"X-SSL-Verify": "FAILED:certificate has expired", "X-SSL-Client-DN": "CN=esp32-a"},
    {"X-SSL-Verify": "SUCCESS"},
    {"X-SSL-Verify": "SUCCESS", "X-SSL-Client-DN": "O=HomePi,C=JP"},
    {"X-SSL-Verify": "SUCCESS", "X-SSL-Client-DN": "CN=esp32-b"},
    {"X-SSL-Verify": "SUCCESS", "X-SSL-Client-DN": "CN=esp32-a-evil"},
])
def test_everything_else_is_refused(headers):
    with pytest.raises(FakeHTTPException) as refused:
        GUARD(FakeRequest(headers), "esp32-a")
    assert refused.value.status_code == 403


def _route(name):
    return next(n for n in TREE.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)


@pytest.mark.parametrize("name, device_arg", [("renew", "device_id"), ("x5c_enrolled", "req.device_id")])
def test_device_routes_call_the_guard_first(name, device_arg):
    body = [s for s in _route(name).body if not (isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant))]
    assert ast.unparse(body[0]) == f"_require_client_identity(request, {device_arg})"


def test_the_old_optional_cn_check_is_gone():
    assert "if cn and cn != device_id" not in SOURCE.read_text(encoding="utf-8")
