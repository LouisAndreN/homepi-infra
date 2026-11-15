"""Signed images, rollouts and OTA reports through the API (v0.1.120)."""
import base64
import hashlib
import importlib
import json
import os
import sqlite3
import sys
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
IMAGE = b"\xe9" + b"homepi image " * 100


def _manifest(project="homepi_sensor", version="v2.4.1", chip="esp32c3", data=IMAGE):
    return json.dumps({"chip_target": chip, "project": project, "sha256": hashlib.sha256(data).hexdigest(), "version": version},
                      sort_keys=True, separators=(",", ":"))


@pytest.fixture
def api(monkeypatch, tmp_path):
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    monkeypatch.delenv("HOMEPI_API_SURFACE", raising=False)
    import provisioning_api
    mod = importlib.reload(provisioning_api)
    key = ec.generate_private_key(ec.SECP256R1())
    (tmp_path / "pub.pem").write_bytes(key.public_key().public_bytes(serialization.Encoding.PEM,
                                                                     serialization.PublicFormat.SubjectPublicKeyInfo))
    monkeypatch.setattr(mod, "DB_PATH", str(tmp_path / "devices.db"))
    monkeypatch.setattr(mod, "OTA_PUBKEY_PATH", str(tmp_path / "pub.pem"))
    monkeypatch.setattr(mod, "FIRMWARE_DIR", tmp_path / "fw")
    monkeypatch.setattr(mod, "get_mqtt", lambda: (_ for _ in ()).throw(RuntimeError("no broker in tests")))

    def sign(manifest, k=key):
        return base64.b64encode(k.sign(manifest.encode(), ec.ECDSA(hashes.SHA256()))).decode()
    with TestClient(mod.app) as client:
        yield SimpleNamespace(mod=mod, client=client, sign=sign, tmp=tmp_path)


def _upload(a, manifest, signature, data=IMAGE):
    return a.client.post("/api/admin/firmware/upload", files={"file": ("image.bin", data)},
                         data={"manifest": manifest, "signature": signature})


def _db(a):
    c = sqlite3.connect(a.mod.DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def test_signed_image_is_stored_and_listed(api):
    m = _manifest()
    r = _upload(api, m, api.sign(m))
    assert r.status_code == 200, r.text
    assert r.json()["url"] == "https://homepi.internal/fw/homepi_sensor/v2.4.1.bin"
    assert (api.tmp / "fw" / "homepi_sensor" / "v2.4.1.bin").read_bytes() == IMAGE
    assert [f["version"] for f in api.client.get("/api/admin/firmware").json()["firmware"]] == ["v2.4.1"]


def test_signature_from_another_key_is_refused(api):
    m = _manifest()
    other = ec.generate_private_key(ec.SECP256R1())
    r = _upload(api, m, api.sign(m, other))
    assert r.status_code == 422 and "signature" in r.json()["detail"]
    assert not (api.tmp / "fw").exists()


def test_manifest_changed_after_signing_is_refused(api):
    m = _manifest()
    sig = api.sign(m)
    r = _upload(api, m.replace("v2.4.1", "v2.4.9"), sig)
    assert r.status_code == 422


def test_file_that_is_not_the_signed_image_is_refused(api):
    m = _manifest()
    r = _upload(api, m, api.sign(m), data=IMAGE + b"x")
    assert r.status_code == 422 and "sha256" in r.json()["detail"]


@pytest.mark.parametrize("kw", [{"project": "homepi_foo"}, {"version": "2.4.1"}, {"version": "v2.4.1-dirty"}, {"chip": "esp32"}])
def test_signed_but_invalid_manifest_is_refused(api, kw):
    m = _manifest(**kw)
    assert _upload(api, m, api.sign(m)).status_code == 422


def test_same_version_cannot_be_uploaded_twice(api):
    m = _manifest()
    assert _upload(api, m, api.sign(m)).status_code == 200
    assert _upload(api, m, api.sign(m)).status_code == 409


def test_rollout_needs_a_signed_image_and_targets_the_project(api):
    with _db(api) as c:
        c.execute("INSERT INTO devices (device_id, status, fw_version, project, enrolled_at, last_seen) VALUES "
                  "('esp32-00000001', 'active', 'v2.4.0', 'homepi_sensor', '2026-10-01T00:00:00Z', '2026-11-16T00:00:00Z'), "
                  "('esp32-00000002', 'active', 'v2.4.0', 'homepi_led', '2026-10-01T00:00:00Z', '2026-11-16T00:00:00Z')")
    r = api.client.post("/api/admin/rollouts", json={"project": "homepi_sensor", "version": "v2.4.1"})
    assert r.status_code == 409 and "no signed image" in r.json()["detail"]
    m = _manifest()
    _upload(api, m, api.sign(m))
    r = api.client.post("/api/admin/rollouts", json={"project": "homepi_sensor", "version": "v2.4.1", "soak_minutes": 5})
    assert r.status_code == 200
    ro = api.client.get("/api/admin/rollouts").json()["rollouts"][0]
    assert ro["status"] == "in_progress" and [d["device_id"] for d in ro["devices"]] == ["esp32-00000001"]
    assert api.client.post(f"/api/admin/rollouts/{ro['id']}/abort").json()["status"] == "aborted"
    assert api.client.post(f"/api/admin/rollouts/{ro['id']}/abort").status_code == 409


def test_unsigned_paths_are_gone(api):
    assert api.client.post("/api/admin/devices/esp32-00000001/ota", json={}).status_code == 410
    assert api.client.post("/api/admin/firmware/v2.4.1/deploy").status_code == 410


def test_project_is_set_from_the_fleet_manifest(api):
    with _db(api) as c:
        c.execute("INSERT INTO devices (device_id, status) VALUES ('esp32-00000001', 'active')")
    assert api.client.post("/api/admin/devices/esp32-00000001/project", json={"project": "homepi_nilm"}).status_code == 200
    assert api.client.post("/api/admin/devices/esp32-00000001/project", json={"project": "nilm"}).status_code == 422
    assert api.client.post("/api/admin/devices/esp32-99999999/project", json={"project": "homepi_nilm"}).status_code == 404
    with _db(api) as c:
        assert c.execute("SELECT project FROM devices").fetchone()[0] == "homepi_nilm"


def test_ota_failed_report_is_recorded_for_the_rollout(api):
    with _db(api) as c:
        c.execute("INSERT INTO devices (device_id, status) VALUES ('esp32-00000001', 'active')")
    msg = SimpleNamespace(topic="iot/esp32-00000001/status", retain=False,
                          payload=json.dumps({"type": "ota_failed", "reason": "bad_signature", "version": "v2.4.1",
                                              "running": "v2.4.1"}).encode())
    api.mod.on_sensor_message(None, None, msg)
    with _db(api) as c:
        ev = c.execute("SELECT device_id, reason, version FROM ota_events").fetchone()
    assert tuple(ev) == ("esp32-00000001", "bad_signature", "v2.4.1")
