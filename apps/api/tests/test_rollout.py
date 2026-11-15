"""Staged OTA rollout (v0.1.120): the state lives in the database and step() moves it forward."""
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import rollout  # noqa: E402

T0 = datetime(2026, 11, 16, 3, 0, tzinfo=timezone.utc)
ISO = "%Y-%m-%dT%H:%M:%SZ"


@pytest.fixture
def conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE devices (device_id TEXT PRIMARY KEY, status TEXT, fw_version TEXT, last_seen TEXT,
                              enrolled_at TEXT, chip_target TEXT);
        CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT CURRENT_TIMESTAMP,
                                device_id TEXT, event TEXT, detail TEXT, operator TEXT);
    """)
    rollout.ensure_schema(c)
    for i in range(5):
        c.execute("INSERT INTO devices (device_id, status, fw_version, last_seen, enrolled_at, chip_target) VALUES (?, 'active', 'v2.4.0', ?, ?, 'esp32c3')",
                  (f"esp32-0000000{i}", T0.strftime(ISO), f"2026-10-1{i}T00:00:00Z"))
    c.execute("UPDATE devices SET project='homepi_sensor'")
    c.execute("INSERT INTO devices (device_id, status, fw_version, last_seen, enrolled_at, project) "
              "VALUES ('esp32-led00000', 'active', 'v2.4.0', ?, '2026-10-01T00:00:00Z', 'homepi_led')", (T0.strftime(ISO),))
    c.execute("INSERT INTO firmware_images (project, version, chip_target, sha256, url, manifest, signature) "
              "VALUES ('homepi_sensor', 'v2.4.1', 'esp32c3', ?, 'https://homepi.internal/fw/homepi_sensor/v2.4.1.bin', ?, 'c2ln')",
              ("ab" * 32, '{"chip_target":"esp32c3","project":"homepi_sensor","sha256":"' + "ab" * 32 + '","version":"v2.4.1"}'))
    return c


class Broker:
    def __init__(self):
        self.sent, self.fail = [], False

    def __call__(self, topic, payload):
        if self.fail:
            return False
        self.sent.append((topic, json.loads(payload)))
        return True

    def commands(self):
        return [t.split("/")[1] for t, p in self.sent if t.endswith("/commands")]


def _phase(conn, rid):
    return conn.execute("SELECT status, phase, reason FROM rollouts WHERE id=?", (rid,)).fetchone()


def _confirm(conn, device_id, at, version="v2.4.1"):
    conn.execute("UPDATE devices SET fw_version=?, last_seen=? WHERE device_id=?", (version, at.strftime(ISO), device_id))


def _devices(conn, rid, phase):
    return [r[0] for r in conn.execute("SELECT device_id FROM rollout_devices WHERE rollout_id=? AND phase=? ORDER BY device_id",
                                       (rid, phase))]


def test_phases_canary_then_quarter_then_rest(conn):
    rid = rollout.create(conn, "homepi_sensor", "v2.4.1")
    assert [len(_devices(conn, rid, p)) for p in (1, 2, 3)] == [1, 1, 3]
    assert _devices(conn, rid, 1) == ["esp32-00000000"]  # the oldest device is the canary
    assert "esp32-led00000" not in sum((_devices(conn, rid, p) for p in (1, 2, 3)), [])


def test_full_rollout_sends_each_phase_only_after_the_previous_one_soaked(conn):
    broker = Broker()
    rid = rollout.create(conn, "homepi_sensor", "v2.4.1", soak_minutes=30, timeout_minutes=20)
    rollout.step(conn, broker, T0)
    assert broker.commands() == ["esp32-00000000"]
    cmd = broker.sent[0][1]
    assert cmd["manifest"].startswith("{") and cmd["signature"] == "c2ln" and cmd["sha256"] == "ab" * 32
    _confirm(conn, "esp32-00000000", T0 + timedelta(minutes=3))
    assert "soaking" in rollout.step(conn, broker, T0 + timedelta(minutes=4))[0]
    assert broker.commands() == ["esp32-00000000"]  # nobody else before the soak time
    _confirm(conn, "esp32-00000000", T0 + timedelta(minutes=34))
    assert "phase 2 starts" in rollout.step(conn, broker, T0 + timedelta(minutes=35))[0]
    rollout.step(conn, broker, T0 + timedelta(minutes=36))
    assert broker.commands() == ["esp32-00000000", "esp32-00000001"]
    t = T0 + timedelta(minutes=40)
    for d in ["esp32-00000000", "esp32-00000001"]:
        _confirm(conn, d, t)
    rollout.step(conn, broker, t)
    for d in ["esp32-00000000", "esp32-00000001"]:
        _confirm(conn, d, t + timedelta(minutes=31))
    rollout.step(conn, broker, t + timedelta(minutes=31))
    rollout.step(conn, broker, t + timedelta(minutes=32))
    assert len(broker.commands()) == 5
    t2 = t + timedelta(minutes=40)
    for d in _devices(conn, rid, 3) + ["esp32-00000000", "esp32-00000001"]:
        _confirm(conn, d, t2)
    rollout.step(conn, broker, t2)
    for d in _devices(conn, rid, 3) + ["esp32-00000000", "esp32-00000001"]:
        _confirm(conn, d, t2 + timedelta(minutes=31))
    assert "success" in rollout.step(conn, broker, t2 + timedelta(minutes=31))[0]
    assert _phase(conn, rid)["status"] == "success"


def test_ota_failed_report_aborts_and_spares_the_next_phases(conn):
    broker = Broker()
    rid = rollout.create(conn, "homepi_sensor", "v2.4.1")
    rollout.step(conn, broker, T0)
    conn.execute("INSERT INTO ota_events (ts, device_id, reason, version) VALUES (?, 'esp32-00000000', 'bad_signature', 'v2.4.1')",
                 ((T0 + timedelta(minutes=1)).strftime(ISO),))
    rollout.step(conn, broker, T0 + timedelta(minutes=2))
    r = _phase(conn, rid)
    assert r["status"] == "aborted" and "bad_signature" in r["reason"]
    assert broker.commands() == ["esp32-00000000"]
    assert any(t == "homepi/admin/alerts" for t, _ in broker.sent)


def test_a_failure_before_the_command_does_not_count(conn):
    conn.execute("INSERT INTO ota_events (ts, device_id, reason) VALUES (?, 'esp32-00000000', 'not_newer')",
                 ((T0 - timedelta(days=1)).strftime(ISO),))
    broker = Broker()
    rid = rollout.create(conn, "homepi_sensor", "v2.4.1")
    rollout.step(conn, broker, T0)
    rollout.step(conn, broker, T0 + timedelta(minutes=1))
    assert _phase(conn, rid)["status"] == "in_progress"


def test_device_still_on_the_old_version_after_the_timeout_aborts(conn):
    """The bootloader rolled the image back (it never confirmed), or the device is offline."""
    broker = Broker()
    rid = rollout.create(conn, "homepi_sensor", "v2.4.1", timeout_minutes=20)
    rollout.step(conn, broker, T0)
    assert "waiting" in rollout.step(conn, broker, T0 + timedelta(minutes=19))[0]
    rollout.step(conn, broker, T0 + timedelta(minutes=21))
    r = _phase(conn, rid)
    assert r["status"] == "aborted" and "still on v2.4.0" in r["reason"] and "rolled back" in r["reason"]


def test_device_silent_after_confirming_aborts(conn):
    broker = Broker()
    rid = rollout.create(conn, "homepi_sensor", "v2.4.1", soak_minutes=30)
    rollout.step(conn, broker, T0)
    _confirm(conn, "esp32-00000000", T0 + timedelta(minutes=2))
    rollout.step(conn, broker, T0 + timedelta(minutes=3))
    rollout.step(conn, broker, T0 + timedelta(minutes=31))  # last_seen 29 min old
    r = _phase(conn, rid)
    assert r["status"] == "aborted" and "silent" in r["reason"]


def test_publish_failure_keeps_the_device_pending_and_retries(conn):
    broker = Broker()
    rid = rollout.create(conn, "homepi_sensor", "v2.4.1")
    broker.fail = True
    rollout.step(conn, broker, T0)
    assert conn.execute("SELECT status FROM rollout_devices WHERE rollout_id=? AND phase=1", (rid,)).fetchone()[0] == "pending"
    broker.fail = False
    rollout.step(conn, broker, T0 + timedelta(minutes=1))
    assert broker.commands() == ["esp32-00000000"]


def test_suspended_device_is_never_sent_anything(conn):
    broker = Broker()
    rid = rollout.create(conn, "homepi_sensor", "v2.4.1")
    conn.execute("UPDATE devices SET status='suspended' WHERE device_id='esp32-00000000'")
    rollout.step(conn, broker, T0)
    assert broker.commands() == [] and _phase(conn, rid)["status"] == "aborted"


@pytest.mark.parametrize("project, version, message", [
    ("homepi_foo", "v2.4.1", "unknown project"),
    ("homepi_sensor", "v9.9.9", "no signed image"),
])
def test_create_refusals(conn, project, version, message):
    with pytest.raises(rollout.RolloutError, match=message):
        rollout.create(conn, project, version)


def test_one_rollout_per_project_and_nothing_to_do(conn):
    rollout.create(conn, "homepi_sensor", "v2.4.1")
    with pytest.raises(rollout.RolloutError, match="already in progress"):
        rollout.create(conn, "homepi_sensor", "v2.4.1")
    conn.execute("UPDATE rollouts SET status='aborted'")
    conn.execute("UPDATE devices SET fw_version='v2.4.1' WHERE project='homepi_sensor'")
    with pytest.raises(rollout.RolloutError, match="already runs"):
        rollout.create(conn, "homepi_sensor", "v2.4.1")


def test_image_removed_during_the_rollout_aborts(conn):
    broker = Broker()
    rid = rollout.create(conn, "homepi_sensor", "v2.4.1")
    conn.execute("DELETE FROM firmware_images")
    rollout.step(conn, broker, T0)
    assert _phase(conn, rid)["status"] == "aborted" and broker.commands() == []


# --- v0.1.121: acknowledgment of a queued command (firmware v2.4.2+) ---

def _image_v243(conn):
    conn.execute("UPDATE devices SET fw_version='v2.4.2' WHERE project='homepi_sensor'")
    conn.execute("INSERT INTO firmware_images (project, version, chip_target, sha256, url, manifest, signature) "
                 "VALUES ('homepi_sensor', 'v2.4.3', 'esp32c3', ?, 'https://homepi.internal/fw/homepi_sensor/v2.4.3.bin', '{}', 'c2ln')",
                 ("cd" * 32,))


def test_v242_device_without_acknowledgment_fails_after_two_minutes(conn):
    """2026-11-15: esp32-819fe250 logged the command and dropped it; the rollout waited 20 min."""
    _image_v243(conn)
    broker = Broker()
    rid = rollout.create(conn, "homepi_sensor", "v2.4.3", timeout_minutes=20)
    rollout.step(conn, broker, T0)
    assert "waiting" in rollout.step(conn, broker, T0 + timedelta(minutes=1))[0]
    rollout.step(conn, broker, T0 + timedelta(minutes=3))
    r = _phase(conn, rid)
    assert r["status"] == "aborted" and "no ota_received" in r["reason"] and "v2.4.2" in r["reason"]


def test_acknowledged_command_waits_for_the_update(conn):
    _image_v243(conn)
    broker = Broker()
    rid = rollout.create(conn, "homepi_sensor", "v2.4.3", timeout_minutes=20)
    rollout.step(conn, broker, T0)
    assert rollout.record_ack(conn, "esp32-00000000", "v2.4.3", T0 + timedelta(seconds=2)) == rid
    assert "waiting" in rollout.step(conn, broker, T0 + timedelta(minutes=5))[0]
    _confirm(conn, "esp32-00000000", T0 + timedelta(minutes=6), "v2.4.3")
    rollout.step(conn, broker, T0 + timedelta(minutes=6))
    assert conn.execute("SELECT status FROM rollout_devices WHERE rollout_id=? AND phase=1", (rid,)).fetchone()[0] == "confirmed"


def test_acknowledgment_before_step_commits_is_kept(conn):
    """The device answers within a second, before step() has committed 'sent'."""
    _image_v243(conn)
    broker = Broker()
    rid = rollout.create(conn, "homepi_sensor", "v2.4.3")
    assert rollout.record_ack(conn, "esp32-00000000", "v2.4.3", T0) == rid   # still pending
    rollout.step(conn, broker, T0)
    row = conn.execute("SELECT status, acked_at FROM rollout_devices WHERE rollout_id=? AND phase=1", (rid,)).fetchone()
    assert row["status"] == "sent" and row["acked_at"]
    assert "waiting" in rollout.step(conn, broker, T0 + timedelta(minutes=3))[0]


def test_acknowledgment_of_another_version_or_without_rollout_is_ignored(conn):
    _image_v243(conn)
    assert rollout.record_ack(conn, "esp32-00000000", "v2.4.3") is None   # no rollout yet
    rollout.create(conn, "homepi_sensor", "v2.4.3")
    assert rollout.record_ack(conn, "esp32-00000000", "v2.4.9") is None


def test_older_firmware_is_not_held_to_the_acknowledgment(conn):
    """v2.4.0 and v2.4.1 never send ota_received: only the version timeout applies to them."""
    broker = Broker()
    rid = rollout.create(conn, "homepi_sensor", "v2.4.1", timeout_minutes=20)
    rollout.step(conn, broker, T0)
    assert "waiting" in rollout.step(conn, broker, T0 + timedelta(minutes=5))[0]
    assert _phase(conn, rid)["status"] == "in_progress"


def test_acknowledges():
    assert rollout.acknowledges("v2.4.2") and rollout.acknowledges("v2.5.0") and rollout.acknowledges("v3.0.0")
    assert not rollout.acknowledges("v2.4.1") and not rollout.acknowledges("v2.4.0-rc2") and not rollout.acknowledges("")
