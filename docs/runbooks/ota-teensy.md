# Runbook: remote update and restart of the NILM Teensy (v1.5.0)

## Chain

| Piece | Where | Role |
|---|---|---|
| Teensy program | homepi-nilm (private), `teensy/teensy_nilm_phase2_vX_Y/` | Arduino IDE, Sketch > Export Compiled Binary (`.hex`) |
| Signing | `tools/teensy-sign.sh <hex> vX.Y.0` (homepi-firmware, laptop) | `.hex` to image, refuses an image without `fw_teensy40`, the remote-update marker or `HOMEPI_TEENSY_FW=vX.Y.0`; manifest signed with the OTA key |
| Catalog | `POST /api/admin/firmware/upload` (same as the ESP32 images) | `chip_target` must be `teensy40` for `homepi_nilm_teensy`, an ESP32 chip for the others |
| Rollout | `POST /api/admin/rollouts {"project":"homepi_nilm_teensy", ...}` | targets the active `homepi_nilm` devices; refused if one runs a bridge older than v2.6.0 |
| Bridge | homepi_nilm v2.6.0+, `teensy_ota.c` | checks the signature, downloads, streams, sends COMMIT only after the SHA-256 matched; reports `teensy_ota_received` / `teensy_ota_done` / `teensy_ota_failed` |
| Teensy | v3.1+ (`fx_receiver.h`) | writes into the free flash, replaces its program only after size, crc32, target, marker and COMMIT; else erases and restarts unchanged |

Confirmation: `devices.teensy_fw` (from `fw_teensy` in the NILM data) shows the new version. Failure
reports go to `ota_events` with the reason prefixed `teensy_` and abort the rollout like an ESP32 one.
There is no hardware rollback on the Teensy: an image that crashes before reading Serial1 needs USB.

## Restart

    ssh -t homepi 'sudo curl -s --unix-socket /run/homepi-api/admin.sock -X POST \
      http://localhost/api/admin/devices/<id>/teensy-reboot; echo'

Bridge v2.6.0+ and Teensy v3.3+. The audit log gets `teensy_reboot_done` (version, `down_ms`) or
`teensy_reboot_failed`; the timeline shows the gap as a `teensy_update` event with ref `reboot`.

## CT1 fault (Teensy v3.3+)

The bad start of 2026-11-28 (CT1 noise: I1_n ~0.5 at THD 50-106 % for two hours, cured by a restart)
is detected on the Teensy: 70 % of the cycles of a second with I1_n > 0.15 and THD > 40 %, two minutes
in a row. It then restarts itself, at most three times in a row, and raises its flag.
`/metrics/homepi`: `homepi_nilm_teensy_ct1_fault`, `homepi_nilm_teensy_gave_up`,
`homepi_nilm_teensy_self_restarts` (alert rules: next release).

## Upload command (corrected quoting)

`-F manifest=<file` inside `ssh '...'` is a redirection for the remote shell: the field arrives empty
("manifest: Field required"). Quote the form fields:

    ssh -t homepi 'sudo curl -s --unix-socket /run/homepi-api/admin.sock -F file=@/tmp/ota/image.bin \
      -F "manifest=</tmp/ota/manifest.json" -F "signature=</tmp/ota/manifest.sig" \
      http://localhost/api/admin/firmware/upload; echo'
