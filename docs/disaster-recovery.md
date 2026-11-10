# Disaster recovery

Goal: rebuild the whole platform (system, services, data, certificates, dashboards, alerts)
on a new Raspberry Pi and a new NVMe drive.

## Targets
- **RTO: 4 hours** from new hardware on the desk to sensors publishing and alerts working.
- **RPO, configuration: 0** (the newest signed release tag is the source of truth).
- **RPO, state and time series: 24 hours** (nightly state backup; InfluxDB export weekly).

## What survives each failure (2026-11-08)
| Failure | What remains | Proof |
|---|---|---|
| NVMe or the whole Pi | Signed repository on GitHub; age-encrypted state and InfluxDB archives in S3 (Object Lock GOVERNANCE 30 days), uploaded nightly by `homepi-offsite` | C2 (v0.1.75): S3 copies byte-identical to the Pi, decrypted, SQLite integrity ok |
| Laptop | GitHub; backups decrypt with the paper key; SOPS secrets decrypt with the Pi key or the paper key | v0.1.67 restore with the paper key; v0.1.75 SOPS decrypt with the paper key |
| Laptop and Pi together | GitHub, S3, the paper key (two paper copies), the root CA escrow (USB copy) | Paper key opens backups, SOPS (since v0.1.75) and the root escrow |
| Paper key copies | The laptop key still opens backups and SOPS | Rotate: new paper key, re-key backups and SOPS |
| Release signing key (laptop) | A new key goes into `allowed_signers` through a commit signed by the old one, or by hand on the Pi | Documented, not drilled |

## Keys
- **Laptop SOPS key** (`~/.config/sops/age/keys.txt`): backup recipient and SOPS recipient.
- **Paper key** (two paper copies, never stored digitally): backup recipient (since v0.1.67), SOPS
  recipient (since v0.1.75), and the only recipient of the root CA escrow.
- **Pi age key** (`/etc/homepi-gitops/age.key`): SOPS recipient so the Pi decrypts its own secrets.
  It is excluded from the backups on purpose: a rebuilt Pi gets a new one.

## Phases
1. **Code and data survive the hardware**: done (phase A; restore from S3 proven, C2).
2. **The whole platform is code**: phase B of `docs/roadmap.md`.
3. **Restoring state is code**: `homepi-restore` puts data and secrets back on a host built by
   Ansible (SQLite databases, step-ca database, Terraform state, InfluxDB export, SSH host keys).
   It never restores `/etc` as a whole (C1).
4. **Game day**: a full rebuild on blank storage with the original NVMe unplugged, timed against
   the RTO, repeated every quarter (C3).

## Manual steps that stay manual
- Writing Ubuntu Server 24.04 arm64 to the new drive and the first SSH login.
- The LUKS passphrase or keyfile of the data volume (see `docs/runbooks/disk-encryption.md`).
- The trust anchors in `/etc/homepi-gitops`: `allowed_signers`, and a **new** Pi age key
  (`age-keygen`), whose public key replaces the old Pi recipient in `.sops.yaml`, followed by
  `sops updatekeys` on every encrypted `*.sops.yaml` from the laptop (or with the paper key) and a
  signed tag.
- Typing the paper key if the laptop key is gone.

## Archive layout (state)
- `sqlite/var/lib/{homepi/devices.db,grafana/grafana.db,authelia/db.sqlite3}`: consistent online
  copies of the SQLite databases.
- `etc-and-state.tar`: `/etc` and the state directories (no root CA key, no Pi age key).
- `opt.tar`: `/opt`.

## Interim emergency procedure (until `homepi-restore` exists)
Rebuild the host with Ansible from the newest signed tag, then restore from the newest state
archive only: the SQLite databases from `sqlite/`, and from `etc-and-state.tar` the paths
`var/lib/secrets`, `var/lib/homepi-terraform`, `etc/step-ca`, `etc/homepi`, `etc/mosquitto`,
`etc/nginx`, `etc/authelia`, `etc/grafana`, `etc/influxdb`, `etc/telegraf`, plus
`etc/homepi-gitops/allowed_signers` (never an old Pi age key: create a new one, see above), then
import the InfluxDB line-protocol export. This list is checked during the first game day (C3).

## Added to the nightly archive (v0.1.87)

- `var/lib/netbird` (WireGuard private key and peer state): restore it to keep the Pi's NetBird
  identity instead of enrolling it again.
- `sqlite-extra/db.sqlite3` (Authelia: TOTP registrations) and `sqlite-extra/grafana.db` (users
  and roles; dashboards and data sources are recreated by Terraform). Both are `.backup` copies.
  Restore with the service stopped, then fix owners (`authelia`, `grafana`).

## InfluxDB: native backup (v0.1.94)

Nightly at 03:50: `influx-native-<date>.tar.age` (about 235 MB), online, with the operator token from
`/var/lib/secrets/influx-operator.token`; off-site under `influx-native/`, 35 days. It holds the
metadata (bolt: buckets, tasks, authorizations) and the shards: `influx restore --full` brings every
token back, so Telegraf, Grafana, the dashboard and the backups keep working without a SOPS change.
Data RPO goes from 7 days (weekly line-protocol export, Sunday 04:15, kept as the portable fallback)
to 24 hours.
