# Runbook: Nginx and the provisioning API

## State measured 2026-11-08

- Nginx serves `homepi.internal` and `auth.homepi.internal`. Routes: `/api/devices/` (IoT subnet, no user
  authentication) to 127.0.0.1:8090; `/api/admin/` (LAN and NetBird, Authelia 2FA) to 127.0.0.1:8091;
  `/step/roots` and `/step/sign` (IoT subnet) to step-ca; `/fw/` (IoT subnet).
- Client certificates: `ssl_verify_client optional`, trusted CA is the root alone, so a client that sends
  its leaf without the intermediate fails (400).
- One application (`provisioning_api:app`) runs twice: `homepi-api` (8090) and `homepi-api-admin` (8091).
  The only separation is the Nginx routing; the API has no authentication of its own, so every local
  process can call the admin routes on either port.
- Freeze since 2026-10-23 (`snippets/homepi-freeze-device-registration.conf`, from an audit):
  `x5c-enrolled` and `renew` answer 403 until the API enforces mTLS or pre-registration.
- Python packages: `roles/provisioning_api/files/requirements.lock` (pip freeze of `/opt/homepi/api-venv`;
  no requirements file existed). `devices.db` is copied by `homepi-backup-state` (sqlite `.backup`).

## Known flaws (open)

1. `/renew` identity check never runs: the API reads `X-SSL-Client-DN`, Nginx sets `X-SSL-Client-CN`, and
   `X-SSL-Verify` is not checked; a client can also send the header itself. Masked by the freeze.
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

Roles `nginx` and `provisioning_api` verify only: files byte for byte, TLS files and secrets by presence,
owner and mode, `nginx -t`, the Python packages against `requirements.lock`, the services. Fixes go
through a release, never by hand.

## Two copies of the API code (to reconcile in B7)

`apps/api/provisioning_api.py` differs from the code running on the Pi (+25/-31 lines on
2026-11-08). The role verifies the Pi copy (`roles/provisioning_api/files/provisioning_api.py`); `apps/api`
is stale. B7 keeps one copy only.

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
