# Restore (C1): rebuild the platform on a blank NVMe

Design: `docs/disaster-recovery.md`. Phases R0 to R7; this runbook grows phase by phase.

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
