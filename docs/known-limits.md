# Known limits (v1)

Each entry states what was observed, where, and what is still unknown.
Last updated: 2026-10-28.

## Security
- **Unauthenticated device routes.** `POST /api/devices/x5c-enrolled` and `POST /api/devices/{id}/renew` accept requests from the whole IoT VLAN without authenticating the caller (source review). They answer 403 by default since commit bf3d15a and are blocked in nginx on the production host. Planned fix: client certificate on the notification call (firmware change).
- **Secrets in the device-facing process.** `provisioning_api.py` reads the HMAC master key and the step-ca provisioner password at import. Both API processes (ports 8090 and 8091) run the same code as the same user, so the process reachable from the IoT VLAN holds them (file modes checked: both files are 0640 root:homepi-api and the API runs as homepi-api). Planned fix: split by role, separate users.
- **CA keys on an unencrypted partition.** The step-ca keys and password file live under `/etc/step-ca`, on the unencrypted root filesystem. Planned fix: move them to the LUKS volume or rotate the CA.
- **Laptop disk encryption not verified.** The Manufacturer CA key and `master.key` sit unencrypted in WSL; the BitLocker status was not checked.
- **Passwordless sudo for the deployment account.** `srvpi` runs sudo without a password, so whoever holds its SSH key is root on the Pi; the only barrier is the key passphrase. Not addressed in v1.
- **Secrets in a public repository.** SOPS-encrypted values are committed with their history; if an age key ever leaks, every secret in that history must be rotated.
- **Scrape password duplicated.** The Grafana metrics password is stored in the SOPS file and, until Grafana is managed by this repository, also in Grafana's own configuration (not yet checked); both must be changed together. The Alertmanager webhooks are not under SOPS yet.
- **OTA integrity, not authenticity.** The OTA hash comes from the same API that serves the file; there is no firmware signature and no secure boot.

## Reliability
- **Enrollment storms.** After a Pi reboot every device re-enrolls (92 enrollments for 7 devices on 2026-10-14; 1327 enrollment events since June). Cause from the firmware source, not reproduced: three MQTT disconnects clear the enrolled flag. Each enrollment issues a one-year certificate that is never revoked. Planned fix: firmware change.
- **Spurious auto-OTA.** 264 auto-OTA commands were logged: 252 to devices already on that version (`v2.3.2` reported, `2.3.2` in the catalog) and 2 ordering a downgrade to 2.1.0 (latest firmware was picked by upload date). Fixed in commit e07dde1; production runs the old code until the Ansible role deploys it.
- **Staged rollout never confirmed.** Three deployments of 2.1.0 (June to July) were all aborted; the confirmation path has not run on real hardware.
- **Collection gap of about 39 hours** around 2026-09-26 for all devices. The services were active and the Wi-Fi interface carried traffic; the journals were already purged; cause undetermined. No alert fires when no data arrives.
- **Timestamps.** Before commit 76a1469, `datetime('now','utc')` stored UTC minus 9 hours on a JST host. Existing rows are not migrated.
- **Two devices run a non-reproducible build** (`v2.3.2-dirty`); 75 OTA commands did not change that (cause unknown).

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
- **InfluxDB downsampling task** is exported from `/tmp/downsample.flux`, which does not survive a
  reboot, so it is missing from every InfluxDB export. Fix planned with the InfluxDB role.
- **GeoIP on nftables drops** is extracted by Alloy but never stored (structured metadata is disabled
  in Loki and the fields are not labels). It currently does nothing.
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
