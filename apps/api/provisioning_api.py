#!/usr/bin/env python3
"""
HomePi - Provisioning API
FastAPI sur port 8090

Routes :
  /api/devices/*   -> IoT VLAN (ESP32), pas d'auth
  /api/admin/*     -> LAN (Dashboard), Authelia via Nginx
"""

import base64, hashlib, json, logging, os, re, sqlite3, time, threading, shutil
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
from versions import same_version
import rollout
import nilm_calibration
from urllib.parse import unquote
from cryptography import x509


# --- Config -------------------
DB_PATH         = "/var/lib/homepi/devices.db"
STEP_ROOT_CA    = "/etc/step-ca/certs/root_ca.crt"
STEP_CA_URL     = "https://127.0.0.1:8443"
PAIRING_TTL     = 60    # seconds

MQTT_HOST       = "127.0.0.1"
MQTT_PORT       = 1883
MQTT_USER       = "homepi-api"
MQTT_PASS       = os.environ.get("API_MQTT_PASS", "")


# One MQTT session per API instance (v0.1.112). Both instances connected as "homepi-api": each
# connection closed the other one (19,989 takeovers in 24 h, about one per second), and the sensor
# subscription, made once outside on_connect, was lost: last_seen and fw_version stopped updating.
def _mqtt_client_id() -> str:
    return "homepi-api-" + (os.environ.get("HOMEPI_API_SURFACE", "") or "dev")


def _mqtt_subscribes() -> bool:
    """Only the device instance (or a development run) updates the registry from telemetry."""
    return os.environ.get("HOMEPI_API_SURFACE", "") in ("device", "")


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





# --- MQTT client ---------------------
_mqtt_client: Optional[mqtt.Client] = None
_mqtt_lock = threading.Lock()

# Every telemetry topic proves the device is alive (v0.1.113): the registry read only iot/<id>/sensors,
# so the NILM bridge (nilm) and the LED controller (status) looked silent since 2026-10-14.
TELEMETRY_KINDS = ("sensors", "status", "nilm")
LAST_SEEN_MIN_INTERVAL = 30  # seconds between registry writes per device (NILM publishes several per second)
_last_write: dict[str, tuple[float, str | None]] = {}


def on_sensor_message(client, userdata, msg):
    try:
        parts = msg.topic.split("/")
        if len(parts) != 3 or parts[0] != "iot" or parts[2] not in TELEMETRY_KINDS:
            return
        # A retained message is replayed by the broker at every (re)subscription: it says nothing about
        # the device being alive (after a broker restart it refreshed last_seen of every device at once)
        if getattr(msg, "retain", False):
            return
        device_id = parts[1]
        fw = None
        try:
            payload = json.loads(msg.payload)
            if isinstance(payload, dict):
                fw = payload.get("fw") or None
                # v0.1.120: a refused or failed OTA (firmware v2.4.1+) stops the rollout of that device
                if parts[2] == "status" and payload.get("type") == "ota_failed":
                    with db() as conn:
                        conn.execute("INSERT INTO ota_events (device_id, reason, version, detail) VALUES (?, ?, ?, ?)",
                                     (device_id, str(payload.get("reason", "unknown"))[:40],
                                      str(payload.get("version", ""))[:32], str(payload.get("detail", ""))[:96]))
                    audit(device_id, "ota_failed", f"{payload.get('reason')} {payload.get('version', '')} running={payload.get('running', '')}")
                # v0.1.121: firmware v2.4.2+ acknowledges a queued command; a rollout fails a device that
                # does not within rollout.ACK_TIMEOUT
                elif parts[2] == "status" and payload.get("type") == "ota_received":
                    with db() as conn:
                        rid = rollout.record_ack(conn, device_id, str(payload.get("version", ""))[:32])
                    audit(device_id, "ota_received",
                          f"{payload.get('version', '')} running={payload.get('running', '')}" + (f" rollout={rid}" if rid else " (no rollout waiting)"))
        except ValueError:
            pass
        now = time.monotonic()
        last_t, last_fw = _last_write.get(device_id, (float("-inf"), None))
        if now - last_t < LAST_SEEN_MIN_INTERVAL and (fw is None or fw == last_fw):
            return
        with db() as conn:
            if fw:
                conn.execute("""
                    UPDATE devices
                    SET fw_version = ?, last_seen = strftime('%Y-%m-%dT%H:%M:%SZ','now')
                    WHERE device_id = ?
                """, (fw, device_id))
            else:
                conn.execute("""
                    UPDATE devices SET last_seen = strftime('%Y-%m-%dT%H:%M:%SZ','now')
                    WHERE device_id = ?
                """, (device_id,))
        _last_write[device_id] = (now, fw or last_fw)
    except Exception as e:
        log.warning(f"on_sensor_message failed: {e}")


