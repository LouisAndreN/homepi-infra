# auditd

Rules: `rules.d/audit.rules` (base: `-D`, `-b 8192`, `--backlog_wait_time 60000`, `-f 1`) and
`rules.d/homepi.rules` (role `auditd`). The role loads them with `augenrules --load` only when
`augenrules --check` reports a difference, then checks the kernel: every key loaded, 32-bit rules
present, no `connect` rule without an `auid` filter, `augenrules --check` clean.

## Decisions (measured 2026-11-09)

- The former `-a always,exit -F arch=b64 -S connect` logged every connect() of every process,
  mostly services and unix sockets (journald, D-Bus): about 110 MB of audit log per hour, so the
  local trail (5 x 30 MB) covered about 80 minutes. `network_connect` now covers login sessions
  only; unexpected service traffic belongs to the nftables egress policy.
- `exec` (root commands from a login session) stays: it also records Ansible runs started by a
  person. Runs from the GitOps timer have no auid and are not recorded.
- `CONFIG_COMPAT=y` and the Cortex-A76 runs AArch32 code: a static 32-bit binary would bypass
  64-bit-only rules. `exec`, `connect` and `mount` have `arch=b32` twins.
- `/etc/crowdsec` is watched for writes only (CrowdSec reads its own configuration constantly).
- Added: `/etc/group`, sudoers, the step-ca configuration (device trust anchor) and secrets
  (reads included), `/var/lib/secrets`, Mosquitto passwords and ACLs, `/etc/homepi`,
  `/etc/systemd/system`.
- Rotation: 10 files of 50 MB.
- Not done: `-e 2` (immutable rules). It needs a reboot for any rule change, which breaks GitOps.

Logs reach Loki through Alloy (`job="auditd"`).
