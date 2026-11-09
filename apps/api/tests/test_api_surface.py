"""Each API instance serves one surface (v0.1.90), and the units pin the surface and the socket."""
import importlib
import os
import sys

import pytest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))
UNITS = os.path.join(HERE, "..", "..", "..", "ansible", "roles", "provisioning_api", "files")


def _client(monkeypatch, surface):
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    monkeypatch.setenv("HOMEPI_API_SURFACE", surface)
    import provisioning_api
    importlib.reload(provisioning_api)
    return TestClient(provisioning_api.app)


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/admin/devices"),
    ("POST", "/api/admin/firmware/upload"),
    ("POST", "/api/admin/devices/esp32-00000000/suspend"),
    ("GET", "/openapi.json"),
])
def test_device_surface_refuses_admin_routes(monkeypatch, method, path):
    assert _client(monkeypatch, "device").request(method, path).status_code == 404


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/devices/esp32-00000000/status"),
    ("POST", "/api/devices/x5c-enrolled"),
    ("GET", "/metrics/homepi"),
    ("GET", "/openapi.json"),
])
def test_admin_surface_refuses_device_routes(monkeypatch, method, path):
    assert _client(monkeypatch, "admin").request(method, path).status_code == 404


@pytest.mark.parametrize("unit,surface", [("homepi-api.service", "device"), ("homepi-api-admin.service", "admin")])
def test_units_pin_surface_and_socket(unit, surface):
    text = open(os.path.join(UNITS, unit)).read()
    assert "Environment=HOMEPI_API_SURFACE=%s" % surface in text
    assert "--fd 3" in text and "--host" not in text and "--port" not in text


@pytest.mark.parametrize("sock", ["homepi-api.socket", "homepi-api-admin.socket"])
def test_sockets_reachable_by_nginx_only(sock):
    text = open(os.path.join(UNITS, sock)).read()
    assert "SocketGroup=www-data" in text and "SocketMode=0660" in text
