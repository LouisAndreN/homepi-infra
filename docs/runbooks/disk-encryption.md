# Disk encryption: measured layout and accepted risk

Measured on 2026-11-08 (`lsblk`, `/etc/crypttab`, `cryptsetup luksDump`).

| Partition | Content | Encryption |
|---|---|---|
| nvme0n1p1 (vfat, 1 G) | /boot/firmware, kernel, initramfs | none |
| nvme0n1p2 (ext4, 100 G) | `/`, including all of `/etc` | none |
| nvme0n1p3 (4 G) | swap | plain dm-crypt, random key at each boot |
| nvme0n1p4 (ext4, 5 G) | /recovery | none |
| nvme0n1p5 (844 G) | LVM `vg-main`: /var, /var/log, InfluxDB, containers, Grafana, Loki, ML volumes, cloud-sync, Btrfs `lv-data` (/mnt/data, backups) | LUKS2, aes-xts-plain64 512-bit, 2 keyslots, argon2id |

## How p5 is unlocked

`/etc/crypttab` opens `cryptdata` at boot with `/boot/luks-keyfile` (512 bytes,
root 0400), which lives on the unencrypted root partition; the initramfs also
carries the unlock material. This gives a headless boot.

## What this protects, and what it does not

- Does NOT protect against theft of the Pi or of the NVMe: the key that opens
  p5 is readable on p2.
- `/etc` is not encrypted at all. It holds the step-ca intermediate key and
  its password, the Pi SOPS age key (which opens every SOPS secret in this
  repository), the Authelia configuration, the broker and nginx keys, and the
  Wi-Fi and NetBird configuration.
- Disposal or RMA of the disk: wipe the whole device (all partitions), not
  only p5.

## Decision

2026-11-08, owner: risk accepted and documented; no change to the unlock.
The keyfile must be treated as exposed: if the unlock is ever changed, remove
its keyslot (`cryptsetup luksKillSlot`), do not just delete the file.

## What would close it

1. An unlock that does not keep the key on the same disk: Clevis + Tang on a
   second always-on device (automatic at home, passphrase keyslot as
   fallback), or a passphrase typed over SSH in the initramfs (dropbear).
2. `/` on the encrypted side: offline `cryptsetup reencrypt --encrypt` of p2
   from /recovery, after a verified backup and with a rollback plan.
3. Kill the keyfile keyslot; consider `discard` (it reveals the free-space
   layout).
