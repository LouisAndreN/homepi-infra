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

## X5C provisioner bound to the IDevID (v0.1.58, defect 5)

Measured on 2026-11-08: the `idevid-x5c` provisioner had no template and no name
policy. A test IDevID for a fictitious device obtained certificates for its own
name, for another device name and for `homepi.internal`, each with the default
usages (serverAuth and clientAuth). All test certificates were valid 5 minutes
and revoked at once.

Fix (applied manually with automatic rollback, then pinned here):
`/etc/step-ca/templates/idevid-x5c.tpl` (`roles/pki/files/step-idevid-x5c.tpl`)
takes the subject and the only DNS SAN from the IDevID common name
(`.AuthorizationCrt`), refuses an IDevID name outside `^esp32-[0-9a-f]{8}$`,
refuses any requested subject or SAN that differs, and limits usage to
digitalSignature + clientAuth. Renewals (`/renew`) copy the existing
certificate and are not affected.

Proof after the change, same test IDevID:

| requested name   | result                                                  |
|------------------|---------------------------------------------------------|
| own name         | issued, CN and SAN = own name, EKU clientAuth only      |
| another device   | refused: requested subject does not match the IDevID    |
| homepi.internal  | refused                                                 |
| homepi-backup    | refused                                                 |

Backup of the previous configuration: `/var/backups/step-ca/ca.json.before-b3.3`.

Still open: `admin` has no name policy. `ca.json` is mode 0644, but its
directory `/etc/step-ca/config` is 0700 root:root, so only root can read it
(step-ca runs as root; only its unit and `homepi-audit` reference the file).

## admin provisioner: own password and name template (v0.1.66)

Measured on 2026-11-08: `password.txt` opened the root key, the intermediate
key and the `admin` JWK key; `admin` could issue any name. The `admin` key was
re-encrypted (`step crypto change-pass`, same JWK and kid, compact JWE) with a
dedicated password (`step_admin_password` in `secrets/pki.sops.yaml`).

Names: an x509 `policy` in the provisioner was accepted by step-ca 0.30.2 but
not enforced (evil.example was issued in the test; rolled back). The limit is a
template instead (`/etc/step-ca/templates/admin.tpl`, `roles/pki/files/step-admin.tpl`):
subject and every SAN must be homepi.internal, homepi, *.homepi.internal, a
single-label subdomain of homepi.internal, 127.0.0.1, 192.168.200.1 or
192.168.0.151; usage serverAuth + clientAuth. Renewals copy the existing
certificate and do not go through the template.

Proof: homepi.internal and x.homepi.internal issued; esp32-ffffffff,
evil.example and homepi.internal with an extra SAN evil.example refused;
password.txt can no longer sign an admin token; copies of the broker and nginx
certificates renew. Backup: /var/backups/step-ca/ca.json.before-b3.3-admin.

To issue a new server certificate: password from
`sops -d --extract '["step_admin_password"]' ansible/secrets/pki.sops.yaml`.

Still open: password.txt opens the root and intermediate keys; the root key is
online and in the nightly state backup (encrypted to two offline recipients).

## Root CA key offline (v0.1.68)

step-ca only needs the intermediate key: `ca.json` does not reference the root
key. On 2026-11-08 the root key left the Pi:

- Escrow: `homepi-root-escrow-2026-11-08.tar.age` (age, paper key only; root
  key re-encrypted with a dedicated password stored only inside the escrow,
  plus root and intermediate certificates and a README). Copies: laptop
  `~/homepi-escrow` and one USB key, both verified by sha256 after replug.
  Decryption and key/certificate match proven with the retyped paper key.
- Removal: the key was moved to RAM, step-ca restarted without it, renewals of
  the broker and nginx certificates proven, then the RAM copy was destroyed and
  the filesystem trimmed (shred is ineffective on Btrfs and NVMe).
- `hardening` checks that `/etc/step-ca/secrets/root_ca_key` stays absent.

Use the escrow only to sign a new intermediate (see its README), on an offline
machine. Not done on purpose: re-encrypting the intermediate key with a new
password; it is the same key in the kept pre-2026-11-08 archives, and the
nightly backup holds it with its password. Only a new intermediate key would
make those archives useless for it.
