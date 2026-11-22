# Disaster recovery

Goal: rebuild the whole platform (system, services, data, certificates, dashboards, alerts)
on a new Raspberry Pi and a new NVMe drive.

## Targets
- **RTO: 4 hours** from new hardware on the desk to sensors publishing and alerts working.
- **RPO, configuration: 0** (the newest signed release tag is the source of truth).
- **RPO, sensor data (`iot-hot`, `iot-archives`): 1 hour** (hourly delta since C4, below).
- **RPO, state: 24 hours** (nightly state backup: registry, PKI, Authelia, Grafana, CrowdSec).
- Not backed up at all: Prometheus metrics and Loki logs (table below).

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

## InfluxDB: hourly sensor delta (C4)

Hourly at :07: `influx-delta-<stamp>.tar.age` (`homepi-backup-influx-delta`), about 0.7 MB for an
hour (11.5 MB as CSV, 60 000 points: NILM at 15 points/s, the environment sensors). It holds
`iot-hot` from 5 min before the end of the last successful delta (65 min on a normal run; after
missed runs, back to the last success, 26 h at most) and `iot-archives` from 2 h earlier still, as
gzipped line protocol, plus a manifest (window, point counts). 48 kept on the Pi; every delta goes
off-site under `influx-delta/` (35 days), oldest first, the first failure stopping the run so the
next one retries in order.

Restore: R0 downloads every delta newer than the native backup, R5 replays them oldest first after
`influx restore --full` (`homepi-r5-deltas`). A point is a series and a timestamp, so overlaps and
replays overwrite instead of duplicating; the replay checks that InfluxDB then holds at least the
delta's points in its window.

Rejected: a native backup every hour. 250 MB × 24 a day, each copy locked 30 days and replicated to the
vault, is about 360 GB stored and 6 GB a day uploaded, for data that grows by a few MB an hour.
Rejected too: a shorter Object Lock for an hourly prefix: it needs `s3:PutObjectRetention` for the
Pi's role, and a compromised Pi could then shorten the lock of its own backups.

What the delta does not cover: points that never reached InfluxDB. Since C4 messages in flight when
Telegraf stops are delivered again, but what is published while Telegraf is away while the broker runs
is lost (mosquitto 2.0.18 with per_listener_settings queues nothing for offline clients; in practice a
one-second restart on configuration changes; docs/runbooks/telegraf.md).

## Added to the nightly archive (C1, 2026-11-15)

- `sqlite-extra/crowdsec.db`: the local API machine and nftables bouncer registrations. Without it,
  the restored `/etc/crowdsec` credentials match nothing and the bouncer stops blocking. Restore
  with crowdsec and the bouncer stopped.
- `home/srvpi/.ssh/authorized_keys` (inside `etc-and-state.tar`): the operator's public keys, so a
  rebuilt Pi accepts the laptop without typing a key by hand.

## Deliberately not backed up (measured 2026-11-15)

| Path | Size | Consequence of a rebuild |
|---|---|---|
| `/var/lib/prometheus` | 6.3 G | metrics history lost; alerts restart from zero |
| `/var/lib/loki` | 333 M | logs lost, audit events included: security evidence before the rebuild is gone |
| `/var/lib/mosquitto` | 8 K | retained messages lost (retained OTA commands included: wanted) |
| `/var/lib/alertmanager` | 8 K | silences lost |
| `/var/lib/docker` | 70 M | unused (docker and containerd disabled): not reinstalled |
| six empty volumes | 0 | `lv-containers`, `lv-ml-models`, `lv-ml-cache`, `lv-cloud-sync`, Btrfs `@personal`, `@archives`: recreated empty by the layout |