def on_mqtt_connect(client, userdata, flags, reason_code, properties):
    """Runs on every (re)connection: a clean session has no subscription, so it is made here."""
    if reason_code.is_failure:
        log.warning(f"MQTT connection refused: {reason_code}")
        return
    if _mqtt_subscribes():
        client.subscribe([("iot/+/%s" % k, 0) for k in TELEMETRY_KINDS])
    log.info(f"MQTT connected as {_mqtt_client_id()}")


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
    c = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2, client_id=_mqtt_client_id(), protocol=mqtt.MQTTv5)
    c.username_pw_set(MQTT_USER, MQTT_PASS)
    c.on_message = on_sensor_message
    c.on_connect = on_mqtt_connect

    connect_properties = Properties(PacketTypes.CONNECT)
    connect_properties.SessionExpiryInterval = 0

    c.connect(MQTT_HOST, MQTT_PORT, keepalive=60, clean_start=True, properties=connect_properties)
    c.loop_start()
    _mqtt_client = c
    return c

# --- step-ca helpers --------------------

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
        # v0.1.120: signed images, rollouts and OTA failure reports (rollout.py); devices.project
        rollout.ensure_schema(conn)
    # Warm up MQTT
    try:
        get_mqtt()
        log.info("MQTT client started")
    except Exception as e:
        log.warning(f"MQTT not available: {e}")
    yield
    if _mqtt_client:
        _mqtt_client.loop_stop()
        _mqtt_client.disconnect()

app = FastAPI(title="HomePi Provisioning API", lifespan=lifespan)

# Surface split (v0.1.90): each uvicorn instance serves one surface. The device instance serves the
# device routes and the Prometheus metrics; the admin instance serves the admin routes. Anything
# else, including the OpenAPI document, answers 404. Unset means every route (development, tests).
API_SURFACE = os.environ.get("HOMEPI_API_SURFACE", "")
_SURFACE_PREFIXES = {"device": ("/api/devices/", "/metrics/homepi"), "admin": ("/api/admin/",)}


@app.middleware("http")
async def _surface_guard(request: Request, call_next):
    allowed = _SURFACE_PREFIXES.get(API_SURFACE)
    if allowed is not None and not request.url.path.startswith(allowed):
        return PlainTextResponse("Not Found", status_code=404)
    return await call_next(request)

