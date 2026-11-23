# Known limits (v1)

Each entry states what was observed, where, and what is still unknown.
Last updated: 2026-11-15 (fleet on firmware v2.4.0, revocation enforced).

## Security
- **Device registration (v0.1.114, v0.1.118).** `x5c-enrolled` requires the device's LDevID as TLS client certificate (verified by nginx, CN equal to the device id); fingerprint and expiry are read from that certificate. The registry decides: pre-announced or operator-approved devices become active, unknown devices are recorded `pending` (alert `DevicePendingApproval`, no MQTT rights), suspended devices stay refused. Since v0.1.118 a revoked certificate and a certificate older than the registered one are refused. `pre_announced` devices keep MQTT rights on purpose: the ACL is rendered every 60 s, and a new device that registers then connects would otherwise lose its first subscription.
- **Revocation (v0.1.117).** The broker enforces the CRL (re-signed without the step-ca IDP, docs/runbooks/pki.md). A revocation does not close an open session and reaches the broker within about 75 minutes unless step-ca is restarted. nginx does not check the CRL (its check needs a root-signed CRL); the registration API checks the leaf itself. 242 certificates left over by the v2.3.x re-enrollments were revoked on 2026-11-15; those of the NILM bridge (esp32-690be854, about 50) are still valid until it registers from v2.4.0 for long enough to revoke them.
- **No CA secret in the API** since v0.1.60 (`test_no_ca_secret.py`); `master.key` and `ca_password` left the Pi in v0.1.83. Both API instances run as the same user with the same MQTT account, limited since v0.1.112 to writing commands and alerts and reading telemetry.
- **Device firmware (2026-11-15).** The five sensors run v2.4.3, the LED and the NILM bridge v2.4.2, all by signed OTA (one USB flash: esp32-819fe250, whose v2.4.0 could not start the OTA task). No re-enrollment on disconnect, renewal at boot, rollback proven, heap and stack in the telemetry. Still open: the NILM application is in development; a sensor lost at run time is only noticed at the next boot; no alert yet on the device heap margin (the fields are in InfluxDB, not Prometheus).
- **Power supply (2026-11-15).** The kernel reports under-voltage under load (7 events in 16 hours, then 9 in 20 minutes after the cable was touched and the Pi reset). Measured and alerted since v0.1.122 (docs/runbooks/power.md); the fix is hardware (official 27 W supply, cable). Until then every under-voltage event can corrupt a write in progress, and a reset drops every device and aborts a rollout.
- **CA keys on an unencrypted partition.** The step-ca keys and password file live under `/etc/step-ca`, on the unencrypted root filesystem. Planned fix: move them to the LUKS volume or rotate the CA.
- **Laptop disk encryption not verified.** The Manufacturer CA key and `master.key` sit unencrypted in WSL; the BitLocker status was not checked.
- **Passwordless sudo for the deployment account.** `srvpi` runs sudo without a password, so whoever holds its SSH key is root on the Pi; the only barrier is the key passphrase. Not addressed in v1.
- **Secrets in a public repository.** SOPS-encrypted values are committed with their history; if an age key ever leaks, every secret in that history must be rotated.
- **Scrape password duplicated.** The Grafana metrics password is stored in the SOPS file and, until Grafana is managed by this repository, also in Grafana's own configuration (not yet checked); both must be changed together. The Alertmanager webhooks are not under SOPS yet.
- **Tokens in old logs.** step-ca logs each request's one-time token; Alloy masks it from v0.1.119, but Loki still holds the earlier ones until retention removes them (they expired 5 minutes after issue).
- **OTA authenticity from firmware v2.4.1 (v0.1.120).** Images are accepted only with a manifest signed by the OTA key, which stays on the operator's laptop (docs/runbooks/ota.md); the device checks signature, project, chip, newer version and image hash before marking it bootable. Limits: no secure boot (an attacker with physical access can flash anything over USB, a decision kept to avoid irreversible eFuses); no device runs v2.4.0 (which checked only the hash) since 2026-11-15, and the unsigned images v2.1.0 and v2.3.2 that were still served under /fw/esp32c3/ are removed by the `ota_rollout` role (2026-11-23), along with `scripts/deploy_firmware.sh`, which copied an unsigned build there; a lost or leaked signing key needs a new image signed by the old key, or a USB reflash.

