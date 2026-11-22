# Restore (C1): rebuild the platform on a blank NVMe

Design: `docs/disaster-recovery.md`. Phases R0 to R7; this runbook grows phase by phase.

## Orchestrator (`scripts/restore/homepi-restore`, laptop)

Since C4 the phases R0 to R6 run from one command, in the drill order, and each one is timed:

    scripts/restore/homepi-restore start --day 2026-11-21 --devices 7 --model "990 PRO"
    scripts/restore/homepi-restore resume     # after a stop: the failed phase is retried
    scripts/restore/homepi-restore report     # timeline, RTO (T0 to R6 PASS), RPO per archive
    scripts/restore/homepi-restore plan       # the phases, nothing run

It waits for a person only at T0 (type POWEROFF: it powers production off), the disk swap (SD), and
the microSD removal (BOOT); the R1 device name, the LUKS passphrase and the key and signing
passphrases are typed inside their phases. The timeline (`~/homepi-restore/drill-<start>/timeline.tsv`)
separates the time waiting for a person from the machine time, and keeps every failed attempt: the
RTO is the wall clock from T0 to the first R6 PASS, failures included. RPO is T0 minus the time in each
archive name. Host keys: `~/.ssh/known_hosts.drill-sd` for the microSD system,
`~/.ssh/known_hosts.drill-new` for the rebuilt system until R3 restores the production keys; the usual
`known_hosts` is never changed. R7 and R8 stay manual.

Tested offline only (`scripts/restore/tests/restore-orchestrator-test`, every phase stubbed): order,
timeline, resume after a failure, values carried between phases, RTO/RPO arithmetic. Each phase calls
the same commands as C3 (article 20), but the chain itself is first proven by the C4 drill.

## Hardware

- The production disk (Micron 2200) is **removed** and kept intact. The spare (Samsung 990 PRO)
  goes into the NVMe slot. Never run R1 with both disks attached: `homepi-r1-layout` refuses a
  visible `vg-main` or a LUKS partition outside the target, but the guard is a net, not a plan.
- Boot medium: microSD with Ubuntu Server 24.04. EEPROM `BOOT_ORDER=0x641` tries the SD first, so
  the Pi boots from the SD as long as it is inserted.
- The 990 PRO is 22 GiB smaller than the Micron: same partitions and volume sizes, about 17.6 GiB
  left free in `vg-main` (40 GiB on the Micron).

## R0: fetch the backups (`scripts/restore/homepi-r0-fetch`, laptop)

Picks the newest state archive in S3 (or the one of a given day) and the native InfluxDB backup of
the same day, downloads both into `~/homepi-restore/<day>/`, checks each file against the SHA-256
S3 stored at upload, and proves the laptop age key decrypts them by streaming `age -d | tar -t`:
nothing is ever written decrypted. It also checks that the state archive holds `etc-and-state.tar`,
`opt.tar` and `sqlite-extra/crowdsec.db`.

The state archive of the nightly run (03:30) and the native backup (03:50) are 20 minutes apart. A
state archive made by hand later in the day is newer than that day's native backup: InfluxDB then
comes back older than the registry. Pass the day to pick the nightly pair if that matters.

It then downloads every hourly sensor delta newer than that native backup into `<day>/deltas/`, checks
each against its S3 SHA-256 and proves it decrypts (`manifest.txt` listed). No delta is a warning,
not a failure: sensor data then comes back as of the native backup.

If the laptop is lost: the paper key opens the same archives (`docs/disaster-recovery.md`).

## Before R1: the microSD

The microSD was used to set up the production disk in 2026. It may still hold a copy of the
production LUKS keyfile or of the setup notes (article 0 created the keyfile from the SD system).
Check it before the drill and, once C3 is over, delete those copies: the SD is a loose card.

## R1: disk layout and base system (`scripts/restore/homepi-r1-layout`)

What it does, in order, stopping at the first problem:

1. Preflight: root, target is a block device whose model contains the expected text and is not a
   Micron, the running root is not on the target, no `vg-main` and no LUKS partition elsewhere,
   an SSH public key to install, the repository files it needs, Ubuntu's server reachable.
2. Downloads the newest Ubuntu 24.04 raspi server image and verifies it: `SHA256SUMS` signed by the
   Ubuntu CD image key (local keyring), then the image checksum.
3. Asks the operator to type the device name, then wipes it.
4. Partitions with the production boundaries (MiB): p1 vfat BOOT 1G, p2 ext4 ROOT 100G, p3 swap 4G,
   p4 ext4 RECOVERY 5G, p5 LUKS2 for the rest.
