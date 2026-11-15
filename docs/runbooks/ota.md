# Runbook: signed OTA and staged rollouts (v0.1.120, firmware v2.4.1)

## Model

| Piece | Where | Holds |
|---|---|---|
| OTA signing key (ECDSA P-256) | operator laptop `~/homepi-pki/ota-signing/ota-signing-key.pem`, encrypted with a passphrase; encrypted copy on the recovery USB key | signs manifests, never leaves the laptop |
| Public key | compiled into every image (homepi-firmware `components/homepi_ota/ota_signing_pub.pem`) and `/etc/homepi/ota_signing_pub.pem` on the Pi (role `ota_rollout`) | fingerprint `e8a15699ca026315` (sha256 of the DER key) |
| Manifest | `{"chip_target","project","sha256","version"}`, compact JSON, sorted keys | what is signed |
| Signed images | `firmware_images` table, files in `/opt/homepi/firmware/<project>/<version>.bin`, served by nginx under `/fw/` (IoT subnet only) | image, manifest, signature |
| Rollouts | `rollouts`, `rollout_devices`, `ota_events` tables; `apps/api/rollout.py` | the whole state |
| Stepper | `homepi-ota-rollout.timer` (every minute) runs `rollout.py step` as `homepi-api` | moves each rollout one step |

The Pi relays what the laptop signed: it holds only the public key, so a compromised Pi or API can
neither sign an image nor make a device accept one. Each device checks, before writing anything:
the signature, its own project, its chip, a version strictly newer than the running one; and on
the image, before marking it bootable: the version and project of its app descriptor and its
SHA-256. A refused command is reported on `iot/<id>/status` as `{"type":"ota_failed","reason":...}`,
recorded in `ota_events`, and alerted (`OtaCommandRefused`).

First hop: firmware v2.4.0 does not check signatures; it checks only the SHA-256 from the command.
The v2.4.0 to v2.4.1 rollout is therefore protected by the broker's mTLS and ACL and by the API's
own signature check at upload; from v2.4.1 on, the device checks the signature itself.

## Rollout state machine

Phases: one canary (the oldest enrolled device), then about a quarter, then the rest. For each
device of the current phase, each minute:

- `pending`: the command is published (QoS 1); a publish failure leaves it pending for the next step;
- `sent` to `confirmed`: the registry shows the new version (the image confirms itself on its first
  broker connection, firmware `mqtt_app.c`);
- `sent` to `failed`: an `ota_failed` report after the command, or still on the old version after
  `timeout_minutes` (default 20: the image never confirmed and the bootloader reverted it after the
  10-minute deadline, or the device is offline).

Any failed device aborts the rollout: later phases are never sent anything. A phase whose devices
all confirmed moves on after `soak_minutes` (default 30) if they all still publish. State lives in
the database only: an API or Pi restart in the middle of a rollout loses nothing (until v0.1.119
the waits were `time.sleep` threads in the API process, which every deployment restarts, and each
phase sent the newest image of the chip instead of the rollout's own image).

## Procedures

Sign an image (laptop, homepi-firmware, signed tag):

    tools/ota-sign.sh v2.4.1 homepi_sensor          # passphrase typed once; output ~/homepi-ota/v2.4.1/homepi_sensor/

Upload (laptop -> Pi; the API refuses a bad signature, a manifest that does not name the file, or a
version already in the catalog):

    scp ~/homepi-ota/v2.4.1/homepi_sensor/{image.bin,manifest.json,manifest.sig} homepi:/tmp/ota/
    ssh homepi 'sudo curl -s --unix-socket /run/homepi-api/admin.sock -F file=@/tmp/ota/image.bin \
      -F manifest=</tmp/ota/manifest.json -F signature=</tmp/ota/manifest.sig http://localhost/api/admin/firmware/upload'

Projects of the devices (from homepi-firmware `fleet/devices.csv`; firmware v2.4.1 reports its own):

    POST /api/admin/devices/<id>/project {"project": "homepi_sensor"}

Start, follow, abort: dashboard Fleet tab, Deployments, or `POST /api/admin/rollouts {project, version,
soak_minutes, timeout_minutes}`, `GET /api/admin/rollouts`, `POST /api/admin/rollouts/<id>/abort`.

## Alerts

`OtaRolloutAborted` (a rollout aborted in the last 24 h), `OtaRolloutStuck` (in progress for more
than 6 h), `OtaCommandRefused` (a device refused or failed an OTA command in the last 24 h: outside a
rollout, someone published an OTA command).

## Proof plan (A5)

On the canary sensor, each case observed on the device and in the registry:

1. unsigned command -> `ota_failed unsigned_command`, device stays on its image;
2. command signed by another key -> `bad_signature`;
3. a signed image of another project -> `wrong_project`;
4. a signed older version -> `not_newer`;
5. the signed v2.4.1 rollout -> canary confirmed, soak, phases 2 and 3;
6. a signed rollback test image (`tools/ota-sign.sh <tag> homepi_sensor --rollback-test`, never
   connects to the broker) -> the bootloader reverts it after 10 minutes, the rollout aborts and the
   next phases are never sent.