## Reliability
- **Enrollment storms (fixed by firmware v2.4.0).** Up to v2.3.2, three MQTT disconnects re-enrolled the device: 92 enrollments for 7 devices on 2026-10-14, 291 certificates issued between 2026-10-28 and 2026-11-15. Alert `DeviceEnrollmentBurst` stays.
- **Spurious auto-OTA** (264 commands, 252 to devices already on that version): version comparison fixed in e07dde1, and the automatic OTA after enrollment removed in v0.1.114.
- **Staged rollout (v0.1.120 to v0.1.124).** A state machine in the database moved by `homepi-ota-rollout.timer`. Proven on 2026-11-15 on real hardware (docs/runbooks/ota.md, A5: 9 rollouts, the five refusal cases, the bootloader rollback, the acknowledgment deadline, an abort that spares the next phases). Limits: the devices of one phase receive their command in the same minute, so an abort spares only the later phases; firmware before v2.4.2 sends no acknowledgment; the soak (15 min) cannot see a slow leak; the OTA download's stack use on homepi_main is not measured yet.
- **Collection gap of about 39 hours** around 2026-09-26 for all devices. The services were active and the Wi-Fi interface carried traffic; the journals were already purged; cause undetermined. Since v0.1.113 `DeviceSilent` fires after 10 minutes without telemetry (every device since v0.1.119); a retained message no longer counts as telemetry (v0.1.116).
- **Timestamps.** Before commit 76a1469, `datetime('now','utc')` stored UTC minus 9 hours on a JST host. Existing rows are not migrated.
- **Reproducible builds.** Since v2.4.0 every image is built by `tools/usb-flash.sh` from a signed tag in a clean worktree (the two `v2.3.2-dirty` devices are gone).

## Operations
- **Firewall.** `nftables.conf` starts with `flush ruleset`; `netfilter-persistent` loads a separate iptables file holding the IoT NAT rule and the Docker chains; systemd does not order the two services (nftables started 10 s before netfilter-persistent on the last boot). Restarting nftables by hand removes the NAT table until netfilter-persistent reloads. Untested; to verify on the rebuild Pi.
- **Journal retention.** The journal was volatile (no `/var/log/journal`): it held about 22 hours of logs and lost them all at each reboot. Fixed by the `common` role (persistent storage, 2 GB, one month); the real daily volume is still to be measured over several days.
- **No approval gate between a tag and production.** The Pi applies the newest tag signed by a key in `allowed_signers` within about ten minutes; the signature is the approval, and the recovery from a bad release is a newer signed tag.
- **Drift is detected, not repaired.** The hourly simulation measures it and an alert fires after two hours; the apply run only replays the playbook when the tag changes.
- **The Pi can decrypt every secret in the repository.** Its age key sits in `/etc/homepi-gitops`, outside `/etc/homepi`, readable by root only; whoever controls the Pi reads the secrets, but cannot sign a release.
- **The signing key and the repository feed are on the laptop.** The Pi pulls from a bare repository on itself, fed from the laptop; the signature, not the storage, is the trust. The signing key is protected by a passphrase only.
- **The reconciler virtualenv pins ansible-core and one collection, not their dependencies.** A requirements file with hashes is planned. On a failed run the metric file keeps only the success flag and a timestamp.
- **The Terraform service account token never expires.** It has the Admin role in the main organisation, is kept SOPS-encrypted, and was created through the Grafana API with the administrator account. Rotating it is a manual step.
- **Terraform and the Grafana provider are pinned, not signature-checked.** The Terraform archive is verified against the checksum published on the same site; the PGP signature of that checksum file is not verified. The provider lock file records hashes for linux_arm64 and linux_amd64 only.
- **Data source secrets are not in the code.** Terraform manages the settings of the Grafana data sources, not their stored credentials (the InfluxDB token). The Grafana `secret_key` that encrypts them lives in `grafana.ini`, which is not managed yet.
- **A signature proves who published a release, not that it was intended.** On 2026-10-28, v0.1.13 was signed and pushed by mistake: a rollback command written for a failed test was run although the test had passed. v0.1.14 superseded it three minutes later, before a timer run reached it; no tag was deleted.
- **The destroy guard counts, it does not judge.** It refuses a plan that deletes or replaces anything unless the signed tag message contains `[allow-destroy]`. Tested on real objects: v0.1.7 was refused twice (by hand and by the timer), v0.1.8, the same commit with the marker, was applied, v0.1.9 restored the objects.
- **Grafana dashboards made in the UI are drift.** The three hand-made dashboards were imported as code; their earlier history (83, 311 and 240 UI versions) exists only in the state backups. An edit made in the UI now triggers the drift alert and is reverted by the next release.
- **A Terraform update resets the version counter of a Grafana data source to 1.** The `updated` column, not `version`, shows when a data source was written.
- **Rebuild reproduces configuration, not state.** Restoring state is an explicit step.
- **Terraform state is local** on the Pi (S3 backend planned for v1.2).