5. LUKS2 aes-xts-plain64 512-bit, 4096-byte sectors, argon2id, label `cryptdata`: the operator types
   the passphrase (keyslot 0); a 512-byte keyfile generated in RAM is added (keyslot 1).
6. `vg-main` and the ten volumes with the production sizes in bytes, labels and filesystems; Btrfs
   subvolumes `@iot-hot`, `@iot-archives`, `@backups`, `@personal`.
7. Copies the image onto the mounted tree (so `/var`, `/var/log` land on their volumes), writes
   fstab and crypttab with the new UUIDs, cmdline.txt and config.txt as in production, hostname,
   netplan from the network role, the Btrfs mount units from the storage role, zram; disables
   cloud-init.
8. Chroot: unlock packages, operator account `srvpi` (password locked, key only, passwordless sudo),
   SSH host keys, initramfs.
9. `/recovery`: new LUKS header backup, keyfile copy, unlock script (same content as production).
10. Verifies sizes, filesystems, mounts, two keyslots, kernel, initramfs, authorized_keys; closes.

Deliberate difference from the production disk: no initramfs hook copying the keyfile. The root is
not encrypted, `cryptdata` is opened by systemd after the initramfs (reboot game day 2026-11-07),
so the hook only made one more copy of the key, on the FAT partition.

Tests: `sudo scripts/restore/tests/r1-partition-test` (offline, no device-mapper needed) checks the
partition boundaries, labels, free space on a 990 PRO, mount order and the model guard. LUKS, LVM,
the image copy and the chroot are only proven on the hardware.

After R1: power off, remove the microSD, power on. The new system has new SSH host keys until R3
restores the production ones: connect with a separate known_hosts file during the rebuild.

## R2: packages and service accounts (`ansible/restore-base.yml`, laptop)

`ansible-playbook restore-base.yml` installs the pinned apt sources and packages (roles `common`,
`packages`) and the monitoring accounts (`monitoring_binaries`). Packages create their own users
(grafana, mosquitto, influxdb, telegraf, authelia, alloy, unbound, _chrony). Until R3 restores the
production SSH host keys, connect with a separate known_hosts file: the rebuilt system has new ones.

## R3: restore the state (`scripts/restore/homepi-r3-restore`, Pi)

    age -d -i ~/.config/sops/age/keys.txt ~/homepi-restore/<day>/homepi-state-<...>.tar.age \
      | ssh <pi> 'sudo /tmp/homepi-r3/homepi-r3-restore'

The decrypted archive goes from age through SSH straight into RAM on the Pi (`/run`, removed at
exit); nothing decrypted is written on the laptop or on the Pi's disks except the restored files.

1. Creates `step` and `homepi-api` (made by hand on the production Pi, by no package or role),
   with the production homes and shells.
2. Expands `scripts/restore/r3-paths.txt` against the archive: a `required` path that is absent
   stops the restore, an `optional` one is reported.
3. Checks that every owner of the selected files exists: tar maps owners by name, and a missing
   name would silently become a number.
4. Stops the services that hold those files, restores the selection with owners and modes, the
   application files under /opt (without the API code and the virtualenvs, which Ansible rebuilds),
   and the four SQLite databases (devices.db, Authelia, Grafana, CrowdSec), each checked with
   `PRAGMA integrity_check`.

What the allowlist holds, and why: the files the verify-only roles check but never write (pki,
network, nginx, provisioning_api: the full apply would fail without them), the identities (step-ca
keys and database, broker certificate, nginx wildcard certificate, NetBird peer, AWS edge
certificate, SSH host keys, GitHub deploy key), the GitOps trust anchor `allowed_signers`, and the
state outside the repository (`/var/lib/secrets`, `/var/lib/homepi`, Terraform state). Everything
else comes from the repository in R4. Never fstab, crypttab, machine-id or the boot files (R1).

Tested offline (`scripts/restore/tests` style, fake archive): selection, wildcard host keys, step-ca
database, /opt exclusions, database owners and modes; stray files, fstab and unlisted /etc files are
not restored; a missing required path, an unknown owner and an empty stdin stop it.

## R3.5: start what R3 stopped (`ansible/restore-services.yml`, laptop)

    ansible-playbook restore-services.yml

