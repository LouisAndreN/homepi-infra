# Known limits (v1)

Each entry states what was observed, where, and what is still unknown.
Last updated: 2026-10-27.

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
- **Rebuild reproduces configuration, not state.** Restoring state is an explicit step.
- **Terraform state is local** on the Pi (S3 backend planned for v1.2).
