"""Migration 001 on a database with the pre-2026-10-25 schema and data."""
import sqlite3
import subprocess
import sys
from pathlib import Path

MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "001_utc_timestamps.py"

OLD_SCHEMA = """
CREATE TABLE devices (
  device_id TEXT PRIMARY KEY, status TEXT, cert_expiry TEXT, enrolled_at TEXT, last_seen TEXT);
CREATE TABLE audit_log (
  id        INTEGER  PRIMARY KEY AUTOINCREMENT,
  ts        TEXT     DEFAULT (datetime('now','utc')),
  device_id TEXT,
  event     TEXT     NOT NULL,
  detail    TEXT     DEFAULT '',
  operator  TEXT     DEFAULT 'system');
CREATE INDEX idx_audit_device ON audit_log(device_id);
CREATE TABLE firmware_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT NOT NULL, chip_target TEXT NOT NULL,
  uploaded_at TEXT DEFAULT (datetime('now', 'utc')), UNIQUE(version, chip_target));
CREATE TABLE ota_deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT, created_at TEXT DEFAULT (datetime('now','utc')));
CREATE TABLE ota_deployment_devices (
  deployment_id INTEGER, device_id TEXT, sent_at TEXT, confirmed_at TEXT);
CREATE VIEW v_device_health AS
  SELECT d.device_id, (SELECT max(ts) FROM audit_log a WHERE a.device_id = d.device_id) AS last_event
  FROM devices d;
CREATE TRIGGER trg_audit_upper AFTER INSERT ON audit_log BEGIN SELECT 1; END;
"""


def make_old_db(path):
    conn = sqlite3.connect(path)
    conn.executescript(OLD_SCHEMA)
    conn.execute("INSERT INTO devices VALUES ('esp32-819fe250', 'pre_announced', '2027-10-14T11:49:50Z', "
                 "'2026-10-14 02:49:57', '2026-11-07 14:25:17')")
    conn.execute("INSERT INTO devices VALUES ('esp32-unseen', 'active', NULL, NULL, NULL)")
    conn.execute("INSERT INTO audit_log (ts, device_id, event) VALUES ('2026-11-07 14:25:17', 'esp32-819fe250', 'announced')")
    conn.execute("INSERT INTO audit_log (ts, device_id, event) VALUES ('2026-06-06 04:42:01', 'esp32-819fe250', 'old')")
    conn.execute("INSERT INTO firmware_catalog (version, chip_target, uploaded_at) VALUES ('v2.3.2', 'esp32c3', '2026-08-29 15:38:45')")
    conn.execute("INSERT INTO ota_deployments (version, created_at) VALUES ('v2.3.2', '2026-07-06 02:26:20')")
    conn.execute("INSERT INTO ota_deployment_devices VALUES (1, 'esp32-819fe250', '2026-06-26 00:03:53', NULL)")
    conn.commit()
    conn.close()


def run(path):
    return subprocess.run([sys.executable, str(MIGRATION), str(path)], capture_output=True, text=True)


def test_shifts_values_rebuilds_defaults_and_runs_once(tmp_path):
    db = tmp_path / "devices.db"
    make_old_db(db)
    first = run(db)
    assert first.returncode == 0, first.stderr
    assert first.stdout.startswith("migrated:")
    conn = sqlite3.connect(db)
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
    # 2026-11-07 14:25:17 stored 9 h early is 2026-11-07T23:25:17Z (nginx saw 08:25:17 JST on 11-08)
    assert conn.execute("SELECT last_seen, enrolled_at, cert_expiry FROM devices WHERE device_id='esp32-819fe250'").fetchone() == \
        ("2026-11-07T23:25:17Z", "2026-10-14T11:49:57Z", "2027-10-14T11:49:50Z")
    assert conn.execute("SELECT last_seen FROM devices WHERE device_id='esp32-unseen'").fetchone() == (None,)
    assert [r[0] for r in conn.execute("SELECT ts FROM audit_log ORDER BY id")] == ["2026-11-07T23:25:17Z", "2026-06-06T13:42:01Z"]
    assert conn.execute("SELECT uploaded_at FROM firmware_catalog").fetchone()[0] == "2026-08-30T00:38:45Z"
    assert conn.execute("SELECT created_at FROM ota_deployments").fetchone()[0] == "2026-07-06T11:26:20Z"
    assert conn.execute("SELECT sent_at, confirmed_at FROM ota_deployment_devices").fetchone() == ("2026-06-26T09:03:53Z", None)
    # the defaults now write UTC with Z, ids keep counting, index, trigger and view survive
    conn.execute("INSERT INTO audit_log (device_id, event) VALUES ('esp32-819fe250', 'after')")
    row = conn.execute("SELECT id, ts FROM audit_log WHERE event='after'").fetchone()
    assert row[0] == 3 and row[1].endswith("Z") and "T" in row[1]
    assert {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type IN ('index','trigger')")} >= {"idx_audit_device", "trg_audit_upper"}
    assert conn.execute("SELECT count(*) FROM v_device_health").fetchone()[0] == 2
    assert "datetime('now','utc')" not in " ".join(r[0] for r in conn.execute("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL")).replace(" ", "")
    assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    conn.close()
    second = run(db)
    assert second.returncode == 0 and second.stdout.startswith("already migrated")


def test_failure_leaves_the_database_unchanged(tmp_path):
    db = tmp_path / "devices.db"
    make_old_db(db)
    conn = sqlite3.connect(db)
    # the rebuild of audit_log needs this name: its CREATE fails after the values were already shifted
    conn.execute("CREATE TABLE audit_log__migration_001 (x)")
    conn.commit()
    before = conn.execute("SELECT last_seen FROM devices WHERE device_id='esp32-819fe250'").fetchone()
    conn.close()
    result = run(db)
    assert result.returncode == 1
    assert "nothing changed" in result.stderr
    conn = sqlite3.connect(db)
    assert conn.execute("SELECT last_seen FROM devices WHERE device_id='esp32-819fe250'").fetchone() == before
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 0
    assert "datetime('now','utc')" in conn.execute("SELECT sql FROM sqlite_master WHERE name='audit_log'").fetchone()[0]
    conn.close()
