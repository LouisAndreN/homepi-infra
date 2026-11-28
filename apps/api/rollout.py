"""Staged OTA rollout for HomePi devices (v0.1.120).

A rollout sends one signed image (project, version) to the active devices of that project in three
phases: one canary, then about a quarter, then the rest. Its whole state lives in the registry
database, and step() moves it forward; homepi-ota-rollout.timer runs step() every minute. Nothing
waits in memory: an API or Pi restart in the middle of a rollout loses nothing (until v0.1.119 the
waits were time.sleep threads inside the API, which every deployment restarts).

For each device of the current phase:
  pending    -> the command is published               -> sent
  sent       -> the registry shows the new version     -> confirmed
             -> the device reported ota_failed         -> failed (bad signature, wrong project, ...)
             -> no ota_received after ACK_TIMEOUT       -> failed (command lost or dropped; v2.4.2+ only)
             -> still on the old version after timeout -> failed (bootloader rollback, or offline)
  confirmed  -> the registry shows another version     -> failed (reverted after confirming, v0.1.123)

v0.1.121: firmware v2.4.2 acknowledges a queued command (ota_received, recorded in acked_at by the
API). Before it, a command dropped by the device looked like a slow update for the whole timeout: on
2026-11-15 esp32-819fe250 (v2.4.0-rc2) logged the command and could not start the OTA task, twice,
silently. Older firmware sends no acknowledgment, so the check applies to v2.4.2 and later only.
Any failed device aborts the rollout: the devices of the next phases are never sent anything.
A phase whose devices all confirmed moves on after the soak time, if they all still publish.

v0.1.123: 'confirmed' is no longer final. The registry gets the version at the device's HTTPS
registration, which runs before the broker connection that marks the image valid. An image that
registers and then never confirms (the rollback test image does exactly that) was 'confirmed', and
once the bootloader had reverted it the phase could still pass the soak and the next phase start.
A confirmed device that runs another version fails the rollout at every step.

v1.5.0: relayed images. A project in RELAYED is not a device but a second chip behind one: the
Teensy 4.0 of the NILM board is updated through its bridge (homepi_nilm firmware v2.6.0+, command
teensy_ota). Its devices are the carrier project's devices, its running version is devices.teensy_fw
(from fw_teensy in the NILM data), and the bridge acknowledges and reports like an ESP32 image:
teensy_ota_received (acked_at), teensy_ota_failed (ota_events, reason prefixed teensy_). The same
signing key, the same catalog, the same phases, soak and abort rules.

Usage: rollout.py step   (homepi-ota-rollout.service)
"""
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

from versions import same_version, version_key

DB_PATH = "/var/lib/homepi/devices.db"
PROJECTS = ("homepi_sensor", "homepi_led", "homepi_nilm")      # device firmware projects
# v1.5.0: images a device relays to a second chip: project -> carrier project, chip, carrier firmware
RELAYED = {"homepi_nilm_teensy": {"carrier": "homepi_nilm", "chip": "teensy40", "carrier_min": (2, 6, 0)}}
CATALOG_PROJECTS = PROJECTS + tuple(RELAYED)
SILENT_AFTER = timedelta(minutes=10)     # DeviceSilent's threshold
ACK_TIMEOUT = timedelta(minutes=2)       # ota_received, firmware v2.4.2+
ACK_SINCE = (2, 4, 2)
ISO = "%Y-%m-%dT%H:%M:%SZ"

SCHEMA = """
CREATE TABLE IF NOT EXISTS firmware_images (
  project      TEXT NOT NULL,
  version      TEXT NOT NULL,
  chip_target  TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  url          TEXT NOT NULL,
  manifest     TEXT NOT NULL,
  signature    TEXT NOT NULL,
  notes        TEXT DEFAULT '',
  uploaded_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (project, version)
);
CREATE TABLE IF NOT EXISTS rollouts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  project          TEXT NOT NULL,
  version          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'in_progress',
  phase            INTEGER NOT NULL DEFAULT 1,
  soak_minutes     INTEGER NOT NULL,
  timeout_minutes  INTEGER NOT NULL,
  reason           TEXT DEFAULT '',
  created_by       TEXT DEFAULT 'operator',
  created_at       TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  finished_at      TEXT
);
CREATE TABLE IF NOT EXISTS rollout_devices (
  rollout_id    INTEGER NOT NULL REFERENCES rollouts(id),
  device_id     TEXT NOT NULL,
  phase         INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  from_version  TEXT,
  sent_at       TEXT,
  confirmed_at  TEXT,
  detail        TEXT DEFAULT '',
  PRIMARY KEY (rollout_id, device_id)
);
CREATE TABLE IF NOT EXISTS ota_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  device_id  TEXT NOT NULL,
  reason     TEXT NOT NULL,
  version    TEXT DEFAULT '',
  detail     TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_rollouts_status ON rollouts(status, project);
CREATE INDEX IF NOT EXISTS idx_ota_events_device ON ota_events(device_id, ts);
"""


