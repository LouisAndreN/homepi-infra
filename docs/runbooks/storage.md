# Runbook: storage layout

## Model

fstab entries, the Btrfs subvolume mount units and the Loki drop-in are boot-critical
(`homepi-triage` classifies `/etc/fstab` and `*.mount` as MANUAL). GitOps (`site.yml`) only verifies
them: the `storage` role runs every task in check mode and fails the run on drift, naming each
drifting item. A human applies changes with `storage.yml`. Volumes are never created or resized by
Ansible: a wrong variable must not be able to shrink a logical volume.

## Layout (2026-11-07)

| Volume | Size | Filesystem | Mount | Notes |
|---|---|---|---|---|
| `lv-loki` | 20G | XFS | `/var/lib/loki` | dynamic inodes; `nofail`, Loki has `RequiresMountsFor=/var/lib/loki` |
| `lv-data` | 344G | Btrfs | `/mnt/data` (`@iot-hot`) and mount units for `@backups`, `@personal`, `@iot-archives` | compress is per filesystem: the first mount (zstd:3) applies to every subvolume |
| free in `vg-main` | 40G | | | headroom for LVM snapshots and emergency growth; 20G intended for Prometheus (B1b) |

`lv-scratch` (60G, empty) was removed on 2026-11-07 to make room.

## Change a storage setting

1. Edit `ansible/roles/storage` (defaults or files).
2. `ansible-playbook storage.yml --check --diff` and review the diff.
3. Apply by hand: `ansible-playbook storage.yml`, then run it again: it must report `changed=0`.
4. `ansible-playbook site.yml --check` must report `changed=0`, then release. The order matters:
   the release gate fails on drift until the change is applied.
5. If fstab, a mount or a service ordering changed, prove it with a reboot and no manual action,
   preconditions as in `docs/game-days/2026-11-07-reboot.md`.

## Add or move a volume (manual)

1. `lvcreate`, `mkfs`, mount on a temporary path.
2. Stop the service, `rsync -aHAX --numeric-ids`, compare the entry count and the total file bytes
   of source and copy; any difference aborts.
3. Rename the old directory, mount the new volume in place, start the service, check readiness and
   ingestion.
4. Keep the old copy until a reboot has passed, then delete it by explicit decision.
5. Add the volume to `storage_mounts` and adopt it (check mode 0 change).

## Boot fallback

- The EEPROM boot order (`BOOT_ORDER=0xf641`) tries the SD card first: a rescue SD gives access to
  the NVMe.
- After a kernel or initramfs update, `/boot/firmware/vmlinuz.bak` and `initrd.img.bak` hold the
  previously booted set: restore them from the rescue system if the new set fails.
- `/recovery/scripts/unlock-luks.sh` opens `cryptdata` by hand.

## Known gap

The hourly check timer runs the deployed tag in check mode: storage drift makes that run fail and
raises `GitopsCheckFailing` (v0.1.43). Between two runs, a drift stays unseen up to about an hour.
