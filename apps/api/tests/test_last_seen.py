"""last_seen comes from every telemetry topic, with one registry write per device per 30 s (v0.1.113),
never from a retained message (v0.1.116)."""
import importlib
import os
import sqlite3
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _api(monkeypatch, tmp_path):
    monkeypatch.setenv("HOMEPI_API_SURFACE", "device")
    import provisioning_api
    api = importlib.reload(provisioning_api)
    tmp_path.mkdir(parents=True, exist_ok=True)
    db = tmp_path / "devices.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE devices (device_id TEXT PRIMARY KEY, status TEXT, fw_version TEXT, last_seen TEXT, cert_expiry TEXT)")
    conn.execute("INSERT INTO devices VALUES ('esp32-00000001', 'active', 'v1', '2026-10-14T11:50:16Z', NULL)")
    conn.commit(); conn.close()

    def _db():
        c = sqlite3.connect(db); c.row_factory = sqlite3.Row; return c
    monkeypatch.setattr(api, "db", _db)
    return api, db


def _row(db):
    return sqlite3.connect(db).execute("SELECT fw_version, last_seen FROM devices").fetchone()


def _msg(kind, payload=b"{}", retain=False):
    return SimpleNamespace(topic="iot/esp32-00000001/" + kind, payload=payload, retain=retain)


def test_nilm_and_status_update_last_seen(monkeypatch, tmp_path):
    for kind in ("nilm", "status"):
        api, db = _api(monkeypatch, tmp_path / kind)
        api.on_sensor_message(None, None, _msg(kind, b"not json"))
        assert _row(db)[1] != "2026-10-14T11:50:16Z", kind


def test_other_topics_ignored(monkeypatch, tmp_path):
    api, db = _api(monkeypatch, tmp_path)
    api.on_sensor_message(None, None, _msg("commands"))
    assert _row(db)[1] == "2026-10-14T11:50:16Z"


def test_writes_throttled_but_new_firmware_written_at_once(monkeypatch, tmp_path):
    api, db = _api(monkeypatch, tmp_path)
    writes = []
    real = api.db
    monkeypatch.setattr(api, "db", lambda: (writes.append(1), real())[1])
    api.on_sensor_message(None, None, _msg("nilm"))
    api.on_sensor_message(None, None, _msg("nilm"))
    assert len(writes) == 1
    api.on_sensor_message(None, None, _msg("sensors", b'{"fw": "v2"}'))
    assert len(writes) == 2 and _row(db)[0] == "v2"


def test_metric_exposes_last_seen(monkeypatch, tmp_path):
    import asyncio
    api, db = _api(monkeypatch, tmp_path)
    body = asyncio.run(api.homepi_metrics()).body.decode()
    assert 'homepi_device_last_seen_timestamp_seconds{device_id="esp32-00000001",status="active"} 1791978616' in body


def test_retained_message_is_not_a_sign_of_life(monkeypatch, tmp_path):
    api, db = _api(monkeypatch, tmp_path)
    api.on_sensor_message(None, None, _msg("status", b'{"fw": "v9"}', retain=True))
    assert _row(db) == ("v1", "2026-10-14T11:50:16Z")
    api.on_sensor_message(None, None, _msg("status", b'{"fw": "v9"}'))
    assert _row(db)[0] == "v9" and _row(db)[1] != "2026-10-14T11:50:16Z"
