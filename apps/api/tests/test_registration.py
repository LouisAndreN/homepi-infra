"""Device registration (v0.1.114): the registry decides, the certificate comes from nginx, never from the body."""
import datetime
import importlib
import os
import sqlite3
import sys
from urllib.parse import quote

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
DEV = "esp32-00000001"


def _cert(cn=DEV):
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
    now = datetime.datetime(2026, 11, 13, tzinfo=datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(1).not_valid_before(now).not_valid_after(now + datetime.timedelta(days=365))
            .sign(key, hashes.SHA256()))
    return cert, cert.public_bytes(serialization.Encoding.PEM).decode()


@pytest.fixture
def api(monkeypatch, tmp_path):
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    monkeypatch.setenv("HOMEPI_API_SURFACE", "device")
    import provisioning_api
    mod = importlib.reload(provisioning_api)
    monkeypatch.setattr(mod, "DB_PATH", str(tmp_path / "devices.db"))
    monkeypatch.setattr(mod, "get_mqtt", lambda: (_ for _ in ()).throw(RuntimeError("no broker in tests")))
    with TestClient(mod.app) as client:
        yield mod, client


def _body(**kw):
    b = {"device_id": DEV, "chip_id": "c1", "fw_version": "v2.4.0", "capabilities": ["co2"], "hw_model": "scd41",
         "cert_fingerprint": "forged", "cert_expiry": "2099-01-01T00:00:00Z"}
    b.update(kw)
    return b


def _headers(pem, cn=DEV, verify="SUCCESS"):
    return {"X-SSL-Verify": verify, "X-SSL-Client-DN": "CN=" + cn, "X-SSL-Client-Cert": quote(pem)}


def _row(mod):
    c = sqlite3.connect(mod.DB_PATH); c.row_factory = sqlite3.Row
    return c.execute("SELECT * FROM devices WHERE device_id=?", (DEV,)).fetchone()


def _set(mod, status):
    c = sqlite3.connect(mod.DB_PATH)
    c.execute("INSERT OR REPLACE INTO devices (device_id, status, confirmed_by) VALUES (?, ?, 'bench')", (DEV, status))
    c.commit()


def test_pre_announced_becomes_active_with_the_certificate_data(api):
    mod, client = api
    _set(mod, "pre_announced")
    cert, pem = _cert()
    r = client.post("/api/devices/x5c-enrolled", json=_body(), headers=_headers(pem))
    assert r.status_code == 200
    row = _row(mod)
    assert row["status"] == "active" and row["confirmed_by"] == "zero-touch"
    assert row["cert_fingerprint"] == cert.fingerprint(hashes.SHA256()).hex()  # not the forged body value
    assert row["cert_expiry"] == "2027-11-13T00:00:00Z"


def test_unknown_device_is_recorded_pending_and_refused(api):
    mod, client = api
    r = client.post("/api/devices/x5c-enrolled", json=_body(), headers=_headers(_cert()[1]))
    assert r.status_code == 403
    assert _row(mod)["status"] == "pending"


@pytest.mark.parametrize("status", ["suspended", "pending"])
def test_suspended_or_pending_stays_refused(api, status):
    mod, client = api
    _set(mod, status)
    r = client.post("/api/devices/x5c-enrolled", json=_body(), headers=_headers(_cert()[1]))
    assert r.status_code == 403 and _row(mod)["status"] == status


def test_operator_approval_then_registration(api):
    mod, client = api
    _set(mod, "approved")
    assert client.post("/api/devices/x5c-enrolled", json=_body(), headers=_headers(_cert()[1])).status_code == 200
    row = _row(mod)
    assert row["status"] == "active" and row["confirmed_by"] == "operator"


def test_refresh_keeps_enrollment_date(api):
    mod, client = api
    _set(mod, "pre_announced")
    client.post("/api/devices/x5c-enrolled", json=_body(), headers=_headers(_cert()[1]))
    first = _row(mod)["enrolled_at"]
    client.post("/api/devices/x5c-enrolled", json=_body(fw_version="v2.4.1"), headers=_headers(_cert()[1]))
    row = _row(mod)
    assert row["enrolled_at"] == first and row["fw_version"] == "v2.4.1"


@pytest.mark.parametrize("headers", [
    {},
    {"X-SSL-Verify": "SUCCESS", "X-SSL-Client-DN": "CN=" + DEV},
    {"X-SSL-Verify": "SUCCESS", "X-SSL-Client-DN": "CN=" + DEV, "X-SSL-Client-Cert": "garbage"},
    {"X-SSL-Verify": "NONE", "X-SSL-Client-DN": "CN=" + DEV, "X-SSL-Client-Cert": "x"},
    {"X-SSL-Verify": "SUCCESS", "X-SSL-Client-DN": "CN=esp32-ffffffff", "X-SSL-Client-Cert": "x"},
])
def test_without_a_verified_matching_certificate_nothing_is_written(api, headers):
    mod, client = api
    _set(mod, "pre_announced")
    assert client.post("/api/devices/x5c-enrolled", json=_body(), headers=headers).status_code == 403
    assert _row(mod)["status"] == "pre_announced"


def test_no_automatic_ota_after_registration():
    src = open(os.path.join(os.path.dirname(__file__), "..", "provisioning_api.py")).read()
    assert "auto_ota_sent" not in src and "_delayed_ota" not in src
