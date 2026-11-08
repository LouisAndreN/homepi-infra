# Hardening checks (v0.1.65, verify only)

The `hardening` role fails the hourly check if the 2026-11-08 containment
regresses. It changes nothing.

- World-writable paths: files and non-sticky directories under /etc, /opt,
  /usr/local, /var/www and /srv that are `o+w` AND reachable by every account
  (every parent traversable by others). Exposure is judged on the whole path: a
  `0666` file under a `0700` parent is contained.
- Virtualenv integrity (`/opt/pironman5/venv`, `/opt/homepi/api-venv`): every
  installed file against the sha256 of its package RECORD, read with the system
  Python (no code imported from the venv). A path recorded by two packages
  matches either (RPi.GPIO overwrites rpi-lgpio's `RPi/GPIO/__init__.py`).
- Retired paths stay absent: `/opt/homepi-dashboard`,
  `/usr/local/bin/deploy-dashboard`, `/opt/homepi/crl_sync.sh`, mosquitto
  `99-debug.conf` (archives in `/root/homepi-removed`).
- Owners: `/opt/pironman5` and `/opt/homepi/scripts` root:root 0755; no file
  owned by another account under /opt/pironman5, /opt/homepi/scripts, the API
  code and virtualenv, and the dashboard releases.

Why: on 2026-11-08 `/opt/pironman5` was 777 while a root service runs its
virtualenv (any local account could become root), the dashboard web root was
writable (sw.js world-writable), and the API owned its own code and libraries.

A pip upgrade of a virtualenv rewrites RECORD with the files, so it passes. A
hand-edited file inside a virtualenv fails the check: reinstall the package.