R3 stops the services that own restored files, and the verify-only roles (network, pki) never start
anything. C3 (2026-11-21) did this phase by hand. The playbook refuses the Micron, builds the IoT
driver for every installed kernel (`wifi_driver`), unmasks hostapd, loads nftables after `nft -c`,
reloads `netfilter-persistent` from the restored `rules.v4`/`rules.v6` (IoT NAT, NetBird DNS DNAT),
restarts NetBird after the firewall, and enables step-ca and its renewal timers. nginx is started by
its own role in R4, once its site files are in place.

## R4: new Pi age key and full apply

1. On the Pi: `age-keygen -o /etc/homepi-gitops/age.key` (root 0600), print the public key only.
2. On the laptop: **add** that key to `.sops.yaml` and `sops updatekeys` every `*.sops.yaml`. Add,
   never replace: the production Pi (Micron) must still decrypt the repository when it comes back.
3. Boot-critical storage files (the `storage` role in `site.yml` only verifies them):

       ansible-playbook storage.yml --check --diff
       ansible-playbook storage.yml

4. Full apply with the GitOps timers **off**:

       ansible-playbook site.yml -e gitops_timers_enabled=false

   C3: the first pass enabled the timers and the rebuilt Pi applied the restored, older tag every
   10 minutes in parallel with the laptop runs (defect 41). After R5: the influxdb role checks the
   restored state with the restored tokens; `provisioning_api` rebuilds the API virtualenv from
   `requirements.lock`.
5. Signed tag (`release` in `scripts/lib.sh`: precheck on the Pi, signed tag, push), then start
   `homepi-gitops@apply.service` once on the Pi. That apply runs `site.yml` with the default
   `gitops_timers_enabled: true`: GitOps takes over from there.

Order on the drill: R1, R2, R3, **R5 (native backup, then deltas), R3.5, then R4**, R6, R7, R8.

## R5: InfluxDB (`scripts/restore/homepi-r5-influx`, Pi)

    age -d -i ~/.config/sops/age/keys.txt ~/homepi-restore/<day>/influx-native-<...>.tar.age \
      | ssh <pi> 'sudo /tmp/homepi-r3/homepi-r5-influx /tmp/homepi-r3/config.toml'

Refuses an InfluxDB that already holds data or is already set up. Installs the production
`config.toml` (data under `/var/lib/influxdb/influxdb2`), runs a throwaway `influx setup` whose token
stays in a config file in RAM, then `influx restore --full`: buckets, tasks, data and every
authorization with its original token. Proof: the operator token restored by R3 lists the buckets,
the downsampling task is present, the archived points are counted. No SOPS change follows.
The throwaway password is passed on the command line: it dies with the restore a minute later.

Then the hourly deltas, oldest first, one at a time (the orchestrator phase R5D does this loop):

    for f in ~/homepi-restore/<day>/deltas/influx-delta-*.tar.age; do
      age -d -i ~/.config/sops/age/keys.txt "$f" | ssh <pi> 'sudo /tmp/homepi-r3/homepi-r5-deltas' || break
    done

Each delta stays in RAM (`/run`); `influx write` gets the restored operator token through the
environment. After each bucket the script counts the points in the delta window and stops if
InfluxDB holds fewer than the delta.

## R6: verify (`scripts/restore/homepi-r6-verify`, Pi, read-only)

systemd `running`, every `homepi-*-check`, a deployed GitOps tag, at least 7 MQTT mTLS clients, no
certificate signed in the last hour (devices came back without re-enrolment), Telegraf writes
accepted by InfluxDB, no alert firing but the Watchdog, every Prometheus target up. Then by hand:
the dashboard and Grafana through Authelia with 2FA, and the fan (pironman5, below).

## R7: end of the drill (`scripts/restore/homepi-r7-end-drill "990 PRO"`, Pi)

Refuses to run on the Micron. Stops and disables the backup timers, the off-site upload, the log
shipping, the GitOps timers and the heartbeat relay on the spare, checks each one by its state, so a spare booted by mistake never uploads a diverging
archive nor competes with production. Then power off, production disk back before 03:30, and on
the laptop remove the drill Pi key from `.sops.yaml` (`sops updatekeys`, signed tag).

## Known gap: pironman5

The case software (fan, OLED) runs from `/opt/pironman5/venv`, which no role builds and the archive
excludes. R3 restores `/opt/pironman5` without the venv; reinstall it with the vendor installer
during the drill and note the time. Until a role owns it, the NVMe cooling of a rebuilt Pi depends
on that manual step.