class RolloutError(Exception):
    """A rollout cannot be created (HTTP 409 or 404 at the API)."""


def ensure_schema(conn):
    conn.executescript(SCHEMA)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(devices)")}
    if "project" not in cols:
        conn.execute("ALTER TABLE devices ADD COLUMN project TEXT DEFAULT ''")
    if "teensy_fw" not in cols:   # v1.5.0: version of the Teensy behind a NILM bridge (fw_teensy 302 -> v3.2.0)
        try:
            conn.execute("ALTER TABLE devices ADD COLUMN teensy_fw TEXT DEFAULT ''")
        except sqlite3.OperationalError as e:
            if "duplicate column" not in str(e):
                raise
    rd = {r[1] for r in conn.execute("PRAGMA table_info(rollout_devices)")}
    if "acked_at" not in rd:
        try:
            conn.execute("ALTER TABLE rollout_devices ADD COLUMN acked_at TEXT")
        except sqlite3.OperationalError as e:   # the API and the timer both migrate: one of them wins
            if "duplicate column" not in str(e):
                raise


def acknowledges(version):
    """True when this firmware publishes ota_received for a queued command (v2.4.2+)."""
    return version_key(version) >= ACK_SINCE


def record_ack(conn, device_id, version, now=None):
    """An ota_received from a device: marks its command of the rollout in progress for that version.
    Returns the rollout id, or None when no command of that version is waiting for it.
    'pending' too: the device answers within a second, before step() has committed 'sent' (step()
    publishes, then writes, in one transaction), and this read does not see the uncommitted write."""
    now = now or datetime.now(timezone.utc)
    row = conn.execute("SELECT d.rollout_id FROM rollout_devices d JOIN rollouts r ON r.id = d.rollout_id "
                       "WHERE d.device_id=? AND d.status IN ('pending', 'sent') AND d.acked_at IS NULL "
                       "AND r.status='in_progress' AND r.version=?", (device_id, version)).fetchone()
    if not row:
        return None
    conn.execute("UPDATE rollout_devices SET acked_at=? WHERE rollout_id=? AND device_id=?", (_ts(now), row[0], device_id))
    return row[0]


def _ts(dt):
    return dt.strftime(ISO)


def _parse(ts):
    return datetime.strptime(ts, ISO).replace(tzinfo=timezone.utc) if ts else None


def _audit(conn, device_id, event, detail):
    conn.execute("INSERT INTO audit_log (device_id, event, detail, operator) VALUES (?, ?, ?, 'system')",
                 (device_id, event, detail))


# v0.1.124: 15 min by default. The soak can only see an image that registers but never reaches the broker
# (the bootloader reverts it within 10 minutes of its boot) and a device silent for 10 minutes; past
# about 12 minutes it learns nothing more, and a slow leak needs hours, which 30 minutes did not cover either.
SOAK_DEFAULT = 15


