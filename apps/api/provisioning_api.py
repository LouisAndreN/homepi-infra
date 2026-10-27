#!/usr/bin/env python3
"""
HomePi - Provisioning API
FastAPI sur port 8090

Routes :
  /api/devices/*   -> IoT VLAN (ESP32), pas d'auth
  /api/admin/*     -> LAN (Dashboard), Authelia via Nginx
"""

import asyncio, hashlib, hmac, json, logging, os, secrets, sqlite3, subprocess, time, threading, shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import paho.mqtt.client as mqtt
from paho.mqtt.properties import Properties
from paho.mqtt.packettypes import PacketTypes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import StreamingResponse, PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
import uuid

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from versions import same_version, version_key

# --- Config -------------------
DB_PATH         = "/var/lib/homepi/devices.db"
MASTER_KEY      = Path("/etc/homepi/master.key").read_bytes()
CA_PASSWORD     = Path("/etc/homepi/step-ca/ca_password").read_text().strip()
STEP_ROOT_CA    = "/etc/step-ca/certs/root_ca.crt"
STEP_CA_URL     = "https://127.0.0.1:8443"
PAIRING_TTL     = 60    # seconds

MQTT_HOST       = "127.0.0.1"
MQTT_PORT       = 1883
MQTT_USER       = "homepi-api"
MQTT_PASS       = os.environ.get("API_MQTT_PASS", "")

ACL_REVOKED     = "/etc/mosquitto/acl/revoked.acl"
MOSQUITTO_PID   = "/run/mosquitto/mosquitto.pid"

LED_PRESETS_PATH = Path("/var/lib/homepi/led_presets.json")

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("homepi-api")


class LedLayer(BaseModel):
    enabled: bool = True
    pattern: str
    blend: str = "over"
    color: str = "#FFFFFF"
    brightness: int = 200
    speed: float = 1.0
    amplitude: float = 1.0
    frequency: float = 1.0


class LedComposition(BaseModel):
    layers: list[LedLayer]


class LedPreset(BaseModel):
    name: str
    layers: list[LedLayer]


class ReorderRequest(BaseModel):
    ordered_ids: list[str]



def _parse_cert_expiry(raw: str) -> datetime | None:
    """cert_expiry est stocké en ISO8601 (enrollment zero-touch, firmware ESP32)
    OU en format OpenSSL brut 'Sep 27 10:00:00 2026 GMT' (enrollment/renew manuel).
    Les deux chemins existent en prod — gérer les deux formats."""
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        pass
    try:
        return datetime.strptime(raw, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
    except ValueError:
        return None




def device_exists(device_id: str) -> bool:
    with db() as conn:
        row = conn.execute(
            "SELECT 1 FROM devices WHERE device_id=?", (device_id,)
        ).fetchone()
    return row is not None


def load_led_presets() -> list[dict]:
    if not LED_PRESETS_PATH.exists():
        return []
    return json.loads(LED_PRESETS_PATH.read_text())


def save_led_presets(presets: list[dict]):
    LED_PRESETS_PATH.parent.mkdir(parents=True, exist_ok=True)
    LED_PRESETS_PATH.write_text(json.dumps(presets, indent=2))


def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def audit(device_id: str, event: str, detail: str = "", operator: str = "system"):
    try:
        with db() as conn:
            conn.execute(
                "INSERT INTO audit_log "
                "(device_id, event, detail, operator) VALUES (?, ?, ?, ?)",
                (device_id, event, detail, operator)
            )
    except Exception as e:
        log.warning(f"audit() non-fatal: {e}")


# --- HMAC helpers --------------------
def derive_device_key(device_id: str) -> bytes:
    return HKDF(
        algorithm=hashes.SHA256(), length=32,
        salt=None, info=b"homepi-device-v1"
    ).derive(MASTER_KEY + device_id.encode())


def compute_pin(device_id: str) -> str:
    key = derive_device_key(device_id)
    return hmac.new(key, b"pin-v1", hashlib.sha256).hexdigest()[:6].upper()

def verify_hmac_proof(device_id: str, nonce: str, proof:str) -> bool:
    key = derive_device_key(device_id)
    expected = hmac.new(
        key, f"{device_id}:{nonce}".encode(), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, proof)


# --- MQTT client ---------------------
_mqtt_client: Optional[mqtt.Client] = None
_mqtt_lock = threading.Lock()

def on_sensor_message(client, userdata, msg):
    try:
        parts = msg .topic.split("/")
        if len(parts) != 3 or parts[0] != "iot" or parts[2] != "sensors":
            return
        device_id = parts[1]
        payload = json.loads(msg.payload)
        fw = payload.get("fw")
        if not fw:
            return
        with db() as conn:
            conn.execute("""
                UPDATE devices
                SET fw_version = ?, last_seen = strftime('%Y-%m-%dT%H:%M:%SZ','now')
                WHERE device_id = ?
            """, (fw, device_id))
    except Exception as e:
        log.warning(f"on_sensor_message failed: {e}")


def get_mqtt() -> mqtt.Client:
    global _mqtt_client
    with _mqtt_lock:
        if _mqtt_client and _mqtt_client.is_connected():
            return _mqtt_client
    if _mqtt_client:
        try:
            _mqtt_client.loop_stop()
            _mqtt_client.disconnect()
        except Exception:
            pass
    c = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2, client_id="homepi-api", protocol=mqtt.MQTTv5, )
    c.username_pw_set(MQTT_USER, MQTT_PASS)
    c.on_message = on_sensor_message

    connect_properties = Properties(PacketTypes.CONNECT)
    connect_properties.SessionExpiryInterval = 0

    c.connect(MQTT_HOST, MQTT_PORT, keepalive=60, clean_start=True, properties=connect_properties)
    c.subscribe("iot/+/sensors", qos=0)
    c.loop_start()
    _mqtt_client = c
    return c

