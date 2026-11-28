"""v1.5.0 API: Teensy manifests in the catalog, fw_teensy -> registry version, reboot route on the admin surface."""
import base64
import importlib
import json
import os
import sys

import pytest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))


@pytest.fixture
def api(monkeypatch, tmp_path):
    pytest.importorskip("httpx")
    monkeypatch.setenv("HOMEPI_API_SURFACE", "admin")
    import provisioning_api
    importlib.reload(provisioning_api)
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    key = ec.generate_private_key(ec.SECP256R1())
    pub = tmp_path / "ota_pub.pem"
    pub.write_bytes(key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
    monkeypatch.setattr(provisioning_api, "OTA_PUBKEY_PATH", str(pub))

    def sign(m):
        text = json.dumps(m, sort_keys=True, separators=(",", ":"))
        return text, base64.b64encode(key.sign(text.encode(), ec.ECDSA(hashes.SHA256()))).decode()
    return provisioning_api, sign


M = {"chip_target": "teensy40", "project": "homepi_nilm_teensy", "sha256": "ab" * 32, "version": "v3.3.0"}


def test_teensy_manifest_accepted(api):
    p, sign = api
    assert p._verify_manifest(*sign(M))["project"] == "homepi_nilm_teensy"


@pytest.mark.parametrize("bad", [M | {"chip_target": "esp32s3"}, M | {"project": "homepi_nilm", "chip_target": "teensy40"},
                                 M | {"project": "homepi_other"}])
def test_teensy_manifest_chip_and_project_must_match(api, bad):
    p, sign = api
    with pytest.raises(Exception):
        p._verify_manifest(*sign(bad))


def test_esp32_manifest_still_accepted(api):
    p, sign = api
    assert p._verify_manifest(*sign(M | {"project": "homepi_nilm", "chip_target": "esp32s3"}))["chip_target"] == "esp32s3"


@pytest.mark.parametrize("raw,expected", [(302, "v3.2.0"), (300, "v3.0.0"), (310, "v3.10.0"), (99, None), ("x", None), (None, None)])
def test_teensy_version(api, raw, expected):
    p, _ = api
    assert p._teensy_version(raw) == expected


def test_reboot_route_only_on_admin_surface(monkeypatch):
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    monkeypatch.setenv("HOMEPI_API_SURFACE", "device")
    import provisioning_api
    importlib.reload(provisioning_api)
    assert TestClient(provisioning_api.app).post("/api/admin/devices/esp32-690be854/teensy-reboot").status_code == 404


class _Msg:
    def __init__(self, topic, payload, retain=False):
        self.topic, self.payload, self.retain = topic, json.dumps(payload).encode(), retain


def test_nilm_message_updates_teensy_fw_and_health(api, monkeypatch, tmp_path):
    p, _ = api
    import rollout
    import sqlite3
    db = tmp_path / "devices.db"
    monkeypatch.setattr(p, "DB_PATH", str(db))
    c = sqlite3.connect(db)
    c.executescript("CREATE TABLE devices (device_id TEXT PRIMARY KEY, fw_version TEXT, last_seen TEXT, status TEXT, enrolled_at TEXT);"
                    "CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, device_id TEXT, event TEXT, detail TEXT, operator TEXT);")
    c.row_factory = sqlite3.Row
    rollout.ensure_schema(c)
    c.execute("INSERT INTO devices (device_id, fw_version, status) VALUES ('esp32-690be854', 'v2.6.0', 'active')")
    c.commit()
    p._teensy_fw.clear(); p._teensy_health.clear()
    p.on_sensor_message(None, None, _Msg("iot/esp32-690be854/nilm", {"fw": "v2.6.0", "fw_teensy": 303, "teensy_ct1_fault": 1,
                                                                     "teensy_gave_up": 0, "teensy_self_restarts": 2}))
    assert c.execute("SELECT teensy_fw FROM devices").fetchone()[0] == "v3.3.0"
    assert p._teensy_health["esp32-690be854"][1:] == (1, 0, 2)
    p.on_sensor_message(None, None, _Msg("iot/esp32-690be854/status", {"type": "teensy_ota_failed", "reason": "sha256_mismatch",
                                                                       "version": "v3.4.0", "detail": "ab"}))
    assert c.execute("SELECT reason FROM ota_events").fetchone()[0] == "teensy_sha256_mismatch"
