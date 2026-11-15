# Runbook: signed OTA and staged rollouts (v0.1.121, firmware v2.4.2)

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
- `sent` to `failed` (v0.1.121): no `ota_received` 2 minutes after the command, for a device whose
  firmware sends one (v2.4.2 and later): the command never arrived, or the device dropped it;
- `sent` to `failed`: an `ota_failed` report after the command, or still on the old version after
  `timeout_minutes` (default 20: the image never confirmed and the bootloader reverted it after the
  10-minute deadline, or the device is offline).

- `confirmed` to `failed` (v0.1.123): the registry shows another version again. The version reaches the
  registry at the HTTPS registration, before the broker connection that marks the image valid: an
  image that registers and never confirms is reverted by the bootloader about 10 minutes later.

Any failed device aborts the rollout: later phases are never sent anything. A phase whose devices
all confirmed moves on after `soak_minutes` (default 15 since v0.1.124: the soak sees an image that never
reaches the broker, reverted within 10 minutes of its boot, and a device silent for 10 minutes; nothing
longer is visible to it, a slow leak needs hours) if they all still publish. State lives in
the database only: an API or Pi restart in the middle of a rollout loses nothing (until v0.1.119
the waits were `time.sleep` threads in the API process, which every deployment restarts, and each
phase sent the newest image of the chip instead of the rollout's own image).

## Device side (firmware v2.4.2)

The MQTT task checks the signed manifest and the url, queues the command in a static buffer and
publishes `{"type":"ota_received","version":...}` (recorded in `rollout_devices.acked_at`). The main
loop (`homepi_main`, 32 KB stack reserved at boot) then stops MQTT, downloads, checks and installs.
Nothing is allocated per command. A refusal or failure is published at the next broker connection.
`heap_free`, `heap_min` and `heap_largest` come with every status message and sensor reading.

v2.4.0 and v2.4.1 created an 8 KB task per command without checking the result, and published a
failure 3 s after restarting MQTT, before an mTLS reconnection on the C3 completes. See the
incident below.

## Incident 2026-11-15: a sensor dropped the OTA command, twice, without a report

Rollout 1 (homepi_sensor v2.4.1, 5 devices): the canary and phase 2 confirmed within a minute;
in phase 3, `esp32-819fe250` (bh1750+bme688+sps30+sgp41, the sensor with the least free heap)
stayed on v2.4.0-rc2; the rollout aborted after the 20-minute timeout, as designed. No `ota_failed`.

Evidence, each able to show the other answer:

| Check | Result |
|---|---|
| audit log | no `registration_refreshed` after the command: no reboot |
| nginx access log | no request for the image from that device (the 4 others downloaded 1102656 bytes) |
| InfluxDB `iot_sensors`, 04:45-05:10Z | no telemetry gap and no status message: MQTT was never stopped; the control device `esp32-b26247a4` shows a 58 s gap then `online` |
| serial log, rollout 2 (one device, 30 s after a reboot) | `Command received: ota`, `OTA command: vv2.4.1 ...`, then nothing |
| mosquitto.log | nothing: connections are logged at `notice`, not enabled (enabled in v0.1.121) |

Cause: `xTaskCreate(ota_launch_task, ..., 8192, ...)` failed (no 8 KB block once the MQTT TLS
session is up) and its result was not checked. Not fragmentation: it failed 30 s after a reboot.
The same code is in v2.4.1. Fix: firmware v2.4.2 (above) and the acknowledgment deadline in
`rollout.py` (v0.1.121). That device cannot take an OTA from v2.4.0: it is updated by USB.

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

## Proof results (A5, 2026-11-15): complete

| Rollout | Case | Result |
|---|---|---|
| 1 | homepi_sensor v2.4.1, 5 sensors | canary and phase 2 confirmed in a minute; esp32-819fe250 dropped the command (incident above), aborted at the 20-minute timeout |
| 3 | homepi_sensor v2.4.2, 4 sensors | success, each device confirmed in under 2 minutes |
| (probes) | refusals on esp32-0a171a18 (v2.4.2) | unsigned_command, bad_signature (other key), bad_signature (real signature, manifest edited), wrong_project (LED image), not_newer (v2.4.1): 5/5, no reboot, no ota_received, OtaCommandRefused fired |
| 4, 5 | LED and NILM v2.4.0 to v2.4.2 | success, confirmed within 2 minutes |
| 6 | rollback test image v2.4.3-rc1 to the canary | ota_received 1 s after the command; registered as v2.4.3-rc1 24 s later (download, check, reboot) and marked confirmed; reverted by the bootloader to v2.4.2 10 min after its boot (same certificate); aborted "reverted to v2.4.2 after confirming"; phases 2 and 3 never sent |
| 7 | v2.4.3 with the canary powered off | aborted "no ota_received" exactly 2 min after the command; phases 2 and 3 never sent; plugged back in, the canary stayed on v2.4.2 with no ota_received (the command was not delivered later) |
| 8 | v2.4.3 | canary confirmed in a minute; aborted by the operator to restart with a 15-minute soak |
| 9 | v2.4.3, 4 sensors, soak 15 min | success, including the rc3 to v2.4.3 OTA on esp32-819fe250 |

Heap margin of the five sensors on v2.4.3 (lowest over 15 minutes): heap_min 28.3 to 29.7 KB, largest
block 14.8 to 16.4 KB, homepi_main stack 3.3 KB used of 16. On v2.4.2 the bh1750+bme688+sps30+sgp41
sensor had heap_min 9.5 KB and a largest block of 7 to 8 KB. Not measured yet: the stack used by the
OTA download on homepi_main (the image restarts after a successful download, which resets the
high-water mark) and by the LDevID renewal at boot.

## Proof plan (A5)

Order matters: cases 1 to 4 test the checks of v2.4.1+, so they run once the canary runs signed OTA
firmware (on v2.4.0 an unsigned command would be installed, not refused), and outside a rollout of
that device (any `ota_failed` aborts its rollout).

1. the signed rollout (v2.4.1, 2026-11-15): canary confirmed, soak, phases 2 and 3; one phase-3
   device never updated and the rollout aborted (incident above);
2. unsigned command -> `ota_failed unsigned_command`, device stays on its image;
3. command signed by another key -> `bad_signature`;
4. a signed image of another project -> `wrong_project`;
5. a signed older version -> `not_newer` (`v2.4.2-rc1` once the fleet runs v2.4.2);
6. a command the device never acknowledges (a v2.4.2 sensor powered off when its command is sent)
   -> the rollout fails it after 2 minutes, not 20;
7. a signed rollback test image newer than the fleet (`v2.4.3-rc1`, `tools/ota-sign.sh <tag>
   homepi_sensor --rollback-test`, never connects to the broker) as the canary of a rollout -> the
   bootloader reverts it after 10 minutes, the rollout aborts and phases 2 and 3 are never sent.
