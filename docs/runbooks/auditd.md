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
- Rotation: 30 files of 100 MB (10 of 50 MB until 2026-11-25: 38 hours of history).
- Measured 2026-11-25 over 38 hours (`aureport --input-logs --key --summary`): `exec` 193,704,
  `mount_operations` 144,677 (145,218 from `systemd-executor` setting up the private namespace of a
  unit: excluded by two `never` rules), `network_connect` 58,902, every other key under 2,000. The
  15 `ssh-keys` records were `auditctl` loading the rules at 5 boots, not writes to the file.
- Do not run `ausearch` or `aureport` without `--input-logs` in a script fed on stdin (`ssh host
  'bash -s'`): they read stdin, consume the rest of the script and report nothing.
- Not done: `-e 2` (immutable rules). It needs a reboot for any rule change, which breaks GitOps.

Logs reach Loki through Alloy (`job="auditd"`).

## Rule file syntax

auditctl accepts no comment after a rule on the same line. augenrules starts with `-D` and stops
at the first bad line, so one trailing comment leaves the kernel with only the rules above it
(v0.1.87). The release block lints `homepi.rules` for this before committing.