## Added after the 2026-11-01 incident

See `docs/incidents/2026-11-01-var-inode-exhaustion.md`.

- **Single alerting path on the Pi.** Alertmanager, its DNS (NetBird then Unbound) and its only
  channel (Slack) all depend on the Pi being healthy. A degraded Pi cannot report itself. Fix
  planned: CloudWatch heartbeat with SNS e-mail.
- **Loki uses the filesystem store on `/var` (ext4).** Empty stream directories are removed daily by
  `homepi-loki-housekeeping`, a workaround, not a fix. Fix planned: dedicated XFS volume.
- **Not managed by the repo yet:** Nginx, Authelia, CrowdSec (its whitelist parser is locally
  modified, "tainted"), Loki, Unbound, NetBird DNS settings. The Pi cannot be fully rebuilt from Git.
- **InfluxDB downsampling task**: the live script is `ansible/roles/influxdb/files/tasks/downsample_iot_hot_to_archives.flux`, compared with InfluxDB (Flux text included) by `homepi-influx-check` on every apply and check, and kept with every token by the nightly native backup (v0.1.94). `/etc/influxdb/tasks/downsample_iot.flux` on the Pi is stale and unused.
- **No GeoIP on nftables drops** (removed in v0.1.109). Measured over 24 h behind the home router:
  0 public IPv4 source among the dropped inbound packets (all LAN broadcast, multicast and NetBIOS).
  It comes back only if a port is ever exposed to the Internet.
- **Prometheus restarts on a rule change** (handler in `monitoring_binaries`) instead of reloading:
  pending alerts restart their `for:` delay.
- **Dashboard web manifest** was fixed by hand on the Pi (icon paths). The next dashboard deployment
  overwrites it unless `public/site.webmanifest` is fixed in the dashboard source.
- **The `homepi` short name** is accepted by Nginx over HTTPS but covered neither by the certificate
  nor by Authelia's cookie domain. Only `homepi.internal` works; the short name must be redirected
  or removed in the Nginx role.
- **auditd volume** is about 39 lines per second, mostly socket records to `/dev/log`.
- **Off-site failure metric after a manual failed run**: `homepi_offsite_upload_success` stays at 0 until the next real upload, because a run that finds the newest archive already uploaded does not rewrite it. Never happens in normal operation (a failure leaves the archive unmarked, so the next hour retries). Clear it by removing the newest `.offsite` marker and starting `homepi-offsite.service`.
- **Alert links point to http://homepi:9093**: a short name without DNS, a closed port and plain HTTP, so the link in a Slack message opens neither from a phone nor outside NetBird. Fix with the Nginx role (B6): Alertmanager behind https://homepi.internal with its external URL set accordingly.
- **Roles Anywhere notification thresholds are set outside Terraform**: provider aws 6.71.0 accepts notification_settings on aws_rolesanywhere_trust_anchor, but with a 1-day threshold in the code the plan showed no change while AWS kept 45 days (state recorded: CA_CERTIFICATE_EXPIRY=45, END_ENTITY_CERTIFICATE_EXPIRY=45). A configuration that silently differs from reality is worse than none, so the block was removed. Set once on 2026-11-07 with aws rolesanywhere put-notification-settings: end-entity expiry 1 day (the 7-day aws-edge certificate is renewed at 72 h, so it fires only when renewal failed), CA expiry 45 days. A recreated trust anchor gets the 45-day defaults back until this is reapplied.

