# Disaster recovery

Goal: rebuild the whole platform (system, services, data, certificates, dashboards, alerts)
on a new Raspberry Pi and a new NVMe drive.

## Targets
- **RTO: 4 hours** from new hardware on the desk to sensors publishing and alerts working.
- **RPO, configuration: 0** (the newest signed release tag is the source of truth).
- **RPO, state and time series: 24 hours** (nightly backups).

## What survives each failure (2026-10-28)
| Failure | Lost today | Fixed by |
|---|---|---|
| NVMe | every backup kept on the Pi; last manual copies are 2026-10-28 (state) and 2026-10-20 (InfluxDB) | off-site copy (phase 1) |
| Pi board | the Wi-Fi interface name `wlx0013eff27090` changes with a new USB adapter | stable interface name (phase 2) |
| Laptop | the release signing key | documented key replacement in `allowed_signers` |
| Pi and laptop | the repository (laptop and the Pi bare repository only) | hosted remote (phase 1) |

## Phases
1. **Code and data survive the hardware**: hosted repository remote; automatic off-site copy of the
   age-encrypted backups to object storage that the Pi can write but not read or delete; daily
   InfluxDB export; a restore test from the off-site copy.
2. **The whole platform is code**: storage bootstrap, network (stable interface name, one firewall
   loader, hostapd, DNS, DHCP), PKI (step-ca, Mosquitto), InfluxDB, Telegraf, Grafana, Nginx,
   Authelia, CrowdSec, NetBird, the provisioning API and the dashboard. Each role is first taken over
   as found (check mode reports no change), then changed in its own commits.
3. **Restoring state is code**: `homepi-restore` puts data and secrets back on a host built by
   Ansible (SQLite databases, step-ca database, Terraform state, InfluxDB export, SSH host keys).
   It never restores `/etc` as a whole.
4. **Game day**: a full rebuild on blank storage with the original NVMe unplugged, timed against
   the RTO, repeated every quarter.

## Manual steps that stay manual
- Writing Ubuntu Server 24.04 arm64 to the new drive and the first SSH login.
- The LUKS passphrase of the data volume.
- The two trust anchors in `/etc/homepi-gitops`: the Pi's age key and `allowed_signers`.
- Plugging in the USB key that holds the recovery key, if the laptop key is gone.

## Interim emergency procedure (until phase 3 exists)
Restore from the newest state archive only these paths, then rerun the playbook:
`var/lib/homepi`, `var/lib/secrets`, `var/lib/homepi-terraform`, `etc/step-ca`, `etc/homepi`,
`etc/homepi-gitops`, `etc/mosquitto`, `etc/nginx`, `etc/authelia`, `etc/grafana`, `etc/influxdb`,
`etc/telegraf`, the SQLite databases shipped next to them, and the InfluxDB line-protocol export.
This list is checked during the first game day; until then it is a best effort.
