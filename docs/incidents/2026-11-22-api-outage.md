# Incident 2026-11-22/23: provisioning API down for about 9 hours after a security upgrade

## Summary

Release v0.1.145 upgraded the packages of the provisioning API (cryptography, starlette,
python-multipart, anyio) and made the `provisioning_api` role rebuild the API virtualenv when it
differs from `requirements.lock`. On production the rebuild produced a virtualenv the API user could
not read; the rollback restored the old one, but GitOps retried the tag every 10 minutes, and during
the night the database side files the API needs disappeared. The API stayed down from 22:32 until it
was restored by hand the next morning. Prometheus detected it after 12 minutes and Slack received
the notifications; nobody acted before the morning.

Impact: device provisioning, OTA rollouts, the dashboard admin API and the MQTT ACL sync (from 03:51)
were unavailable. Telemetry was not affected: the ESP32s publish over MQTT, which does not go through
the API (7 of 7 connected throughout). No data was lost.

## Timeline (JST, from the journal, Prometheus and Alertmanager)

| Time | Event |
|---|---|
| 11-22 22:27:26 | GitOps starts applying v0.1.145 |
| 22:32:51 | The rebuilt virtualenv is 0700 root: `Failed to execute /opt/homepi/api-venv/bin/uvicorn: Permission denied`. Health check fails, the rescue puts the previous virtualenv back and the apply fails |
| 22:44 | `DevicesMetricsMissing` fires (the device metrics behind nginx on 127.0.0.1:3001 are gone) |
| 22:49 | `SystemdUnitFailed` fires |
| 23:06 | `GitopsApplyFailing` fires. v0.1.145 is retried every 10 minutes, each time stopping the API |
| 11-23 03:44:32 | The nightly state backup reads `devices.db` with sqlite3 as root. With the API down nothing else holds the database; afterwards `devices.db-wal` and `devices.db-shm` no longer exist |
| 03:51 | `MqttAclSyncFailing` fires: the ACL sync cannot read the registry either |
| 06:31 | The precheck of v0.1.146 (umask fix) fails: the read-only schema check gets "attempt to write a readonly database" |
| 06:33 | The API, back on its old virtualenv, fails at startup with the same error |
| morning | The apply timer is stopped (no more retries); the side files are recreated by hand as the role creates them (empty, `homepi-api`, 0644; journal tag `homepi-ops`) and the API answers again |
| by 07:54 | v0.1.146 (umask 022, side files first) applied by hand, apply timer back on; R6 PASS |

Slack received 79 notifications during the night (0 failed). Detection worked; response did not.

## Causes

1. **The rebuild ran under the umask of GitOps.** `homepi-gitops-sync` sets `umask 077`; the shell that
   created the virtualenv did not reset it, so every file was 0700/0600 root. The role had never run
   the rebuild path under GitOps before production.
2. **The side files were created after the rebuild.** The API user cannot create `devices.db-wal` and
   `-shm` (the directory belongs to root, C3 defect 31); the task that creates them ran after the
   block that restarts the API, so a rebuild or a rollback could not bring it back once they were gone.
3. **A failing tag is retried every 10 minutes.** Each attempt stopped the API for its rebuild; the
   API was never up long enough to keep the database open.
4. **No rule watched the API itself.** The outage was visible only through its effects. The rule meant
   for crash loops, `SystemdServiceRestartLoop`, had never worked: node_exporter did not export
   restart counters (`--collector.systemd.enable-restarts-metrics` missing).

The changes were written with Claude (AI), and both defects in the role came from that code: the rebuild
was tested in a local virtualenv and through the check-mode precheck, never under the GitOps umask
with the API stopped.

## What went well

- The rollback restored a working virtualenv every time; production never ran a half-built one.
- The precheck refused v0.1.146 while the side files were missing instead of deploying blind.
- Alerts fired within 12 minutes and were delivered.

## Actions

| Action | State |
|---|---|
| Virtualenv built under `umask 022`; the API user must import its packages before the services start | done, v0.1.146 |
| Side files created before any rebuild or restart | done, v0.1.146 |
| `HomepiApiDown`: either API unit not active for 5 minutes, severity critical (promtool test `api_test.yml`) | this change |
| node_exporter exports restart counters, so `SystemdServiceRestartLoop` can fire | this change |
| Runbook: when an apply fails with a cost (here an outage per attempt), stop the apply timer, wait for the rescue, release the fix, start the apply and the timer | this change |
| Test the role's rebuild path under `umask 077` with the API stopped before it reaches production | open |
| Decide who or what acts on a critical alert at night (a phone push for `critical`, or accept morning response for a home platform) | open |
