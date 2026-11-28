"""v1.5.0: Teensy images relayed by the NILM bridge go through the same catalog, phases and abort rules."""
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

import pytest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))
import rollout  # noqa: E402

T0 = datetime(2026, 11, 28, 12, 0, tzinfo=timezone.utc)


def _ts(dt):
    return dt.strftime(rollout.ISO)


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE devices (device_id TEXT PRIMARY KEY, chip_target TEXT, fw_version TEXT, status TEXT,
                              enrolled_at TEXT, last_seen TEXT);
        CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, device_id TEXT, event TEXT,
                                detail TEXT, operator TEXT);
    """)
    rollout.ensure_schema(c)
    c.execute("INSERT INTO devices VALUES ('esp32-690be854', 'esp32s3', 'v2.6.0', 'active', '2026-11-01T00:00:00Z', ?, 'homepi_nilm', 'v3.2.0')",
              (_ts(T0),))
    c.execute("INSERT INTO devices VALUES ('esp32-aaaaaaaa', 'esp32c3', 'v2.4.3', 'active', '2026-10-01T00:00:00Z', ?, 'homepi_sensor', '')",
              (_ts(T0),))
    for project, version, chip in (("homepi_nilm_teensy", "v3.3.0", "teensy40"), ("homepi_sensor", "v2.4.4", "esp32c3")):
        c.execute("INSERT INTO firmware_images (project, version, chip_target, sha256, url, manifest, signature) "
                  "VALUES (?, ?, ?, ?, ?, ?, ?)", (project, version, chip, "ab" * 32,
                  f"https://homepi.internal/fw/{project}/{version}.bin", '{"m":1}', "c2ln"))
    return c


def _publisher():
    sent = []
    return sent, (lambda topic, payload: sent.append((topic, json.loads(payload))) or True)


def test_teensy_rollout_targets_the_nilm_bridge_and_sends_teensy_ota(conn):
    rid = rollout.create(conn, "homepi_nilm_teensy", "v3.3.0")
    dev = conn.execute("SELECT * FROM rollout_devices WHERE rollout_id=?", (rid,)).fetchall()
    assert [(d["device_id"], d["from_version"]) for d in dev] == [("esp32-690be854", "v3.2.0")]
    sent, pub = _publisher()
    rollout.step(conn, pub, T0)
    topic, cmd = sent[0]
    assert topic == "iot/esp32-690be854/commands" and cmd["type"] == "teensy_ota" and cmd["version"] == "v3.3.0"
    assert set(cmd) == {"type", "version", "url", "manifest", "signature"}


def test_teensy_rollout_confirms_on_teensy_fw_then_succeeds_after_soak(conn):
    rid = rollout.create(conn, "homepi_nilm_teensy", "v3.3.0", soak_minutes=15)
    sent, pub = _publisher()
    rollout.step(conn, pub, T0)
    assert rollout.record_ack(conn, "esp32-690be854", "v3.3.0", T0 + timedelta(seconds=1)) == rid
    # the bridge ESP32 version does not count: only teensy_fw does
    assert "waiting" in rollout.step(conn, pub, T0 + timedelta(minutes=1))[0]
    conn.execute("UPDATE devices SET teensy_fw='v3.3.0', last_seen=? WHERE device_id='esp32-690be854'", (_ts(T0 + timedelta(minutes=2)),))
    assert "soaking" in rollout.step(conn, pub, T0 + timedelta(minutes=2))[0]
    conn.execute("UPDATE devices SET last_seen=? WHERE device_id='esp32-690be854'", (_ts(T0 + timedelta(minutes=17)),))
    assert rollout.step(conn, pub, T0 + timedelta(minutes=18))[0].endswith("success")


def test_teensy_failure_reported_by_the_bridge_aborts(conn):
    rid = rollout.create(conn, "homepi_nilm_teensy", "v3.3.0")
    sent, pub = _publisher()
    rollout.step(conn, pub, T0)
    conn.execute("INSERT INTO ota_events (ts, device_id, reason, version, detail) VALUES (?, ?, ?, ?, ?)",
                 (_ts(T0 + timedelta(seconds=30)), "esp32-690be854", "teensy_sha256_mismatch", "v3.3.0", "1234"))
    assert "aborted" in rollout.step(conn, pub, T0 + timedelta(minutes=1))[0]
    r = conn.execute("SELECT status, reason FROM rollouts WHERE id=?", (rid,)).fetchone()
    assert r["status"] == "aborted" and "teensy_sha256_mismatch" in r["reason"]


def test_teensy_command_without_acknowledgment_fails_after_two_minutes(conn):
    rollout.create(conn, "homepi_nilm_teensy", "v3.3.0")
    sent, pub = _publisher()
    rollout.step(conn, pub, T0)
    out = rollout.step(conn, pub, T0 + timedelta(minutes=3))[0]
    assert "aborted" in out


def test_teensy_rollout_refused_when_the_bridge_is_older_than_v260(conn):
    conn.execute("UPDATE devices SET fw_version='v2.5.0' WHERE device_id='esp32-690be854'")
    with pytest.raises(rollout.RolloutError, match="older than v2.6.0"):
        rollout.create(conn, "homepi_nilm_teensy", "v3.3.0")


def test_teensy_rollout_refused_when_already_running(conn):
    conn.execute("UPDATE devices SET teensy_fw='v3.3.0' WHERE device_id='esp32-690be854'")
    with pytest.raises(rollout.RolloutError, match="already runs"):
        rollout.create(conn, "homepi_nilm_teensy", "v3.3.0")


def test_device_images_unchanged(conn):
    rollout.create(conn, "homepi_sensor", "v2.4.4")
    sent, pub = _publisher()
    rollout.step(conn, pub, T0)
    assert sent[0][1]["type"] == "ota" and "sha256" in sent[0][1]


def test_teensy_reverting_after_confirming_aborts(conn):
    rollout.create(conn, "homepi_nilm_teensy", "v3.3.0")
    sent, pub = _publisher()
    rollout.step(conn, pub, T0)
    rollout.record_ack(conn, "esp32-690be854", "v3.3.0", T0)
    conn.execute("UPDATE devices SET teensy_fw='v3.3.0' WHERE device_id='esp32-690be854'")
    rollout.step(conn, pub, T0 + timedelta(minutes=1))
    conn.execute("UPDATE devices SET teensy_fw='v3.2.0' WHERE device_id='esp32-690be854'")
    out = rollout.step(conn, pub, T0 + timedelta(minutes=2))[0]
    assert "aborted" in out
