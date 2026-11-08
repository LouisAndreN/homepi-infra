# Runbook: Nginx and the provisioning API

## State measured 2026-11-08

- Nginx serves `homepi.internal` and `auth.homepi.internal`. Routes: `/api/devices/` (IoT subnet, no user
  authentication) to 127.0.0.1:8090; `/api/admin/` (LAN and NetBird, Authelia 2FA) to 127.0.0.1:8091;
  `/step/roots` and `/step/sign` (IoT subnet) to step-ca; `/fw/` (IoT subnet).
- Client certificates: `ssl_verify_client optional`, verified against the CA chain (intermediate and root,
  `/etc/nginx/ssl/client-ca-chain.pem`) since v0.1.56, so a client that sends only its leaf verifies.
- One application (`provisioning_api:app`) runs twice: `homepi-api` (8090) and `homepi-api-admin` (8091).
  The only separation is the Nginx routing; the API has no authentication of its own, so every local
  process can call the admin routes on either port.
- Freeze since 2026-10-23 (`snippets/homepi-freeze-device-registration.conf`, from an audit):
  `x5c-enrolled` and `renew` answer 403 until the API enforces mTLS or pre-registration.
- Python packages: `roles/provisioning_api/files/requirements.lock` (pip freeze of `/opt/homepi/api-venv`;
  no requirements file existed). `devices.db` is copied by `homepi-backup-state` (sqlite `.backup`).

## Known flaws (open)

1. Fixed in v0.1.56: `/renew` and `x5c-enrolled` require `X-SSL-Verify: SUCCESS` and a client certificate
   whose CN is the device (`_require_client_identity`, tested in `apps/api/tests/test_identity_guard.py`);
   nginx sets `X-SSL-Client-DN` itself, which replaces any value a client sends. The routes stay closed
   (freeze and `API_ALLOW_DEVICE_SELF_ENROLLMENT`) until the firmware presents its certificate on HTTPS.
2. API signing is broken: `/etc/homepi/step-ca/ca_password` does not open the `admin` provisioner, so the
   fallback enrollment and `renew` cannot sign (first renewal due September 2027).
3. Suspension writes `revoked.acl`, which mosquitto does not load, with an invalid line, and the API user
   can neither write that directory nor signal mosquitto.
4. The ESP32 firmware sends no client certificate on HTTPS (`http_post_json`), so mTLS on `/api/devices/`
   needs a firmware release.
5. The firmware re-enrolls after 3 MQTT disconnects: step-ca signed 232 certificates on 2026-11-07 and 38
   on 2026-11-08; none reached the registry because `x5c-enrolled` is frozen.

## Not adopted (cleanup in B8)

- Nginx: `sites-available/default`, `grafana`, `edge-iot.OBSOLETE_never_enabled`,
  `homepi.internal.bak-20261023`; snippets `authelia-protect.conf` and `authelia-verify.conf` (not loaded);
  `ssl/wildcare.homepi.key` (misspelled old private key) and any other key not declared in the loaded
  configuration.
- API: `/opt/homepi/api/provisioning_api.py.save` (editor backup); units `iot-provisioning.service` and
  `iot-router.service`.

## Model

Role `nginx` applies the main site and the client CA chain (nginx -t, reload, checks, rollback) and
verifies the rest; `provisioning_api` deploys the API code from `apps/api` (database migration,
automatic rollback of code and database) and verifies the rest: files byte for byte, TLS files and secrets by presence,
owner and mode, `nginx -t`, the Python packages against `requirements.lock`, the services. Fixes go
through a release, never by hand.

## One source of truth for the API code (v0.1.55)

Correction of v0.1.54, which called `apps/api` stale: it was the Pi that was behind. `apps/api` carried
three commits never deployed (UTC timestamps, firmware version comparison without the v prefix, device
self-enrollment routes closed by default with `API_ALLOW_DEVICE_SELF_ENROLLMENT`). Since v0.1.55 the role
deploys `apps/api/provisioning_api.py` and `versions.py`; the tests in `apps/api/tests` run before every
release.

## Secrets held by the API (least privilege, to fix in B7)

`/etc/homepi/api.env` holds the InfluxDB token and the Telegraf MQTT password next to the API's own MQTT
password. A compromise of the API exposes InfluxDB and the Telegraf identity on the broker.

## Two copies of the API code (to reconcile in B7)

`apps/api/provisioning_api.py` differs from the code running on the Pi (+25/-31 lines on
2026-11-08). The role verifies the Pi copy (`roles/provisioning_api/files/provisioning_api.py`); `apps/api`
is stale. B7 keeps one copy only.

## Secrets held by the API (least privilege, to fix in B7)

`/etc/homepi/api.env` holds the InfluxDB token and the Telegraf MQTT password next to the API's own MQTT
password. A compromise of the API exposes InfluxDB and the Telegraf identity on the broker.

## Timestamps: migration 001 (v0.1.55)

Until 2026-10-25 the API wrote `datetime('now','utc')`: SQLite's `utc` modifier treats `now` as local time,
so on the Pi (Asia/Tokyo) every stored time was 9 hours early. Proven on 2026-11-08: the last `announce`
of `esp32-819fe250` was stored as `2026-11-07 14:25:17`, and nginx logged it at `2026-11-08 08:25:17 JST`.
Fixing the code was not enough: `CREATE TABLE IF NOT EXISTS` never changes an existing table, so the
defaults of `audit_log.ts`, `unknown_capability_sets.first_seen`, `firmware_catalog.uploaded_at` and
`ota_deployments.created_at` stayed wrong.

`apps/api/migrations/001_utc_timestamps.py`, in one transaction: shifts old-format values by +9 hours to
`%Y-%m-%dT%H:%M:%SZ`, rebuilds the tables with a wrong default (rows, indexes and triggers kept), sets
`PRAGMA user_version = 1`; a second run does nothing, a failure changes nothing. Dry run on a copy of the
live database before release: 7,497 audit rows shifted, four tables rebuilt, row counts unchanged.

The role stops the API, backs the database up to `/var/backups/homepi-api/devices.db.before-deploy`,
migrates as `homepi-api` (devices.db is in WAL mode: the -wal and -shm files must stay owned by the API
user), installs the code, restarts and requires HTTP 200 on 8090 and 8091; on any failure it restores
code and database.

## Device identity metrics and alerts (v0.1.57)

`homepi-device-metrics` (timer: 3 minutes after boot, then every 5 minutes) publishes the sign and renew
requests served by step-ca over the last hour and day (step-ca journal) and the requests from IoT devices
to `/api/devices/` and `/step/` over the last hour by status class (nginx access log; the Pi's own
192.168.200.1 is left out). Alerts: `DeviceEnrollmentBurst` (more than 20 sign requests in an hour: the
re-enrollment loop of 2026-11-07 signed 232 certificates in a day), `DeviceApiRefusals` (more than 30
refused requests in an hour), `DeviceMetricsStale`. Manual run:

    sudo /usr/local/sbin/homepi-device-metrics --stdout
