# Incident 2026-11-01: /var ran out of inodes, and no alert reached a human

| | |
|---|---|
| Status | Resolved (v0.1.24, v0.1.25), follow-up actions open |
| Severity | High: web access, DNS, alerting, GitOps and scheduled backups degraded at the same time |
| Start | ~16:00 JST on 2026-11-01 (last successful textfile metric write: 16:01:38) |
| Detected | 00:38 JST on 2026-11-02, by hand: an Ansible check failed with "No space left on device". No alert did it |
| Mitigated | ~07:00 JST on 2026-11-02 (881,172 inodes freed) |
| Fixed | 07:54 JST on 2026-11-02 (v0.1.25) |
| Data loss | Log lines only (see Impact). No metric, configuration or backup lost |

## Summary

The ext4 volume mounted on `/var` (`lv-var`, 20 GiB, 1,310,720 inodes) reached 100% inode usage
while 27% of its space was still free. Loki owned 1,303,134 of those inodes, 1,039,716 of them
empty directories. Every service that needed to create a file on `/var` started failing, including
Unbound, which crashed and took DNS down with it, so Alertmanager could not reach Slack and none
of the alerts that fired was ever delivered.

## Timeline (JST)

| Time | Event |
|---|---|
| 2026-03 onwards | Alloy turns the auditd `addr` and `comm` fields into Loki labels: every new value is a new stream, and Loki's filesystem store creates one directory per stream and never removes it |
| 2026-11-01 ~16:00 | Last inode used. Collectors stop writing their metrics, scheduled units start failing |
| 2026-11-01 evening, night | Unbound cannot rewrite `/var/lib/unbound/root.key`, exits, and is restarted by `Restart=on-failure` (3,323 restarts in total). Alertmanager fails to resolve `hooks.slack.com` |
| 2026-11-02 03:30 | Nightly state backup fails. Loki's compactor cannot create its work directory, retention stops |
| 2026-11-02 00:38 | Release v0.1.24 refused by the Pi (`unpacker error`), Ansible check fails on apt: first human detection |
| 2026-11-02 06:36 | Nginx cannot buffer the Authelia login page (`open() ... failed (28: No space left on device)`) |
| 2026-11-02 ~06:50 | Diagnosis: inodes at 100% on `/var`, Loki identified, `addr` label identified |
| 2026-11-02 ~07:00 | Empty Loki stream directories removed by hand: 881,172 inodes free. Authelia, Nginx, Unbound and Git recover by themselves |
| 2026-11-02 07:04 | v0.1.24 deployed (separate defect found on the way: the scheduled InfluxDB export authenticated as the sudo user) |
| 2026-11-02 07:08 | Failed `homepi-*` units rerun: state backup, AWS edge certificate renewal, certificate expiry collector |
| 2026-11-02 07:54 | v0.1.25 deployed: bounded labels, daily Loki housekeeping, capacity alerts. Verified: 0 lines with `addr`/`comm`, 0 lines dropped |

## Impact

- **Web access**: Authelia could not write its SQLite database (`unable to open database file`), so
  every login failed; Nginx could not buffer proxied responses. The dashboard was unreachable.
- **DNS**: Unbound down, so the NetBird resolver used by the Pi answered SERVFAIL for public names.
- **Alerting**: 79 of 101 Slack notifications failed (`lookup hooks.slack.com ... server misbehaving`).
  Alerts did fire (`GitopsMetricsMissing`, `BackupMetricsMissing`) but nobody received them.
- **GitOps and packages**: Git could not store objects, apt could not build its cache.
- **Backups and certificates**: the nightly state backup, the AWS edge certificate renewal and the
  certificate expiry collector failed; all were rerun successfully at 07:08.
- **Logs**: Loki's counters since its last start show 311,462 lines dropped on the stream limit
  (`max_global_streams_per_user` = 5000, reached by the `addr` streams) and 71,664 on the rate limit
  (syslog was also ingested twice). Part of those lines were **audit events**: security evidence was
  silently discarded. Loki's retention also stopped while the compactor could not run.

## Root cause

Two defects that were harmless separately:

1. **Unbounded labels.** The Alloy auditd pipeline extracted `addr` (a hex socket address, thousands
   of values per hour) and `comm` into labels, and replaced the log line with the executable path
   (`stage.output`), so the labels were the only place left for that information.
2. **Loki's filesystem store on a shared ext4 volume.** One directory per stream, never deleted after
   its chunks expire, on a file system whose inode count is fixed at creation and shared with
   Authelia, Nginx, Unbound, Git, apt and every collector.

## Why nothing alerted

- There was **no inode alert**, only space metrics, and space was at 73%.
- The alert path depended on the failing host: Alertmanager on the Pi, resolving through NetBird
  then Unbound on the Pi, posting to one channel (Slack). When the Pi degraded, the alerts about it
  could not leave it.
- **Unbound's crash loop was invisible**: `Restart=on-failure` kept the unit "active" and nothing
  watched the restart count.
- The day before, alert delivery had been declared working on one successful notification; the
  failed-notification counters were not checked over time.

## What went well

- SSH over NetBird kept working, so the whole diagnosis and repair was done remotely.
- Read-only diagnosis before any deletion: the fix removed only empty directories and lost no chunk.
- The GitOps reconciler refused the incomplete push instead of deploying a half-written tag.
- The release gate in code (`failed=0`, expected number of changes, expected roles) stopped one
  release whose expectations were wrong instead of letting it through.

## Actions

| # | Action | Status |
|---|---|---|
| 1 | Alloy managed from the repo; only bounded labels (`job`, `host`, `unit`, `level`, `key`, `user`, `filename`); full audit record kept as the line | Done, v0.1.25 |
| 2 | Duplicate syslog stream under `job="nftables"` reduced to drops; dead pipelines removed; journal relabel rules fixed (`relabel_rules`, `__journal_priority_keyword`) | Done, v0.1.25 |
| 3 | Daily removal of empty Loki stream directories, with metrics and a "housekeeping silent" alert | Done, v0.1.25 |
| 4 | Alerts: inodes below 10% and 3%, space below 10%, full within 7 days, Loki dropping lines, Loki near the stream limit, systemd restart loops, failed units | Done, v0.1.25 |
| 5 | Scheduled InfluxDB export with its own Influx CLI config (found during the incident) | Done, v0.1.24 |
| 6 | Alerting channel outside the Pi: CloudWatch heartbeat fed by the Watchdog, SNS e-mail when it stops | Open, next |
| 7 | Loki on its own XFS logical volume (dynamic inodes), off `/var` | Open, phase 2 storage role |
| 8 | DNS: Unbound as the system resolver, NetBird only for its own domain; no single DNS chain for alerting | Open, phase 2 network role |
| 9 | Reduce auditd volume (~39 lines/s, mostly socket records to `/dev/log`) so security events are not drowned | Open |
| 10 | Nginx, Authelia, CrowdSec and Loki configurations in the repo (they are still hand-managed) | Open, phase 2 |
| 11 | Prometheus reloads instead of restarting on a rule change | Open |