## Added after the 2026-11-07 storage and reboot work

- LUKS keyfile: `cryptdata` is opened at boot with `/boot/luks-keyfile`, stored on the unencrypted
  root of the same NVMe. Encryption protects a decommissioned disk, not a stolen Pi. Serious
  alternative: network-bound disk encryption (Clevis with a Tang server on another host), or a
  passphrase over SSH in the initramfs.
- Release gate (fixed in v0.1.46): v0.1.35 passed the laptop gate and failed on the Pi. Both
  runtimes now install `ansible/requirements.*`, and every release is checked by `homepi-precheck`
  with the Pi's own runtime before signing. Python still differs (3.14 on the laptop, 3.12 on the
  Pi): the precheck is the safeguard.
- Drift detection is hourly: the check timer runs the deployed tag in check mode. `GitopsDrift`
  fires on changed tasks; a failed check run (how the storage role reports drift) raised no alert
  until `GitopsCheckFailing` (v0.1.43). A drift stays unseen up to about an hour.
- unattended-upgrades can rewrite the boot chain (2026-11-06: initramfs rebuilt by a firmware
  package). Since v0.1.44 `BootChainUntested` reports it within about 1.5 hours; the reboot stays
  manual (`scripts/homepi-controlled-reboot`, docs/runbooks/reboot.md).
- Loki (fixed in v0.1.42): it ran the memberlist kvstore for a single node and listened on `*:7946`
  on every interface. With the `inmemory` kvstore nothing listens on 7946 and `/ready` answers 200
  18 s after a restart (it took 3 to 4 minutes after boot with memberlist).
- Mosquitto loads `conf.d/99-debug.conf` in production (client identifiers and noise in the logs).
- Logs are written three times: journal (1.2G), rsyslog (rotated weekly, about 500M) and Loki.
  Loki itself produces 56% of the syslog lines, including every query it serves (until v0.1.109 a
  query containing NFT-DROP was counted as a drop); `NFT-DROP-INPUT` is logged without a rate limit
  (about 81,000 kernel lines in 6.5 days).
- Device liveness (v0.1.113): `DeviceSilent` fires after 10 minutes without telemetry, from the registry's
  `last_seen` (scraped every minute). The LED controller publishes only on (re)connection and is excluded
  until its firmware sends a periodic heartbeat.
- Btrfs applies `compress` per filesystem: the archives subvolume gets zstd:3 like the others.

## SOPS history encrypted to a lost recipient (recorded 2026-11-08, v0.1.75)

Until v0.1.74 every encrypted `*.sops.yaml` was also encrypted to `age1f0lez…`, a recovery key whose
private part cannot be located; v0.1.75 replaced it by the paper key without changing any value. The
older versions stay in the Git history (10 commits). Once the repository is public, whoever holds
that key can read the values committed then, which are still the current ones. Before publication:
rotate those secrets (Grafana service account token, InfluxDB tokens, step-ca admin password,
Prometheus scrape password, Alertmanager webhooks, AWS and network secrets) or accept the risk
explicitly.

## Former master.key on the Pi

`/etc/homepi/master.key` was displayed in a session on 2026-11-08 and is treated as
compromised. No code referenced it since v0.1.60. v0.1.83 moved it, with the unused
`/etc/homepi/step-ca/ca_password`, to `/root/homepi-removed/provisioning_api/` and keeps both
paths absent. Nightly archives taken before v0.1.83 contain it until their S3 retention
expires (Object Lock GOVERNANCE, 30 days). Destruction of the archived copy is pending.

## pironman5 runs as root

The SunFounder case controller (`/usr/local/bin/pironman5`, pip-installed, venv in
`/opt/pironman5`) runs as root with no `User=`: third-party code with full privileges. Its
files are pinned by the hardening role; running it unprivileged (GPIO and I2C groups) is not
done yet.
