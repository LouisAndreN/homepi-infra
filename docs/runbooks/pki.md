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

1. Closed in v0.1.117: the broker enforces the CRL on 8883 (see "Revocation enforced"). Before that
   the CRL was kept fresh from v0.1.53 but not read; a first attempt on 2026-11-15 rejected every
   device (see "Incident 2026-11-15").
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

## Device identity trust anchor

The step-ca provisioner `idevid-x5c` (type X5C) has one root: the Manufacturer CA
(`CN=HomePi-Manufacturer-CA`, DER sha256 `6a0d04e3a1a8f058...`, valid to 2046). An ESP32 gets its
LDevID only by presenting an IDevID signed by it (IEEE 802.1AR structure). The root lives
base64-encoded in `/etc/step-ca/config/ca.json`, `authority.provisioners[].roots`: that is the
trust anchor. `/etc/homepi/ca/manufacturer_ca.crt` is a reference copy that no program reads
(root-owned and pinned since v0.1.83). The Manufacturer CA key is offline on the laptop.

## step-ca runs as step (v0.1.86)

step-ca runs as the system user `step` in a systemd sandbox (`ProtectSystem=strict`,
`ReadWritePaths=/etc/step-ca/db`, no capability, `SystemCallArchitectures=native`). It reads
`ca.json` (root:step 0640, the device trust anchor), `intermediate_ca_key` and `password.txt`
(root:step 0440) and writes only `db/` (step:step 0700). It cannot change its configuration,
its keys or their modes. Public certificates are root:root 0644. The pki role stays
verify-only: ownership changes are made on the Pi first, then the pins are released.
Rollback: `/root/homepi-removed/pki/step-ca.service.before-v0.1.86`.

Never run step-ca as root on `/etc/step-ca/db`: Badger writes a new table when it closes, and a
root-owned file stops step-ca from starting as step. Any restore of `db/` ends with
`systemctl stop step-ca; chown -R step:step /etc/step-ca/db; systemctl start step-ca`.

## Incident 2026-11-15: crlfile rejected every device (about 3 minutes)

What happened: `crlfile` was enabled on 8883 and the broker restarted. Every client was then refused
(171 x `OpenSSL Error[0]: error:0A000086:SSL routines::certificate verify failed`, 08:52 to 08:55 JST)
until the line was commented out again. The operator noticed it; the test did not.

Cause: step-ca always adds a critical Issuing Distribution Point (IDP) naming its CRL URL. OpenSSL
then uses the CRL only for certificates carrying a matching CRL Distribution Point, and no HomePi
certificate has one: `openssl verify -crl_check` fails with `error 44: different CRL scope` for any
certificate, revoked or not. Reproduced with step-ca 0.30.2 and mosquitto 2.0.18 off the Pi: with
the step-ca CRL a valid client is refused; with the same CRL re-signed without IDP a valid client
connects, a revoked one is refused, and a SIGHUP is enough to load a new CRL. step-ca has no option
to omit the IDP (`crl.idpURL` only changes its URL).

Why the safeguards missed it:
- the reconnection check counted devices with `last_seen` younger than 120 s, which the values from
  before the restart satisfied; worse, the API refreshed `last_seen` of every device from retained
  `status` messages when it resubscribed (fixed in v0.1.116: retained messages are ignored);
- the TLS probe read `Verify return code: 0`, which is the client's verdict on the server
  certificate, and took any refusal other than `certificate revoked` for an acceptance.

Rules kept: a success check must be able to fail and must have been seen failing once; reconnection
is proven by new data (InfluxDB points after the restart), never by `last_seen`; a broker probe is
an MQTT CONNECT that must receive `CONNACK (0)`.

## Re-signed CRL (v0.1.116)

`homepi-crl-sync` now passes the verified step-ca CRL to `homepi-crl-resign`, which re-signs it with
the intermediate key (the key and password step-ca itself reads) and drops only the IDP. It installs
the result only if it verifies against the chain, has no IDP, and lets the broker certificate
through `openssl verify -crl_check`: a CRL with which a valid certificate fails is never installed.
It compares the CRL content (lastUpdate, number, serials), not its bytes, since ECDSA signatures
differ at every run. Once certificates carry a CRL Distribution Point matching the step-ca IDP
(templates, reissued with shorter lifetimes), the re-signing can go.

Proven before the release (scratch CA, same versions): first run installs; a second run with no
change does not reinstall; a CRL revoking the broker certificate is refused and the previous one
stays; a regular revocation is installed.

Also learned that day: `step ca revoke` has no `--provisioner`; it takes a token. Revocation is
done with `step ca token <serial> --revoke` written to a 0600 file and a POST of
`{"serial", "ott", "passive": true, "reasonCode"}` to `/1.0/revoke` (without `passive` step-ca
answers 501); a token cannot be replayed (401). step-ca regenerates the CRL at start and every
`renewPeriod` (1 h), not at revocation.

## Revocation enforced on the broker (B3.2b, v0.1.117)

`crlfile /etc/mosquitto/crl/crl.pem` on the 8883 listener, enabled on the Pi on 2026-11-15, then
pinned here. Proof, each check first seen able to fail:

| step                                              | result                                   |
|---------------------------------------------------|------------------------------------------|
| MQTT CONNECT without a certificate                | refused (the probe can fail)             |
| canary `crl-canary.homepi.internal` (admin, 15 min) | CONNACK 0 before enforcement           |
| crlfile on, broker restart                        | canary CONNACK 0, 0 verify failures, the 6 frequent devices writing to InfluxDB after 10 s, the LED at its next publication |
| canary revoked, step-ca restarted, `homepi-crl-sync` (reload) | canary refused, 1 verify failure (the canary), devices still writing |

Limits:
- A revocation does not close sessions that are already open: the CRL is checked at connection.
  Suspending a device also needs its session closed (broker restart, or a kick).
- step-ca regenerates its CRL at start and every `renewPeriod` (1 h), and the sync runs every 15
  minutes: without a step-ca restart a revocation reaches the broker within about 75 minutes.
  `crl.generateOnRevoke` (present in step-ca 0.30.2) is to be tested off the Pi first.
- The broker logs a revoked client as `certificate verify failed`, not `certificate revoked`.
- nginx does not check the CRL yet: a revoked certificate still reaches the registration API.

The `admin` password was not lost: it is `step_admin_password` in `secrets/pki.sops.yaml`
(v0.1.66). A JWK provisioner `ops` added on 2026-11-15 while it was believed lost was removed the
same day (ca.json restored from the backup matching the pin).