def create(conn, project, version, created_by="operator", soak_minutes=SOAK_DEFAULT, timeout_minutes=20):
    """Creates a rollout and its phases; the first step() sends the canary its command."""
    if project not in CATALOG_PROJECTS:
        raise RolloutError(f"unknown project {project}")
    if not conn.execute("SELECT 1 FROM firmware_images WHERE project=? AND version=?", (project, version)).fetchone():
        raise RolloutError(f"no signed image {project} {version}")
    busy = conn.execute("SELECT id FROM rollouts WHERE project=? AND status='in_progress'", (project,)).fetchone()
    if busy:
        raise RolloutError(f"rollout {busy[0]} already in progress for {project}")
    rel = RELAYED.get(project)
    if rel:
        rows = conn.execute("SELECT device_id, teensy_fw, fw_version FROM devices WHERE status='active' AND project=? "
                            "ORDER BY enrolled_at ASC, device_id ASC", (rel["carrier"],)).fetchall()
        old = [f"{r[0]} ({r[2]})" for r in rows if version_key(r[2]) < rel["carrier_min"]]
        if old:
            need = "v%d.%d.%d" % rel["carrier_min"]
            raise RolloutError(f"bridge firmware older than {need} cannot relay {project}: {', '.join(old)}")
        rows = [(r[0], r[1] or "unknown") for r in rows]
    else:
        rows = conn.execute("SELECT device_id, fw_version FROM devices WHERE status='active' AND project=? "
                            "ORDER BY enrolled_at ASC, device_id ASC", (project,)).fetchall()
    targets = [(r[0], r[1]) for r in rows if not same_version(r[1], version)]
    if not targets:
        raise RolloutError(f"every active {project} device already runs {version}")
    n = len(targets)
    split = max(2, n // 4)
    phases = [(1, targets[:1]), (2, targets[1:split]), (3, targets[split:])]
    cur = conn.execute("INSERT INTO rollouts (project, version, soak_minutes, timeout_minutes, created_by) "
                       "VALUES (?, ?, ?, ?, ?)", (project, version, soak_minutes, timeout_minutes, created_by))
    rid = cur.lastrowid
    for phase, devices in phases:
        for device_id, fw in devices:
            conn.execute("INSERT INTO rollout_devices (rollout_id, device_id, phase, from_version) VALUES (?, ?, ?, ?)",
                         (rid, device_id, phase, fw))
    _audit(conn, "system", "rollout_created",
           f"rollout={rid} {project} {version} devices={n} canary={targets[0][0]} soak={soak_minutes}m timeout={timeout_minutes}m")
    return rid


def command(image):
    """OTA command: the signed manifest for firmware v2.4.1+, url and sha256 for v2.4.0 (first hop).
    A relayed image (v1.5.0) gets teensy_ota: the bridge checks the same signature itself."""
    if image["project"] in RELAYED:
        return json.dumps({"type": "teensy_ota", "version": image["version"], "url": image["url"],
                           "manifest": image["manifest"], "signature": image["signature"]})
    return json.dumps({"type": "ota", "version": image["version"], "url": image["url"], "sha256": image["sha256"],
                       "manifest": image["manifest"], "signature": image["signature"]})


def abort(conn, rollout_id, reason, publish=None):
    conn.execute("UPDATE rollouts SET status='aborted', reason=?, finished_at=? WHERE id=? AND status='in_progress'",
                 (reason, _ts(datetime.now(timezone.utc)), rollout_id))
    _audit(conn, "system", "rollout_aborted", f"rollout={rollout_id} {reason}")
    if publish:
        publish("homepi/admin/alerts", json.dumps({"type": "rollout_aborted", "rollout": rollout_id, "reason": reason}))


def step(conn, publish, now=None):
    """Moves every rollout in progress one step forward. publish(topic, payload) -> bool."""
    now = now or datetime.now(timezone.utc)
    done = []
    for r in conn.execute("SELECT * FROM rollouts WHERE status='in_progress' ORDER BY id").fetchall():
        done.append(_step_one(conn, r, publish, now))
    return done


def _step_one(conn, r, publish, now):
    rid, phase = r["id"], r["phase"]
    image = conn.execute("SELECT * FROM firmware_images WHERE project=? AND version=?", (r["project"], r["version"])).fetchone()
    if image is None:
        abort(conn, rid, f"image {r['project']} {r['version']} is no longer in the catalog", publish)
        return f"rollout {rid}: aborted (image gone)"
    relayed = r["project"] in RELAYED
    devices = conn.execute("SELECT d.*, v.fw_version, v.teensy_fw, v.last_seen, v.status AS reg_status FROM rollout_devices d "
                           "LEFT JOIN devices v ON v.device_id = d.device_id "
                           "WHERE d.rollout_id=? AND d.phase=? ORDER BY d.device_id", (rid, phase)).fetchall()
    timeout = timedelta(minutes=r["timeout_minutes"])
    failed = []
    for d in devices:
        did = d["device_id"]
        if d["status"] == "pending":
            if d["reg_status"] != "active":
                conn.execute("UPDATE rollout_devices SET status='failed', detail=? WHERE rollout_id=? AND device_id=?",
                             (f"device is {d['reg_status']}", rid, did))
                failed.append(f"{did} is {d['reg_status']}")
            elif publish(f"iot/{did}/commands", command(image)):
                conn.execute("UPDATE rollout_devices SET status='sent', sent_at=? WHERE rollout_id=? AND device_id=?",
                             (_ts(now), rid, did))
                _audit(conn, did, "rollout_command_sent", f"rollout={rid} {r['version']}")
            continue
        if d["status"] != "sent":
            continue
        sent = _parse(d["sent_at"])
        running = d["teensy_fw"] if relayed else d["fw_version"]
        ev = conn.execute("SELECT reason, detail FROM ota_events WHERE device_id=? AND ts >= ? ORDER BY id DESC LIMIT 1",
                          (did, d["sent_at"])).fetchone()
        if ev:
            detail = f"ota_failed: {ev['reason']}" + (f" ({ev['detail']})" if ev["detail"] else "")
            conn.execute("UPDATE rollout_devices SET status='failed', detail=? WHERE rollout_id=? AND device_id=?",
                         (detail, rid, did))
            failed.append(f"{did} {detail}")
        elif same_version(running, r["version"]):
            conn.execute("UPDATE rollout_devices SET status='confirmed', confirmed_at=? WHERE rollout_id=? AND device_id=?",
                         (_ts(now), rid, did))
            _audit(conn, did, "rollout_confirmed", f"rollout={rid} {r['version']}")
        elif (relayed or acknowledges(d["from_version"])) and not d["acked_at"] and now - sent > ACK_TIMEOUT:
            detail = (f"no ota_received {int(ACK_TIMEOUT.total_seconds() // 60)} min after the command "
                      f"(not delivered, or dropped by {d['from_version']})")
            conn.execute("UPDATE rollout_devices SET status='failed', detail=? WHERE rollout_id=? AND device_id=?",
                         (detail, rid, did))
            failed.append(f"{did} {detail}")
        elif now - sent > timeout:
            detail = (f"still on {running} {r['timeout_minutes']} min after the command "
                      + ("(the bridge did not report teensy_ota_done, or offline)" if relayed
                         else "(rolled back by the bootloader, or offline)"))
            conn.execute("UPDATE rollout_devices SET status='failed', detail=? WHERE rollout_id=? AND device_id=?",
                         (detail, rid, did))
            failed.append(f"{did} {detail}")
    for d in conn.execute("SELECT d.device_id, v.fw_version, v.teensy_fw FROM rollout_devices d LEFT JOIN devices v ON v.device_id = d.device_id "
                          "WHERE d.rollout_id=? AND d.phase<=? AND d.status='confirmed'", (rid, phase)).fetchall():
        now_running = d["teensy_fw"] if relayed else d["fw_version"]
        if not same_version(now_running, r["version"]):
            detail = (f"runs {now_running} again after confirming" if relayed else
                      f"reverted to {d['fw_version']} after confirming (bootloader rollback: the image never reached the broker)")
            conn.execute("UPDATE rollout_devices SET status='failed', detail=? WHERE rollout_id=? AND device_id=?",
                         (detail, rid, d["device_id"]))
            failed.append(f"{d['device_id']} {detail}")
    if failed:
        abort(conn, rid, f"phase {phase}: " + "; ".join(failed), publish)
        return f"rollout {rid}: aborted in phase {phase}"

    rows = conn.execute("SELECT d.status, d.confirmed_at, v.last_seen, d.device_id FROM rollout_devices d "
                        "LEFT JOIN devices v ON v.device_id = d.device_id "
                        "WHERE d.rollout_id=? AND d.phase=?", (rid, phase)).fetchall()
    if any(x["status"] != "confirmed" for x in rows):
        return f"rollout {rid}: phase {phase} waiting"
    silent = [x["device_id"] for x in rows if not x["last_seen"] or now - _parse(x["last_seen"]) > SILENT_AFTER]
    if silent:
        abort(conn, rid, f"phase {phase}: silent after the update: {', '.join(silent)}", publish)
        return f"rollout {rid}: aborted in phase {phase} (silent)"
    if now - max(_parse(x["confirmed_at"]) for x in rows) < timedelta(minutes=r["soak_minutes"]):
        return f"rollout {rid}: phase {phase} soaking"
    nxt = conn.execute("SELECT MIN(phase) FROM rollout_devices WHERE rollout_id=? AND phase > ?", (rid, phase)).fetchone()[0]
    if nxt is None:
        conn.execute("UPDATE rollouts SET status='success', finished_at=? WHERE id=?", (_ts(now), rid))
        _audit(conn, "system", "rollout_success", f"rollout={rid} {r['project']} {r['version']}")
        return f"rollout {rid}: success"
    conn.execute("UPDATE rollouts SET phase=? WHERE id=?", (nxt, rid))
    _audit(conn, "system", "rollout_phase", f"rollout={rid} phase {phase} confirmed, phase {nxt} starts")
    return f"rollout {rid}: phase {nxt} starts"


def _mqtt_publisher():
    """One MQTT session for this run, client id of its own (no takeover of the API sessions)."""
    import paho.mqtt.client as mqtt
    c = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2, client_id="homepi-ota-rollout",
                    protocol=mqtt.MQTTv5)
    c.username_pw_set("homepi-api", os.environ.get("API_MQTT_PASS", ""))
    c.connect("127.0.0.1", 1883, keepalive=30)
    c.loop_start()

    def publish(topic, payload):
        try:
            info = c.publish(topic, payload, qos=1, retain=False)
            info.wait_for_publish(timeout=10)
            return info.is_published()
        except Exception as e:  # the device stays pending and is retried next minute
            print(f"publish to {topic} failed: {e}", file=sys.stderr)
            return False
    return c, publish


def main(argv):
    if argv[1:] != ["step"]:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    with conn:
        ensure_schema(conn)
        if not conn.execute("SELECT 1 FROM rollouts WHERE status='in_progress' LIMIT 1").fetchone():
            return 0
    client, publish = _mqtt_publisher()
    try:
        with conn:
            for line in step(conn, publish):
                print(line)
    finally:
        client.loop_stop()
        client.disconnect()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
