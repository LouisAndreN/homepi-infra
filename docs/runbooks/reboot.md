# Runbook: controlled reboot

## When

- `BootChainUntested` fires: a boot-critical file changed after the current boot, so the next boot,
  a power cut included, would run a chain that never booted.
- After a kernel or initramfs update, and after any change to fstab, mounts or service ordering
  (boot rule in `docs/roadmap.md`).
- Never while `BootChainInconsistent` fires: rebuild the initramfs first.

Reboots stay manual: the Pi is headless and encrypted, a failed boot needs physical access.

## How

From the laptop, with physical access to the Pi within the hour:

    scripts/homepi-controlled-reboot

It refuses to reboot when `cmdline.txt`, `config.txt` or `crypttab` changed since boot, when the
kernel does not match the initrd modules, when a new boot chain has no `.bak` fallback, when the
`/etc/crypttab` keyfile does not open `cryptdata`, or while a GitOps run holds the lock. It reboots
only after `REBOOT-HOMEPI` is typed, then checks the system state, the seven mounts, Loki readiness,
the services, the Prometheus targets, DNS, the ESP32 reconnections and that the boot chain is now
tested. Exit code 0 means PASS.

"Changed since boot" compares each file's sha256 to `/run/homepi-boot-chain.sha256`, written once
at the start of every boot by `homepi-boot-chain-record.service`. It is not an mtime test: on the FAT
`/boot/firmware` a timestamp is a local time read with the kernel timezone of the current boot. In
the C4 drill (2026-11-22) a kernel installed at 15:37 in a boot that had just set `Asia/Tokyo` read
back as 00:37 the next day after the reboot, so the chain stayed "untested" for 9 hours whatever the
number of reboots. Without a record of the current boot (the role was just deployed), the metric
and the script fall back to mtime and say so (`homepi_boot_chain_boot_record 0`); the post-reboot
check fails if the new boot has no record. Offline test: `ansible/roles/boot_chain/tests/boot-chain-test`.

## When it fails

- A `FAIL service ...` line: read the boot order with `journalctl -b -u <unit> -o short-monotonic`;
  the 2026-11-07 game day shows how boot races look.
- No SSH within 10 minutes: do not retry and do not power cycle at once. Look at the LEDs and the
  HDMI output. The EEPROM tries the SD card first: from a rescue SD, restore
  `/boot/firmware/initrd.img.bak` (and `vmlinuz.bak` if the kernel changed);
  `/recovery/scripts/unlock-luks.sh` opens `cryptdata` by hand.