app.add_middleware(CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ==============================================
# DEVICE ROUTES   /api/devices/*
# ==============================================



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






class X5CEnrolledRequest(BaseModel):
    device_id:        str
    chip_id:          str
    chip_target:      str = "esp32c3"
    fw_version:       str
    capabilities:     list[str]
    hw_model:         str = "" # scan I2C ESP32 - source of truth
    cert_fingerprint: str = ""  # ignored since v0.1.114: read from the verified client certificate
    cert_expiry:      str = ""  # ignored since v0.1.114: read from the verified client certificate
    project:          str = ""  # v2.4.1+: the image's project; a rollout targets devices by project



# Registration (v0.1.114). The device calls this route with its LDevID as the TLS client certificate,
# after enrollment, after each renewal and at boot. nginx verifies the certificate and passes it
# ($ssl_client_escaped_cert): fingerprint and expiry are read from it, never from the request body.
# The registry decides: a pre-announced (or operator-approved) device becomes active; an unknown
# device is recorded as pending and refused until an operator approves it; a suspended device stays
# suspended. Only active, approved and pre_announced devices get MQTT rights (homepi-acl-sync).
# The automatic OTA that followed every enrollment is gone: OTA goes through staged deployments only.
REGISTRABLE = ("pre_announced", "approved", "active")

# Revocation (v0.1.118). nginx cannot check the CRL: its ssl_crl checks the whole chain and would need a
# CRL signed by the root, whose key is offline. The API checks the leaf itself against the CRL the
# broker enforces: homepi-crl-sync installs the same verified CRL here for the API. An unreadable CRL
# refuses the registration (503): running devices are not affected, they keep their MQTT session.
CRL_PATH = "/var/lib/homepi/crl.pem"
_crl_cache: dict = {"mtime": None, "serials": frozenset()}


def _revoked_serials() -> frozenset:
    try:
        mtime = os.stat(CRL_PATH).st_mtime_ns
        if mtime != _crl_cache["mtime"]:
            with open(CRL_PATH, "rb") as f:
                crl = x509.load_pem_x509_crl(f.read())
            _crl_cache.update(mtime=mtime, serials=frozenset(r.serial_number for r in crl))
    except (OSError, ValueError) as e:
        log.error(f"CRL unreadable ({CRL_PATH}): {e}")
        raise HTTPException(503, "Revocation status unavailable")
    return _crl_cache["serials"]


def _client_certificate(request: Request) -> x509.Certificate:
    pem = unquote(request.headers.get("X-SSL-Client-Cert", ""))
    if not pem:
        raise HTTPException(403, "Client certificate required")
    try:
        return x509.load_pem_x509_certificate(pem.encode())
    except ValueError:
        raise HTTPException(403, "Unreadable client certificate")


@app.post("/api/devices/x5c-enrolled")
async def x5c_enrolled(req: X5CEnrolledRequest, request: Request):
    """Registration of a device that holds a valid LDevID (see the comment above)."""
    _require_client_identity(request, req.device_id)
    cert = _client_certificate(request)
    fingerprint = cert.fingerprint(hashes.SHA256()).hex()
    expiry = cert.not_valid_after_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    hw_model = req.hw_model or "unknown"
    fields = (req.chip_id, req.chip_target, hw_model, req.fw_version, json.dumps(req.capabilities),
              fingerprint, expiry)
    if cert.serial_number in _revoked_serials():
        audit(req.device_id, "registration_refused_revoked", f"cert={fingerprint[:16]} exp={expiry}")
        raise HTTPException(403, "Client certificate revoked")
    # A device only ever moves to a newer certificate (renewal, re-enrollment). An older one is a
    # leftover from before (v2.3.x re-enrolled at every broker outage): it must not replace the
    # registered certificate, revoked or not.
    with db() as conn:
        registered = conn.execute("SELECT cert_expiry FROM devices WHERE device_id=?", (req.device_id,)).fetchone()
    if registered and registered["cert_expiry"] and expiry < registered["cert_expiry"]:
        audit(req.device_id, "registration_refused_older_certificate",
              f"cert={fingerprint[:16]} exp={expiry} registered_exp={registered['cert_expiry']}")
        raise HTTPException(403, "Older certificate than the registered one")
    with db() as conn:
        row = conn.execute("SELECT status FROM devices WHERE device_id=?", (req.device_id,)).fetchone()
        before = row["status"] if row else None
        if before is None:
            conn.execute("""
                INSERT INTO devices (device_id, chip_id, chip_target, hw_model, fw_version, capabilities,
                                     cert_fingerprint, cert_expiry, status, last_seen)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', strftime('%Y-%m-%dT%H:%M:%SZ','now'))
            """, (req.device_id,) + fields)
            after = "pending"
        elif before in REGISTRABLE:
            conn.execute("""
                UPDATE devices SET chip_id=?, chip_target=?, hw_model=?, fw_version=?, capabilities=?,
                       cert_fingerprint=?, cert_expiry=?, status='active',
                       enrolled_at  = CASE WHEN status='active' THEN enrolled_at
                                           ELSE strftime('%Y-%m-%dT%H:%M:%SZ','now') END,
                       confirmed_by = CASE WHEN status='active' THEN confirmed_by
                                           WHEN status='approved' THEN 'operator' ELSE 'zero-touch' END,
                       last_seen    = strftime('%Y-%m-%dT%H:%M:%SZ','now')
                WHERE device_id=?
            """, fields + (req.device_id,))
            after = "active"
        else:
            after = before
    if after == "active" and req.project in rollout.PROJECTS:
        with db() as conn:
            prev = conn.execute("SELECT project FROM devices WHERE device_id=?", (req.device_id,)).fetchone()["project"]
            if prev != req.project:
                conn.execute("UPDATE devices SET project=? WHERE device_id=?", (req.project, req.device_id))
        # audit() opens its own connection: after the update is committed, or it waits on the lock
        if prev != req.project:
            audit(req.device_id, "project_set", f"{prev or '-'} -> {req.project} (reported by the device)")
    event = {None: "registration_refused_unknown", "active": "registration_refreshed"}.get(before, "registered")
    if before is not None and before not in REGISTRABLE:
        event = "registration_refused_" + before
    audit(req.device_id, event, f"{before}->{after} fw={req.fw_version} hw={hw_model} cert={fingerprint[:16]} exp={expiry}")
    if after != "active":
        raise HTTPException(403, f"Device {after}: operator approval required")
    return {"status": "active", "device_id": req.device_id, "hw_model": hw_model}


def _client_cn(dn: str) -> str:
    """CN of a subject DN in RFC 2253 (CN=a,O=b or C=JP,O=b,CN=a) or OpenSSL slash form (/C=JP/CN=a)."""
    for part in dn.replace("/", ",").split(","):
        key, _, value = part.strip().partition("=")
        if key.strip().upper() == "CN":
            return value.strip()
    return ""


def _require_client_identity(request: Request, device_id: str) -> None:
    """mTLS identity for device routes: nginx verified the client certificate and set these headers.

    nginx sets X-SSL-Verify and X-SSL-Client-DN on /api/devices/ (proxy_set_header replaces any value a
    client sends). The certificate must verify and its CN must be the device the request is about.
    """
    if request.headers.get("X-SSL-Verify", "") != "SUCCESS":
        raise HTTPException(403, "Client certificate required")
    cn = _client_cn(request.headers.get("X-SSL-Client-DN", ""))
    if not cn or cn != device_id:
        raise HTTPException(403, "Client certificate does not match the device")






# ==========================================
# ADMIN ROUTES   /api/admin/*
# ==========================================











@app.get("/api/admin/devices")
async def list_devices():
    """Liste tous les devices."""
    with db() as conn:
        rows = conn.execute("""
            SELECT device_id, chip_id, chip_target, hw_model, fw_version, capabilities,
                   status, cert_fingerprint, cert_expiry,
                   enrolled_at, last_seen, confirmed_by, label, project
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
    audit(device_id, "reactivated", operator="operator")
    return {"device_id": device_id, "status": "approved"}



@app.post("/api/admin/devices/{device_id}/suspend")
async def suspend_device(device_id: str):
    """Suspend a device: homepi-acl-sync drops it from the MQTT allow-list within about 70 s."""
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
    audit(device_id, "suspended", operator="operator")
    return {"device_id": device_id, "status": "suspended"}



# v0.1.120: an OTA command only comes from a rollout of a signed image (rollout.py). The manual
# command with a URL and a checksum typed in the dashboard is gone: nothing unsigned reaches a device.
@app.post("/api/admin/devices/{device_id}/ota")
async def send_ota_gone(device_id: str):
    raise HTTPException(410, "Manual OTA removed: upload a signed image, then start a rollout")


class ProjectRequest(BaseModel):
    project: str


@app.post("/api/admin/devices/{device_id}/project")
async def set_device_project(device_id: str, req: ProjectRequest):
    """The image project of a device (from the fleet manifest, homepi-firmware fleet/devices.csv)."""
    if req.project not in rollout.PROJECTS:
        raise HTTPException(422, f"project must be one of {', '.join(rollout.PROJECTS)}")
    with db() as conn:
        row = conn.execute("SELECT project FROM devices WHERE device_id=?", (device_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Unknown device")
        conn.execute("UPDATE devices SET project=? WHERE device_id=?", (req.project, device_id))
    audit(device_id, "project_set", f"{row['project'] or '-'} -> {req.project}", "operator")
    return {"device_id": device_id, "project": req.project}


@app.post("/api/admin/devices/{device_id}/renew")
async def admin_renew_cert(device_id: str):
    """Dashboard -> comande MQTT -> ESP32 do renewal itself."""
    payload = json.dumps({"type": "renew_cert"})
    info    = get_mqtt().publish(f"iot/{device_id}/commands", payload, qos=1)
    info.wait_for_publish(timeout=5)
    audit(device_id, "renewal_commanded", operator="operator")
    return {"status": "renewal_command_sent", "device_id": device_id}


# --- Signed firmware images and rollouts (v0.1.120) -------

OTA_PUBKEY_PATH = "/etc/homepi/ota_signing_pub.pem"
FIRMWARE_DIR = Path("/opt/homepi/firmware")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_VERSION = re.compile(r"^v\d+\.\d+\.\d+(-rc\d+)?$")


def _verify_manifest(manifest: str, signature_b64: str) -> dict:
    """The manifest must be signed by the OTA key (offline, laptop) and well formed. The API holds
    only the public key: it can check a signature, never make one."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.exceptions import InvalidSignature
    try:
        pub = serialization.load_pem_public_key(Path(OTA_PUBKEY_PATH).read_bytes())
        pub.verify(base64.b64decode(signature_b64, validate=True), manifest.encode(), ec.ECDSA(hashes.SHA256()))
    except (OSError, ValueError, InvalidSignature, TypeError):
        raise HTTPException(422, "Manifest signature does not verify with the OTA signing key")
    try:
        m = json.loads(manifest)
    except ValueError:
        raise HTTPException(422, "Manifest is not JSON")
    if not (isinstance(m, dict) and m.get("project") in rollout.PROJECTS and _VERSION.match(str(m.get("version", "")))
            and m.get("chip_target") in ("esp32c3", "esp32s3") and _SHA256.match(str(m.get("sha256", "")))):
        raise HTTPException(422, "Manifest fields are invalid")
    return m


@app.post("/api/admin/firmware/upload")
async def upload_firmware(
    file:      UploadFile = File(...),
    manifest:  str        = Form(...),
    signature: str        = Form(...),
    notes:     str        = Form(""),
):
    """A signed image from tools/ota-sign.sh: the file must be the one the signed manifest names."""
    m = _verify_manifest(manifest.strip(), signature.strip())
    data = await file.read()
    sha = hashlib.sha256(data).hexdigest()
    if sha != m["sha256"]:
        raise HTTPException(422, "The file is not the image the manifest names (sha256 differs)")
    with db() as conn:
        if conn.execute("SELECT 1 FROM firmware_images WHERE project=? AND version=?", (m["project"], m["version"])).fetchone():
            raise HTTPException(409, f"{m['project']} {m['version']} is already in the catalog")
    dest_dir = FIRMWARE_DIR / m["project"]
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{m['version']}.bin"
    tmp = dest.with_suffix(".bin.tmp")
    tmp.write_bytes(data)
    tmp.replace(dest)
    url = f"https://homepi.internal/fw/{m['project']}/{m['version']}.bin"
    with db() as conn:
        conn.execute("INSERT INTO firmware_images (project, version, chip_target, sha256, url, manifest, signature, notes) "
                     "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                     (m["project"], m["version"], m["chip_target"], sha, url, manifest.strip(), signature.strip(), notes))
    audit("system", "firmware_uploaded", f"{m['project']} {m['version']} {m['chip_target']} sha256={sha[:16]}")
    return {"project": m["project"], "version": m["version"], "chip_target": m["chip_target"], "sha256": sha, "url": url}


@app.get("/api/admin/firmware")
async def list_firmware():
    with db() as conn:
        rows = conn.execute("SELECT project, version, chip_target, sha256, url, notes, uploaded_at "
                            "FROM firmware_images ORDER BY uploaded_at DESC").fetchall()
    return {"firmware": [dict(r) for r in rows]}


class RolloutRequest(BaseModel):
    project:         str
    version:         str
    soak_minutes:    int = rollout.SOAK_DEFAULT
    timeout_minutes: int = 20

    @field_validator("soak_minutes", "timeout_minutes")
    @classmethod
    def bounded(cls, v):
        if not 1 <= v <= 24 * 60:
            raise ValueError("between 1 and 1440 minutes")
        return v


@app.post("/api/admin/rollouts")
async def create_rollout(req: RolloutRequest):
    """Staged rollout of a signed image: canary, a quarter, the rest (homepi-ota-rollout.timer moves it)."""
    try:
        with db() as conn:
            rid = rollout.create(conn, req.project, req.version, "operator", req.soak_minutes, req.timeout_minutes)
    except rollout.RolloutError as e:
        raise HTTPException(409, str(e))
    return {"rollout": rid}


@app.get("/api/admin/rollouts")
async def list_rollouts():
    with db() as conn:
        rows = conn.execute("SELECT * FROM rollouts ORDER BY id DESC LIMIT 50").fetchall()
        out = []
        for r in rows:
            devs = conn.execute("SELECT device_id, phase, status, from_version, sent_at, confirmed_at, detail "
                                "FROM rollout_devices WHERE rollout_id=? ORDER BY phase, device_id", (r["id"],)).fetchall()
            out.append({**dict(r), "devices": [dict(d) for d in devs]})
    return {"rollouts": out}


@app.post("/api/admin/rollouts/{rollout_id}/abort")
async def abort_rollout(rollout_id: int):
    with db() as conn:
        row = conn.execute("SELECT status FROM rollouts WHERE id=?", (rollout_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Unknown rollout")
        if row["status"] != "in_progress":
            raise HTTPException(409, f"Rollout is {row['status']}")
        rollout.abort(conn, rollout_id, "aborted by the operator")
    return {"rollout": rollout_id, "status": "aborted"}


# The unsigned catalog and the in-memory deployments of v0.1.119 and before (kept read-only in the database)
@app.post("/api/admin/firmware/{version}/deploy")
async def deploy_firmware_gone(version: str):
    raise HTTPException(410, "Replaced by POST /api/admin/rollouts (signed images only)")


@app.get("/api/admin/deployments")
async def list_deployments_gone():
    raise HTTPException(410, "Replaced by GET /api/admin/rollouts")


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
# NILM CALIBRATION    /api/admin/nilm/*
# ======================================
# State file read by the Telegraf processor homepi-nilm-calibrate (hot reload). The dashboard wizard
# measures and computes; the API validates the bounds, versions the file and keeps the history.

@app.get("/api/admin/nilm/calibration")
async def get_nilm_calibration():
    return nilm_calibration.load()


@app.put("/api/admin/nilm/calibration")
async def put_nilm_calibration(update: nilm_calibration.CalibrationUpdate):
    try:
        new = nilm_calibration.merge(nilm_calibration.load(), update)
    except ValueError as e:
        raise HTTPException(422, str(e))
    nilm_calibration.save(new)
    parts = (["V"] if update.voltage else []) + [f"CT{k}" for k in sorted(update.cts)]
    audit("nilm", "nilm_calibration_saved",
          f"version={new['version']} parts={','.join(parts)} note={update.note[:80]}", "operator")
    return new


@app.get("/api/admin/nilm/calibration/history")
async def get_nilm_calibration_history(limit: int = 50):
    return {"history": nilm_calibration.history(limit=max(1, min(limit, 200)))}


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
    # Keep any forgotten entry, for safety, at the end
    reordered += [p for p in presets if p["id"] not in req.ordered_ids]
    save_led_presets(reordered)
    return {"status": "reordered"}


@app.get("/metrics/homepi", response_class=PlainTextResponse)
async def homepi_metrics():
    with db() as conn:
        devices = conn.execute(
            "SELECT device_id, status, cert_expiry, last_seen FROM devices"
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

    lines += [
        "# HELP homepi_device_last_seen_timestamp_seconds Last telemetry message (sensors, status or nilm) from the device",
        "# TYPE homepi_device_last_seen_timestamp_seconds gauge",
    ]
    for d in devices:
        seen = _parse_cert_expiry(d["last_seen"])
        if seen is None:
            continue
        lines.append(f'homepi_device_last_seen_timestamp_seconds{{device_id="{d["device_id"]}",status="{d["status"]}"}} {int(seen.timestamp())}')

    from collections import Counter
    counts = Counter(d["status"] for d in devices)
    lines += [
        "# HELP homepi_devices_by_status Number of devices per provisioning status",
        "# TYPE homepi_devices_by_status gauge",
    ]
    for status, n in counts.items():
        lines.append(f'homepi_devices_by_status{{status="{status}"}} {n}')

    # v0.1.120: rollouts (alerts OtaRolloutAborted, OtaRolloutStuck). Without the tables (a registry
    # older than v0.1.120 that the API has not opened yet) the device metrics above are still served.
    try:
        with db() as conn:
            active = conn.execute("SELECT project, version, phase, created_at FROM rollouts WHERE status='in_progress'").fetchall()
            aborted = conn.execute("SELECT COUNT(*) FROM rollouts WHERE status='aborted' AND finished_at >= "
                                   "strftime('%Y-%m-%dT%H:%M:%SZ','now','-24 hours')").fetchone()[0]
            ota_failed = conn.execute("SELECT COUNT(*) FROM ota_events WHERE ts >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-24 hours')").fetchone()[0]
    except sqlite3.OperationalError as e:
        log.warning(f"rollout metrics unavailable: {e}")
        return PlainTextResponse("\n".join(lines) + "\n")
    lines += ["# HELP homepi_rollout_started_timestamp_seconds Start of each rollout in progress",
              "# TYPE homepi_rollout_started_timestamp_seconds gauge"]
    for r in active:
        t = _parse_cert_expiry(r["created_at"])
        if t:
            lines.append(f'homepi_rollout_started_timestamp_seconds{{project="{r["project"]}",version="{r["version"]}",phase="{r["phase"]}"}} {int(t.timestamp())}')
    lines += ["# HELP homepi_rollouts_aborted Rollouts aborted in the last 24 hours",
              "# TYPE homepi_rollouts_aborted gauge", f'homepi_rollouts_aborted{{window="24h"}} {aborted}',
              "# HELP homepi_ota_failed_reports OTA failures reported by devices in the last 24 hours",
              "# TYPE homepi_ota_failed_reports gauge", f'homepi_ota_failed_reports{{window="24h"}} {ota_failed}']
    return PlainTextResponse("\n".join(lines) + "\n")
