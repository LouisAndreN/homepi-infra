# Runbook: PKI (step-ca) and MQTT broker

## State measured 2026-11-08

- step-ca 0.30.2 on 127.0.0.1:8443, running as root. BadgerDB in `/etc/step-ca/db`, copied hourly by
  `homepi-backup-state` (age-encrypted, step-ca stopped during the copy).
- Provisioners: JWK `admin` (issued the broker and Nginx certificates, no name policy), X5C
  `idevid-x5c` (device certificates, 1 year, no template), JWK `aws-edge` (the `homepi-backup`
  certificate for IAM Roles Anywhere, 7 days, its own password file).
- IAM Roles Anywhere trusts the intermediate; the role trust policy requires CN `homepi-backup`.
- mosquitto 2.0.18: 8883 on 192.168.200.1 (mTLS, certificate CN as user name, `devices.acl`), 1883 on
  127.0.0.1 (password file, Telegraf).

## Known flaws (open)

1. Revocation is not enforced: the broker has no `crlfile` (B3.2b). Since v0.1.53 the CRL itself is
   kept fresh and monitored (see "CRL sync"); the cron `crl_sync.sh` it replaces had failed since
   2026-05-23 (it verified a CRL signed by the intermediate against the root alone) and nothing alerted.
   `revoked.acl` is not referenced and its syntax is invalid.
2. One password opens the root key, the intermediate key and probably the `admin` provisioner. Until
   2026-11-08 it was readable by the group `iot-platform` (member: `srvpi`).
3. The root CA key is online, and is in the age-encrypted backups (Object Lock keeps those copies until
   their retention ends).
4. The root partition (`nvme0n1p2`) is not encrypted. `/etc` holds every CA key and its password, the
   broker and Nginx keys, the age key and the key file that unlocks `cryptdata`: a removed disk exposes
   everything, including the LUKS volumes.
5. A provisioner without a name policy can issue CN `homepi-backup`, which the AWS trust policy accepts.
   Whether the X5C default template lets a device choose its name is to be tested.

## Containment done by hand on 2026-11-08

- `/etc/step-ca/password.txt`: 0640 root:iot-platform to 0600 root:root; step-ca restarted healthy.
  Pinned by the `pki` role.
- `/etc/mosquitto/conf.d/99-debug.conf` (`log_type all`) moved to `/root/homepi-removed/`; the broker
  log volume dropped about 8 times.

## Model

The `pki` role (B3.1) verifies the public files byte for byte, the secret and renewed files by presence,
owner and mode (content never read), `ca.json` by sha256, and the services. It never writes.

## Plan

- B3.2: CRL pipeline as a systemd timer (full-chain verification, atomic install, metric and alert on
  CRL age), then `crlfile` on 8883, proven with a revoked canary certificate from the Pi itself.
- B3.3: separate passwords (intermediate, `admin`); a name policy on `admin`; an X5C template that binds
  the subject to the IDevID subject.
- B3.4: root key offline (decision pending).
- Root partition encryption: phase C (rebuild on the spare SSD).
- v1.1: short certificate lifetimes instead of twice-daily `--force` renewals of 1-year certificates;
  the stale `broker.crt`; `homepi-api` write access to `iot/#`; `enableSSHCA` on `aws-edge`; the three
  `ca.json.bak` files; step-ca as a dedicated user.

## CRL sync (B3.2a, v0.1.53)

`homepi-crl-sync` (timer: 1 minute after boot, then every 15 minutes) fetches the CRL from step-ca and
installs it in `/etc/mosquitto/crl/crl.pem` only if it verifies against the full chain, is issued by the
intermediate, stays valid for at least another hour and is not older than the installed one; otherwise
the last valid CRL stays and the run fails. Metrics `homepi_crl_*` (textfile collector). Alerts:
`CrlSyncFailing`, `CrlSyncStale`, `CrlExpiresSoon` (critical below 6 hours). The CRL is valid for 24 hours,
so a step-ca outage of about 23 hours is tolerated once the broker enforces it. Manual run:

    sudo systemctl start homepi-crl-sync; journalctl -u homepi-crl-sync -n 20

`/opt/homepi/crl_sync.sh` is no longer scheduled; it is removed with the B7 cleanup (`homepi-triage`
still refers to it).