# --- step-ca helpers --------------------
def step_sign_csr(csr_pem: str, device_id: str, not_after: str = "8760h") -> str:
    """Signe un CSR via step-ca CLI -> retourne le cert PEM. """
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".csr", delete=False, mode="w") as f:
        f.write(csr_pem); csr_path = f.name
    cert_path = csr_path.replace(".csr", ".crt")
    try:
        r = subprocess.run([
            "step", "ca", "certificate", device_id,
            cert_path, csr_path,
            "--ca-url", STEP_CA_URL,
            "--root", STEP_ROOT_CA,
            "--provisioner-password-file", "/etc/homepi/step-ca/ca_password",
            "--not-after", not_after,
            "--force"
        ], capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            raise RuntimeError(f"step ca: {r.stderr}")
        return Path(cert_path).read_text()
    finally:
        Path(csr_path).unlink(missing_ok=True)
        Path(cert_path).unlink(missing_ok=True)

def revoke_via_acl(device_id: str):
    """Revocation ACL Mosquitto - deconnexion < 1s."""
    with open (ACL_REVOKED, "a") as f:
        f.write(f"\nuser {device_id}\ntopic # deny\n")
    try:
        pid = int(Path(MOSQUITTO_PID).read_text().strip())
        os.kill(pid, 1)    # SIGHUP -> rechargement ACL
        log.info(f"Mosquitto reloaded for {device_id} revocation")
    except Exception as e:
        log.warning(f"SIGHUP Mosquitto failed: {e}")

# --- Firmware helpers --------------------------
def get_latest_firmware(chip_target: str) -> dict | None:
    """
    Direct lookup by chip_target.
    Firmware is universal - only one binary by chip target.
    hw_model is managed by ESP32 via I2C table dispatch.
    """
    with db() as conn:
        rows = conn.execute("""
            SELECT version, chip_target, sha256, url, hw_model, notes
            FROM firmware_catalog
            WHERE chip_target = ?
        """, (chip_target,)).fetchall()
    return dict(max(rows, key=lambda r: version_key(r["version"]))) if rows else None

# --- Staged Rollout ------------------------------

def _send_ota_to_device(device_id: str, firmware: dict, deployment_id: int, phase: int):
    payload = json.dumps({
        "type":    "ota",
        "version": firmware["version"],
        "url":     firmware["url"],
        "sha256":  firmware["sha256"],
    })
    try:
        get_mqtt().publish(
            f"iot/{device_id}/commands", payload, qos=1, retain=False)
        with db() as conn:
            conn.execute("""
                UPDATE ota_deployment_devices
                SET status='sent', sent_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
                WHERE deployment_id=? AND device_id=?
            """, (deployment_id, device_id))
    except Exception as e:
        log.error(f"OTA send failed for {device_id}: {e}")

def _check_phase_and_advance(deployment_id: int, phase: int, version: str, chip_target:str):
    """
    Check every devices of phase are on same version.
    If rollback detected -> abort. Otherwise -> next phase.
    """
    with db() as conn:
        rows = conn.execute("""
            SELECT dd.device_id, dev.fw_version
            FROM ota_deployment_devices dd
            JOIN devices dev ON dd.device_id = dev.device_id
            WHERE dd.deployment_id = ? AND dd.phase = ?
        """, (deployment_id, phase)).fetchall()

    rolled_back = [r for r in rows if not same_version(r["fw_version"], version)]
    confirmed = [r for r in rows if same_version(r["fw_version"], version)]

    if rolled_back:
        log.error(
            f"Deployment {deployment_id} phase {phase}: "
            f"{len(rolled_back)} device(s) rolled back -> ABORT"
        )
        with db() as conn:
            conn.execute(
                "UPDATE ota_deployments SET status='aborted' WHERE id=?",
                (deployment_id,)
            )
            conn.execute("""
                UPDATE ota_deployment_devices SET status='rolled_back'
                WHERE deployment_id=? AND phase=?
            """, (deployment_id, phase))
        try:
            get_mqtt().publish("homepi/admin/alerts", json.dumps({
                "type":              "ota_aborted",
                "deployment_id":     deployment_id,
                "phase":             phase,
                "version":           version,
                "rolled_back":       [r["device_id"] for r in rolled_back],
             }), qos=1)
        except Exception:
            pass
        audit("system", "ota_aborted",
              f"dep={deployment_id} phase={phase} v={version} "
              f"rolled_back={[r['device_id'] for r in rolled_back]}")
        return

    # Phase OK
    with db() as conn:
        conn.execute("""
            UPDATE ota_deployment_devices
            SET status='confirmed', confirmed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
            WHERE deployment_id=? AND phase=?
        """, (deployment_id, phase))
    log.info(
        f"Deployment {deployment_id} phase {phase} OK"
        f"({len(confirmed)} devices confirmed)"
    )
    audit("system", "ota_phase_confirmed",
          f"dep={deployment_id} phase={phase} v={version}")

    # Next phase ?
    next_phase = phase + 1
    with db() as conn:
        has_next = conn.execute("""
            SELECT COUNT(*) as n FROM ota_deployment_devices
            WHERE deployment_id=? AND phase=?
        """, (deployment_id, next_phase)).fetchone()["n"]

    if has_next > 0:
        _run_phase(deployment_id, next_phase, version, chip_target)
    else:
        with db() as conn:
            conn.execute(
                "UPDATE ota_deployments SET status='success' WHERE id=?",
                (deployment_id,)
            )
        log.info(f"Deployment {deployment_id} complete OK all on v{version}")
        audit("system", "ota_deployment_success",
              f"dep={deployment_id} v={version}")


def _run_phase(deployment_id: int, phase: int,
               version: str, chip_target: str):
    """Send OTA to all devices of this phase."""
    firmware = get_latest_firmware(chip_target)
    if not firmware:
        log.error(f"Firmware not found for {chip_target}")
        return

    with db() as conn:
        devices = conn.execute("""
            SELECT device_id FROM ota_deployment_devices
            WHERE deployment_id=? AND phase=?
        """, (deployment_id, phase)).fetchall()

    wait_minutes = {1: 30, 2: 60, 3: 0}[phase]

    for row in devices:
        _send_ota_to_device(row["device_id"], firmware, deployment_id, phase)

    if wait_minutes > 0:
        def check():
            time.sleep(wait_minutes * 60)
            _check_phase_and_advance(
                deployment_id, phase, version, chip_target)
        threading.Thread(
            target=check, daemon=True,
            name=f"ota-check-{deployment_id}-p{phase}"
        ).start()
        log.info(
            f"Deployment {deployment_id} phase {phase}"
            f"check in {wait_minutes}min"
        )

def start_staged_deployment(version: str, chip_target: str, created_by: str = "auto"):
    """
    Staged rollout AWS/Azure style :
    Phase 1 : 1 canary (device le plus ancien = le plus stable)
    Phase 2 : 25% de la flotte
    Phase 3 : reste (100%)

    Automatic rollback detected via fw_version MQTT -> abort if fail.
    """
    with db() as conn:
        rows = conn.execute("""
            SELECT device_id, fw_version FROM devices
            WHERE status='active' AND chip_target=?
            ORDER BY enrolled_at ASC
        """, (chip_target,)).fetchall()
    rows = [r for r in rows if not same_version(r["fw_version"], version)]

    if not rows:
        log.info(f"All {chip_target} devices already on v{version}")
        return None

    device_ids = [r["device_id"] for r in rows]
    n = len(device_ids)

    # Repartition
    canary  = device_ids[:1]
    quarter = device_ids[1:max(2, n // 4)]
    rest    = device_ids[max(2, n // 4):]
    phases  = [(1, canary), (2, quarter), (3, rest)]

    with db() as conn:
        cur = conn.execute(
            "INSERT INTO ota_deployments (version, chip_target, created_by) "
            "VALUES (?,?,?)",
            (version, chip_target, created_by)
        )
        dep_id = cur.lastrowid
        for phase_num, phase_devices in phases:
            for did in phase_devices:
                conn.execute("""
                    INSERT INTO ota_deployment_devices
                      (deployment_id, device_id, phase)
                    VALUES (?,?,?)
                """, (dep_id, did, phase_num))

    log.info(
        f"Deployment {dep_id} started: v{version} "
        f"canary={len(canary)} "
        f"phase2={len(quarter)} "
        f"phase3={len(rest)}"
    )
    audit("system", "ota_deployment_started",
          f"dep={dep_id} v={version} "
          f"n={n} canary={canary[0] if canary else 'none'}")

    _run_phase(dep_id, 1, version, chip_target)
    return dep_id



# --- Pairing sessions (in-memory) ------------------
# {session_id: {device_id, phase, remaining, queues[]}}
_sessions: dict = {}

# --- App -------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Init DB
    with db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS devices (
              device_id        TEXT PRIMARY KEY,
              chip_id          TEXT,
              chip_target      TEXT DEFAULT 'esp32c3',
              hw_model         TEXT DEFAULT '',
              fw_version       TEXT,
              capabilities     TEXT DEFAULT '[]',
              status           TEXT DEFAULT 'pre_announced',
              cert_fingerprint TEXT,
              cert_expiry      TEXT,
              enrolled_at      TEXT,
              last_seen        TEXT,
              confirmed_by     TEXT,
              label            TEXT    DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS audit_log (
              id        INTEGER  PRIMARY KEY AUTOINCREMENT,
              ts        TEXT     DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
              device_id TEXT,
              event     TEXT     NOT NULL,
              detail    TEXT     DEFAULT '',
              operator  TEXT     DEFAULT 'system'
            );
            CREATE TABLE IF NOT EXISTS firmware_catalog (
              id                INTEGER PRIMARY KEY AUTOINCREMENT,
              version           TEXT NOT NULL,
              chip_target       TEXT NOT NULL,
              hw_model          TEXT DEFAULT '',
              sha256            TEXT NOT NULL,
              url               TEXT NOT NULL,
              uploaded_at       TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
              notes             TEXT DEFAULT '',
              UNIQUE(version, chip_target)
            );
            CREATE TABLE IF NOT EXISTS ota_deployments (
              id          INTEGER PRIMARY KEY AUTOINCREMENT,
              version     TEXT NOT NULL,
              chip_target TEXT NOT NULL,
              status      TEXT DEFAULT 'in_progress',
              created_at  TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
              created_by  TEXT DEFAULT 'auto'
            );
            CREATE TABLE IF NOT EXISTS ota_deployment_devices (
              deployment_id INTEGER REFERENCES ota_deployments(id),
              device_id     TEXT NOT NULL,
              phase         INTEGER NOT NULL,
              status        TEXT DEFAULT 'pending',
              sent_at       TEXT,
              confirmed_at  TEXT,
              PRIMARY KEY (deployment_id, device_id)
            );
            CREATE INDEX IF NOT EXISTS idx_devices_status
              ON devices(status);
            CREATE INDEX IF NOT EXISTS idx_audit_device
              ON audit_log(device_id, ts DESC);
            CREATE INDEX IF NOT EXISTS idx_dep_status
              ON ota_deployments(status, chip_target);
            CREATE INDEX IF NOT EXISTS idx_dep_devices
              ON ota_deployment_devices(deployment_id, phase, status);
        """)
    # Warm up MQTT
    try:
        get_mqtt()
        log.info("MQTT connected")
    except Exception as e:
        log.warning(f"MQTT not available: {e}")
    yield
    if _mqtt_client:
        _mqtt_client.loop_stop()
        _mqtt_client.disconnect()

app = FastAPI(title="HomePi Provisioning API", lifespan=lifespan)
app.add_middleware(CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ==============================================
# DEVICE ROUTES   /api/devices/*
# ==============================================

class AnnounceRequest(BaseModel):
    device_id:      str
    chip_id:        str
    fw_version:     str
    capabilities:   list[str]
    nonce:          str
    hmac_proof:     str

@app.post("/api/devices/announce")
async def announce(req: AnnounceRequest):
    """
    ESP32 s'annonce avec preuve HMAC.
    Cree/met a jour le device en pre_announced.
    Declenche une notification SSE si une session pairing est ouverte.
    """
    if not verify_hmac_proof(req.device_id, req.nonce, req.hmac_proof):
        raise HTTPException(403, "HMAC proof invalid")

    with db() as conn:
        conn.execute("""
            INSERT INTO devices
              (device_id, chip_id, fw_version, capabilities, status, last_seen)
            VALUES (?, ?, ?, ?, 'pre_announced', strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            ON CONFLICT(device_id) DO UPDATE SET
              chip_id=excluded.chip_id,
              fw_version=excluded.fw_version,
              capabilities=excluded.capabilities,
              last_seen=excluded.last_seen,
              status=CASE WHEN status='suspended' THEN 'suspended'
                         ELSE 'pre_announced' END
        """, (req.device_id, req.chip_id, req.fw_version,
              json.dumps(req.capabilities)))
    audit(req.device_id, "announced", f"chip={req.chip_id} fw={req.fw_version}")

    # Notifier les sessions pairing ouvertes
    for sess in _sessions.values():
        if sess["phase"] == "waiting":
            sess["phase"] = "seen"
            sess["device_id"] = req.device_id
            sess["device_data"] = req.model_dump()
            for q in sess["queues"]:
                q.put_nowait({"event": "device_seen",
                              **req.model_dump(),
                              "pin": compute_pin(req.device_id)})

    return {"status": "announced", "device_id": req.device_id}

@app.get("/api/devices/{device_id}/status")
async def device_status(device_id: str):
    """ESP32 poll : suis-je approuve ?"""
    with db() as conn:
        row = conn.execute(
            "SELECT status FROM devices WHERE device_id=?", (device_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Unknown device")
    return {"device_id": device_id, "status": row["status"]}



class EnrollRequest(BaseModel):
    device_id:  str
    csr_pem:    str



class X5CEnrolledRequest(BaseModel):
    device_id:        str
    chip_id:          str
    chip_target:      str = "esp32c3"
    fw_version:       str
    capabilities:     list[str]
    hw_model:         str = "" # scan I2C ESP32 - source of truth
    cert_fingerprint: str   # SHA256 du LDevID emis par step-ca
    cert_expiry:      str   # ISO datetime



@app.post("/api/devices/x5c-enrolled")
async def x5c_enrolled(req: X5CEnrolledRequest):
    """
    Called by ESP32 after enrollment X5C succedded.
    Device has already its LDevID signed by step-ca - HMAC not needed.
    We check only if device_id matches with expected format.
    """
    if not req.device_id.startswith("esp32-"):
        raise HTTPException(400, "Invalid device_id format")

    hw_model    = req.hw_model or "unknown"
    chip_target = req.chip_target

    with db() as conn:
        conn.execute("""
            INSERT INTO devices
              (device_id, chip_id, chip_target, hw_model, fw_version, capabilities, status,
               cert_fingerprint, cert_expiry, enrolled_at, last_seen,
               confirmed_by)
            VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'),
                    strftime('%Y-%m-%dT%H:%M:%SZ','now'), 'zero-touch')
            ON CONFLICT(device_id) DO UPDATE SET
              chip_target      = excluded.chip_target,
              hw_model         = excluded.hw_model,
              fw_version       = excluded.fw_version,
              capabilities     = excluded.capabilities,
              status           = 'active',
              cert_fingerprint = excluded.cert_fingerprint,
              cert_expiry      = excluded.cert_expiry,
              enrolled_at      = excluded.enrolled_at,
              last_seen        = excluded.last_seen,
              confirmed_by     = 'zero-touch'
         """, (req.device_id, req.chip_id, chip_target, hw_model, req.fw_version,
               json.dumps(req.capabilities),
               req.cert_fingerprint, req.cert_expiry))

    audit(req.device_id, "zero_touch_enrolled",
          f"chip={req.chip_id} hw={hw_model} fw={req.fw_version}")



    # --- OTA auto if most recent firmware available ----------------------
    latest = get_latest_firmware(chip_target)
    if latest and not same_version(latest["version"], req.fw_version):
        log.info(
            f"Auto-OTA: {req.device_id} "
            f"{req.fw_version} -> {latest['version']}"
        )
        def _delayed_ota():
            time.sleep(60)
            payload = json.dumps({
                "type":    "ota",
                "version": latest["version"],
                "url":     latest["url"],
                "sha256":  latest["sha256"],
            })
            try:
                get_mqtt().publish(
                    f"iot/{req.device_id}/commands",
                    payload, qos=1, retain=False)
                audit(req.device_id, "auto_ota_sent",
                      f"{req.fw_version}->{latest['version']}")
            except Exception as e:
                log.error(f"Auto-OTA failed: {e}")
        threading.Thread(target=_delayed_ota, daemon=True).start()

    # ---------------------------------------------------------------

    return {"status": "active", "device_id": req.device_id, "hw_model": hw_model}



@app.post("/api/devices/enroll")
async def enroll(req: EnrollRequest):
    """
    ESP32 envoie un CSR -> recoit son LDevID.
    Requis : device en status 'approved'.
    """
    with db() as conn:
        row = conn.execute(
            "SELECT status FROM devices WHERE device_id=?", (req.device_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Unknown device")
    if row["status"] != "approved":
        raise HTTPException(403, f"Not approved (status={row['status']})")
    cert_pem = step_sign_csr(req.csr_pem, req.device_id)

    # Extraire fingerprint et expiry du cert
    import subprocess as sp
    fp = sp.run(["openssl","x509","-noout","-fingerprint","-sha256"],
                input=cert_pem, capture_output=True, text=True).stdout.strip()
    exp = sp.run(["openssl","x509","-noout","-enddate"],
                 input=cert_pem, capture_output=True, text=True).stdout.strip()

    with db() as conn:
        conn.execute("""
            UPDATE devices SET
              status='active', cert_fingerprint=?, cert_expiry=?,
              enrolled_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'), confirmed_by='operator'
            WHERE device_id=?
        """, (fp, exp.replace("notAfter=","").strip(), req.device_id))
    audit(req.device_id, "enrolled", f"fp={fp}", "api")

    return {"device_id": req.device_id, "cert_pem": cert_pem}



def _extract_cn(dn: str) -> str:
    """Parse CN from complete DN.
    Supported formats :
       '/CN=esp32-819ff7b8/0=HomePi/C=JP'  (OpenSSL slash)
       'CN=esp32-819ff7b8,0=HomePi,C=JP'   (RFC 4514)
    """
    import re
    m = re.search(r'(?:^|[,/])CN=([^,/]+)', dn or '')
    return m.group(1).strip() if m else ''



@app.post("/api/devices/{device_id}/renew")
async def renew(device_id: str, req: EnrollRequest, request: Request):
    """
    ESP32 renouvelle son LDevID (a J-30).
    Le cert client actuel est verifie par Mosquitto/Nginx (mTLS).
    """
    dn = request.headers.get("X-SSL-Client-DN", "")
    cn = _extract_cn(dn)
    if cn and cn != device_id:
        raise HTTPException(403, f"CN mismatch: {cn} != {device_id}")

    # Check device is active
    with db() as conn:
        row = conn.execute(
            "SELECT status FROM devices WHERE device_id=?", (device_id,)
        ).fetchone()
    if not row or row["status"] != "active":
        raise HTTPException(403, "Device not active")

    cert_pem = step_sign_csr(req.csr_pem, device_id)

    # Extract fingerprint + expiry of new cert
    import subprocess as sp
    fp  = sp.run(["openssl","x509","-noout","-fingerprint","-sha256"],
                input=cert_pem, capture_output=True, text=True).stdout.strip()
    exp = sp.run(["openssl","x509","-noout","-enddate"],
                 input=cert_pem, capture_output=True, text=True).stdout.strip()

    with db() as conn:
        conn.execute("""
            UPDATE devices SET
              cert_fingerprint = ?,
              cert_expiry      = ?,
              enrolled_at      = strftime('%Y-%m-%dT%H:%M:%SZ','now')
            WHERE device_id = ?
         """, (fp, exp.replace("notAfter=","").strip(), device_id))

    audit(device_id, "cert_renewed", f"fp={fp}", "device")
    return {"device_id": device_id, "cert_pem": cert_pem}



# ==========================================
# ADMIN ROUTES   /api/admin/*
# ==========================================

@app.post("/api/admin/pairing/open")
async def pairing_open():
    """Ouvre une fenetre de pairing (TTL=60s)."""
    sid = secrets.token_hex(16)
    _sessions[sid] = {
        "phase":     "waiting",
        "device_id": None,
        "device_data": None,
        "remaining": PAIRING_TTL,
        "queues":    [],
    }

    async def countdown():
        for i in range(PAIRING_TTL, 0, -1):
            await asyncio.sleep(1)
            if sid not in _sessions:
                return
            _sessions[sid]["remaining "] = i
            for q in _sessions[sid]["queues"]:
                q.put_nowait({"event": "heartbeat", "remaining": i})
        if sid in _sessions and _sessions[sid]["phase"] == "waiting":
            for q in _sessions[sid]["queues"]:
                q.put_nowait({"event": "expired"})
            _sessions.pop(sid, None)

    asyncio.create_task(countdown())
    return {"session_id": sid, "ttl": PAIRING_TTL}



@app.get("/api/admin/pairing/stream/{session_id}")
async def pairing_stream(session_id: str):
    """SSE - notifications temps reel vers le dashboard."""
    if session_id not in _sessions:
        raise HTTPException(404, "Session not found")

    queue: asyncio.Queue = asyncio.Queue()
    _sessions[session_id]["queues"].append(queue)

    async def event_generator():
        try:
            while True:
                data = await asyncio.wait_for(queue.get(), timeout=5)
                yield f"data: {json.dumps(data)}\n\n"
                if data.get("event") in ("device_seen", "expired"):
                    break
        except asyncio.TimeoutError:
            yield 'data: {"event":"heartbeat"}\n\n'
        finally:
            if session_id in _sessions:
                try: _sessions[session_id]["queues"].remove(queue)
                except ValueError: pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )




@app.post("/api/admin/pairing/confirm/{device_id}")
async def pairing_confirm(device_id: str):
    """Operateur confirme - device passe en 'approved'."""
    with db() as conn:
        conn.execute(
            "UPDATE devices SET status='approved', confirmed_by='operator' "
            "WHERE device_id=?", (device_id,))
    audit(device_id, "operator_approved", operator="operator")
    return {"device_id": device_id, "status": "approved"}



@app.get("/api/admin/devices")
async def list_devices():
    """Liste tous les devices."""
    with db() as conn:
        rows = conn.execute("""
            SELECT device_id, chip_id, chip_target, hw_model, fw_version, capabilities,
                   status, cert_fingerprint, cert_expiry,
                   enrolled_at, last_seen, confirmed_by, label
            FROM devices ORDER BY last_seen DESC
        """).fetchall()
    def parse(r):
        d = dict(r)
        try:
            d["capabilities"] = json.loads(d["capabilities"] or "[]")
        except Exception:
            d["capabilities"] = []
        return d
    return {"devices": [parse(r) for r in rows]}



@app.post("/api/admin/devices/{device_id}/confirm")
async def confirm_device(device_id: str):
    """Reactive un device suspendu - re-enrollment automatique."""
    with db() as conn:
        conn.execute(
            "UPDATE devices SET status='approved' WHERE device_id=?", (device_id,)
        )
    # Retirer du revoked.acl si present
    if Path(ACL_REVOKED).exists():
        lines = Path(ACL_REVOKED).read_text().splitlines()
        filtered, skip = [], False
        for line in lines:
            if line.strip() == f"user {device_id}":
                skip = True; continue
            if skip and line.strip().startswith("topic"):
                skip = False; continue
            filtered.append(line)
        Path(ACL_REVOKED).write_text("\n".join(filtered))
        try:
            pid = int(Path(MOSQUITTO_PID).read_text().strip())
            os.kill(pid, 1)
        except Exception:
            pass
    audit(device_id, "reactivated", operator="operator")
    return {"device_id": device_id, "status": "approved"}



@app.post("/api/admin/devices/{device_id}/suspend")
async def suspend_device(device_id: str):
    """Suspend un device - revocation ACL immediate."""
    with db() as conn:
        row = conn.execute(
            "SELECT cert_fingerprint FROM devices WHERE device_id=?", (device_id,)
        ).fetchone()
    if not row:
        raise HTTPException(404, "Unknown device")

    with db() as conn:
        conn.execute(
            "UPDATE devices SET status='suspended' WHERE device_id=?", (device_id,)
        )
    revoke_via_acl(device_id)
    audit(device_id, "suspended", operator="operator")
    return {"device_id": device_id, "status": "suspended"}



class OTARequest(BaseModel):
    version:  str
    url:      str
    checksum: str

    @field_validator("checksum")
    @classmethod
    def checksum_must_be_valid_sha256(cls, v):
        if len(v) != 64 or not all(c in "0123456789abcdef" for c in v.lower()):
            raise ValueError("checksum must be a valid 64-char hex SHA256")
        return v

@app.post("/api/admin/devices/{device_id}/ota")
async def send_ota(device_id: str, req: OTARequest):
    """Pousse une commande OTA via MQTT."""
    payload = json.dumps({
        "type":    "ota",
        "version": req.version,
        "url":     req.url,
        "sha256":  req.checksum,
    })
    info = get_mqtt().publish(f"iot/{device_id}/commands", payload, qos=1, retain=False)
    info.wait_for_publish(timeout=5)
    audit(device_id, "ota_sent", f"v{req.version}", "operator")
    return {"device_id": device_id, "ota_version": req.version}



@app.post("/api/admin/devices/{device_id}/renew")
async def admin_renew_cert(device_id: str):
    """Dashboard -> comande MQTT -> ESP32 do renewal itself."""
    payload = json.dumps({"type": "renew_cert"})
    info    = get_mqtt().publish(f"iot/{device_id}/commands", payload, qos=1)
    info.wait_for_publish(timeout=5)
    audit(device_id, "renewal_commanded", operator="operator")
    return {"status": "renewal_command_sent", "device_id": device_id}


# --- Firmware Catalog -----------------------

@app.post("/api/admin/firmware/upload")
async def upload_firmware(
    file:        UploadFile = File(...),
    version:     str        = Form(...),
    chip_target: str        = Form(...),
    hw_model:    str        = Form(""),
    notes:       str        = Form(""),
):
    dest_dir = Path(f"/opt/homepi/firmware/{chip_target}")
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"v{version}.bin"
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    h = hashlib.sha256()
    with open(dest, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    sha = h.hexdigest()
    dest.parent.joinpath(f"v{version}.sha256").write_text(sha)

    url = f"https://homepi.internal/fw/{chip_target}/v{version}.bin"
    with db() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO firmware_catalog
              (version, chip_target, hw_model, sha256, url, notes)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (version, chip_target, hw_model, sha, url, notes))

    audit("system", "firmware_uploaded", f"{chip_target}/v{version}")
    return {"version": version, "chip_target": chip_target, "sha256": sha, "url": url}


@app.get("/api/admin/firmware")
async def list_firmware():
    with db() as conn:
        rows = conn.execute("""
            SELECT version, chip_target, hw_model, sha256,
                   url, uploaded_at, notes
            FROM firmware_catalog ORDER BY uploaded_at DESC
        """).fetchall()
    return {"firmware": [dict(r) for r in rows]}



# --- Staged Rollout endpoints ---------------------

@app.post("/api/admin/firmware/{version}/deploy")
async def deploy_firmware(version: str, chip_target: str = "esp32c3"):
    """Declenche un staged rollout : canary -> 25% -> 100%."""
    with db() as conn:
        fw = conn.execute(
            "SELECT * FROM firmware_catalog "
            "WHERE version=? AND chip_target=?",
            (version, chip_target)).fetchone()
    if not fw:
        raise HTTPException(404, f"Firmware {version}/{chip_target} not found")

    with db() as conn:
        active = conn.execute("""
            SELECT id FROM ota_deployments
            WHERE status='in_progress' AND chip_target=?
        """, (chip_target,)).fetchone()
    if active:
        raise HTTPException(409,
            f"Deployment {active['id']} already in progress")

    dep_id = None

    def _start():
        nonlocal dep_id
        dep_id = start_staged_deployment(version, chip_target, "operator")

    t = threading.Thread(target=_start, daemon=True)
    t.start()
    t.join(timeout=2)

    return {"status": "deployment_started", "version": version, "chip_target": chip_target}


@app.get("/api/admin/deployments")
async def list_deployments():
    with db() as conn:
        rows = conn.execute("""
            SELECT d.id, d.version, d.chip_target, d.status,
                   d.created_at, d.created_by,
                   COUNT(dd.device_id)   as total,
                   SUM(CASE WHEN dd.status='confirmed'    THEN 1 ELSE 0 END) as confirmed,
                   SUM(CASE WHEN dd.status='sent'         THEN 1 ELSE 0 END) as sent,
                   SUM(CASE WHEN dd.status='rolled_back'  THEN 1 ELSE 0 END) as rolled_back,
                   SUM(CASE WHEN dd.status='pending'      THEN 1 ELSE 0 END) as pending
            FROM ota_deployments d
            LEFT JOIN ota_deployment_devices dd ON d.id = dd.deployment_id
            GROUP BY d.id 
            ORDER BY d.created_at DESC
            LIMIT 20
        """).fetchall()
    return {"deployments": [dict(r) for r in rows]}


@app.get("/api/admin/deployments/{deployment_id}")
async def get_deployment(deployment_id: int):
    with db() as conn:
        dep = conn.execute(
            "SELECT * FROM ota_deployments WHERE id=?",
            (deployment_id,)).fetchone()
        if not dep:
            raise HTTPException(404, "Deployment not found")
        devices = conn.execute("""
            SELECT dd.*, dev.fw_version, dev.hw_model
            FROM ota_deployment_devices dd
            JOIN devices dev ON dd.device_id = dev.device_id
            WHERE dd.deployment_id=?
            ORDER BY dd.phase, dd.device_id
        """, (deployment_id,)).fetchall()
    return {
        "deployment": dict(dep),
        "devices":    [dict(r) for r in devices]
    }



@app.post("/api/admin/deployments/{deployment_id}/abort")
async def abort_deployment(deployment_id: int):
    with db() as conn:
        conn.execute(
            "UPDATE ota_deployments SET status='aborted' WHERE id=?",
            (deployment_id,))
    audit("system", "ota_aborted_manual",
          f"dep={deployment_id}", "operator")
    return {"deployment_id": deployment_id, "status": "aborted"}



# --- Floor plans -----------------------------
FLOORPLAN_PATH = Path("/var/lib/homepi/floorplans.json")

@app.get("/api/admin/floorplans")
async def get_floorplans():
    if not FLOORPLAN_PATH.exists():
        return {}
    return json.loads(FLOORPLAN_PATH.read_text())

@app.post("/api/admin/floorplans")
async def save_floorplans(request: Request):
    data = await request.json()
    FLOORPLAN_PATH.write_text(json.dumps(data))
    return {"status": "saved"}


# ======================================
# LED CONTROL    /api/admin/led/*
# ======================================

@app.post("/api/admin/led/{device_id}/composition")
async def push_led_composition(device_id: str, composition: LedComposition):
    """Pousse une composition de layers en temps reel vers un device LED via MQTT."""
    if not device_exists(device_id):
        raise HTTPException(404, f"Device {device_id} not found")

    payload = json.dumps({
        "type":   "led_composition",
        "layers": [l.model_dump() for l in composition.layers],
    })
    info = get_mqtt().publish(f"iot/{device_id}/commands", payload, qos=1, retain=True)
    info.wait_for_publish(timeout=5)

    audit(device_id, "led_composition_pushed",
          f"layers={len(composition.layers)}", "operator")
    return {"status": "composition sent", "device_id": device_id}


@app.get("/api/admin/led/presets")
async def list_led_presets():
    return {"presets": load_led_presets()}


@app.post("/api/admin/led/presets")
async def create_led_preset(preset: LedPreset):
    presets = load_led_presets()
    new_preset = {
        "id":         str(uuid.uuid4()),
        "name":       preset.name,
        "layers":     [l.model_dump() for l in preset.layers],
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    presets.append(new_preset)
    save_led_presets(presets)
    audit("system", "led_preset_created", preset.name, "operator")
    return new_preset


@app.put("/api/admin/led/presets/{preset_id}")
async def update_led_preset(preset_id: str, body: LedComposition):
    presets = load_led_presets()
    for p in presets:
        if p["id"] == preset_id:
            p["layers"] = [l.model_dump() for l in body.layers]
            save_led_presets(presets)
            return p
    raise HTTPException(404, f"Preset {preset_id} not found")

@app.delete("/api/admin/led/presets/{preset_id}")
async def delete_led_preset(preset_id: str):
    presets = load_led_presets()
    filtered = [p for p in presets if p["id"] != preset_id]
    if len(filtered) == len(presets):
        raise HTTPException(404, f"Preset {preset_id} not found")
    save_led_presets(filtered)
    audit("system", "led_preset_deleted", preset_id, "operator")
    return {"status": "deleted"}



@app.put("/api/admin/led/presets/reorder")
async def reorder_led_presets(req: ReorderRequest):
    presets = load_led_presets()
    by_id = {p["id"]: p for p in presets}
    reordered = [by_id[i] for i in req.ordered_ids if i in by_id]
    # Garde toute entrée oubliée par sécurité, à la fin
    reordered += [p for p in presets if p["id"] not in req.ordered_ids]
    save_led_presets(reordered)
    return {"status": "reordered"}


@app.get("/metrics/homepi", response_class=PlainTextResponse)
async def homepi_metrics():
    with db() as conn:
        devices = conn.execute(
            "SELECT device_id, status, cert_expiry FROM devices"
        ).fetchall()

    now = datetime.now(timezone.utc)
    lines = [
        "# HELP homepi_device_cert_expiry_days Days until device mTLS cert expiry",
        "# TYPE homepi_device_cert_expiry_days gauge",
    ]
    for d in devices:
        exp = _parse_cert_expiry(d["cert_expiry"])
        if exp is None:
            continue
        days = (exp - now).days
        lines.append(f'homepi_device_cert_expiry_days{{device_id="{d["device_id"]}",status="{d["status"]}"}} {days}')

    from collections import Counter
    counts = Counter(d["status"] for d in devices)
    lines += [
        "# HELP homepi_devices_by_status Number of devices per provisioning status",
        "# TYPE homepi_devices_by_status gauge",
    ]
    for status, n in counts.items():
        lines.append(f'homepi_devices_by_status{{status="{status}"}} {n}')

    return PlainTextResponse("\n".join(lines) + "\n")
