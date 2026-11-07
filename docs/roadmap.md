# HomePi roadmap to v1

Target architecture: `docs/architecture/homepi-target-architecture-v1.drawio` (green = built and
verified, orange = the step below that delivers it).

Rules:
- A step is done only when its **proof** is obtained and recorded (command output, test, report).
- Every change goes through the repo: check mode clean (`failed=0`, expected changes only), signed
  tag, GitOps apply. No hand edit on the Pi without an entry in `docs/known-limits.md`.
- Irreversible decisions (Object Lock COMPLIANCE, deleting a volume, closing an account) need an
  explicit go after the preparation is reviewed.

## Progress

| Step | Done | Proof |
|---|---|---|
| A1 | 2026-11-06, commit 360d1d2 | Full history audited (gitleaks clean, 0 private key, 4 SOPS files encrypted, `.sops.yaml` holds the 3 public recipients only); 26 tags on GitHub; `git push pi` pushes to the Pi and GitHub. Rulesets created but not enforced on a free private repository: protection comes from tag signatures checked by the Pi |
| A1b | 2026-11-07, v0.1.32 | The Pi pulls signed tags from GitHub with a read-only deploy key generated on the Pi and GitHub's host key pinned; tags pruned against GitHub only; local push repository kept as fallback and protected against forced pushes and deletions. Proof: v0.1.33 pushed to GitHub only, absent from the local repository, applied by the Pi after its signature was verified |
| A2 | 2026-11-06, v0.1.26 | Both kinds in S3 with the local size, a stored SHA-256, GOVERNANCE retention 30 days, one version each; forced failure kept the last success time and raised `OffsiteUploadFailing` (pending); recovery cleared it |
| A3 | 2026-11-07, v0.1.29 | Alarm to e-mail without the Pi; full chain Pi to CloudWatch to OK; edge-heartbeat denied outside its namespace, on S3 and on reads; game day 1 FAIL (25 min 52 s, analysed and fixed), cadence measured in CloudWatch (10 of 10 minutes), game day 2 PASS: detection 14 min, recovery 4 min, preconditions checked in code (docs/game-days/) |
| A4 | 2026-11-07, v0.1.31 | Unbound is the system resolver and forwards only netbird.cloud to NetBird (zone not DNSSEC-signed, NetBird resolver measured still listening with --disable-dns); switch done detached with automatic rollback, then adopted by the dns role; public, internal and NetBird names resolve through the system; Slack [FIRING] and [RESOLVED] test seen by a human |
| B1 | 2026-11-07, v0.1.35 to v0.1.40 | `lv-scratch` (60G, empty) removed instead of shrinking the Btrfs; `lv-loki` 20G XFS, copy verified (124,780 entries, 256,427,664 bytes), 40G left free in the VG; role `storage` verifies in GitOps and fails on drift, `storage.yml` applies by hand (fstab and mount units are MANUAL); `nofail` on `lv-loki`, `RequiresMountsFor` on Loki; first reboot found 3 boot races, fixed by `service_ordering` (v0.1.40), second reboot PASS with no manual action; old copy deleted, `/var` inodes 133,253 to 8,473 (docs/game-days/2026-11-07-reboot.md) |
| B5 (part) | 2026-11-07, v0.1.42 and v0.1.43 | Loki on the `inmemory` kvstore: nothing listens on 7946 (memberlist listened on every interface), `/ready` 200 18 s after a restart (3 to 4 min before); Prometheus reloads with SIGHUP on rule, config and secret changes: same PID across the v0.1.43 rule change, live reload timestamp advanced; the role fails unless the live `/metrics` shows a successful reload; `PrometheusConfigReloadFailed`. Alertmanager keeps its restart (envsubst at start). Open: Grafana and Alertmanager config and secrets in SOPS |
| B9 | 2026-11-07, v0.1.43 | Drift drill (docs/game-days/2026-11-07-drift-drill.md): a comment line in a managed mount unit made the check fail, `GitopsCheckFailing` fired 440 s after the drift and reached Slack; `storage.yml` repaired it, resolved 169 s later |
| B10 | 2026-11-07, v0.1.44 and v0.1.45 | `homepi-boot-chain-metrics` publishes per boot-critical file whether it changed since boot and whether kernel and initrd modules match; `BootChainUntested`, `BootChainInconsistent` (critical), `BootChainMetricsStale`; a simulated `crypttab` change (mtime only) went 0 to 1 and back; reboots through `scripts/homepi-controlled-reboot` (docs/runbooks/reboot.md) |

## Phase A: close the 2026-11-01 incident actions (now)

| Step | Deliverable | Proof that closes it |
|---|---|---|
| A1 | GitHub becomes the source of truth: private repo `homepi-infra`, full history audited (gitleaks, no private key, every `*.sops.yaml` encrypted), `main` and all tags pushed, `git push pi` also pushes to GitHub, ruleset blocking force push and deletion of `main` and `v*` | `git ls-remote` on GitHub lists every local tag; tags show "Verified" |
| A1b | The Pi pulls signed tags from GitHub with a read-only deploy key; tag signatures still checked against `allowed_signers`; the laptop push to the Pi stays as a documented fallback | A release tagged on the laptop is applied by the Pi without any push to the Pi |
| A2 | `homepi-backup-run` uploads each successful backup off-site; metrics per kind; alert `OffsiteBackupTooOld` (state > 36 h, influx-lp > 8 days) | Next nightly backup present in S3 with its retention date; alert fires when the upload is blocked on purpose |
| A3 | Dead man's switch: Terraform role `edge-heartbeat` (`cloudwatch:PutMetricData`, namespace `HomePi` only) added to the Roles Anywhere profile, SNS topic with e-mail subscription, CloudWatch alarm (3 x 5 min, missing data = breaching, ALARM and OK actions); Ansible heartbeat relay (Alertmanager webhook, Watchdog only) | Alertmanager stopped for 20 min: ALARM e-mail received; restarted: OK e-mail received. Recorded in `docs/game-days/` |
| A4 | Unbound is the system resolver; NetBird no longer rewrites `resolv.conf`, its domain is forwarded by Unbound; Slack delivery confirmed by a human | `resolv.conf` points to 127.0.0.1; a test alert from `amtool` is seen in Slack; NetBird names still resolve |

## Phase B: the Pi can be rebuilt from Git alone

Method for every component: import the live configuration, run check mode until it reports 0
change, commit (adoption), then change it in a separate release.

Idempotence rule (learned with v0.1.33): check mode skips commands and shell tasks, so it cannot
prove idempotence. Every adopted role must pass two consecutive real runs on the deployed code,
the second one with changed=0. changed_when and failed_when compare exact values, never substrings.

Effect rule (learned with v0.1.38 and v0.1.39): a release is proven by its effect on the Pi (process
arguments, logs, metrics), not by a task reported as changed. Boot rule (2026-11-07): a change to
fstab, mounts or service ordering is proven by a reboot with no manual action. Check-mode rule
(v0.1.44): check mode does not install a new unit, so a systemd task on a unit created in the same
run skips only in that case (`not (ansible_check_mode and <unit task> is changed)`), never with
`ignore_errors`; the next check mode on the deployed code must show it `ok`.

| Step | Scope | Proof |
|---|---|---|
| B1 | `storage`: fstab entries, Btrfs subvolume mount units and the Loki drop-in, verified by GitOps and applied by hand with `storage.yml`; Loki on its own XFS volume (`lv-scratch` removed, 40G left free in the VG); LVM changes stay manual | `df -i /var` no longer contains Loki; two reboots, the second with every mount and service up and no manual action |
| B2 | `network`: nftables, hostapd, dnsmasq, NetBird settings | Check mode 0 change; IoT Wi-Fi and LAN rules unchanged (nft diff empty) |
| B3 | `pki_mqtt`: step-ca (`ca.json` with the `aws-edge` provisioner and its template, secrets in SOPS), Mosquitto (mTLS, ACL, CRL) | A device re-enrolls; a revoked certificate is refused |
| B4 | `influxdb`, `telegraf`: config, buckets, tasks as code (the downsampling task leaves `/tmp`) | The task exists after a restore; it appears in the InfluxDB export |
| B5 | `observability`: Loki config, Grafana `grafana.ini` and secret key in SOPS, Alertmanager config, Prometheus reloads instead of restarting | Rule change applied without a Prometheus restart |
| B6 | `access`: Nginx (one canonical name `homepi.internal`), Authelia (config, users in SOPS), CrowdSec (whitelists, bouncer, collections) | Login from LAN, tablet and NetBird; a CrowdSec test ban on a public IP works, never on LAN |
| B7 | `apps`: HomePi API, dashboard deployed from a build artifact (manifest fixed in the source), Hailo runtime | Dashboard installs as an app on Android with its icon |
| B8 | Hygiene: auditd rules reduced, Grafana Terraform state in S3, `homepi-audit` lists unmanaged files under `/etc` | `homepi-audit` reports no unmanaged service configuration; `known-limits.md` "not managed" list is empty |
| B9 | Drift alerting: the hourly check timer already publishes `homepi_gitops_drift_changed_tasks` (`GitopsDrift`), but a failed check run, which is how the storage role reports drift, raised no alert: `GitopsCheckFailing` | A hand-made storage drift raises `GitopsCheckFailing`; `storage.yml` repairs it and the alert resolves |
| B10 | Boot chain: metric and alert when `/boot/firmware` or `/etc/crypttab` changed since the last boot; controlled reboot, with the reboot game day checks, after any kernel or initramfs update | An initramfs rebuild raises the alert; the reboot clears it |
| B11 | One Ansible runtime: the laptop and the Pi use the same ansible-core version and collections from one `requirements.yml` (the release gate tests the controller, the Pi runs its own venv) | Check mode on the laptop and on the Pi report the same result for the same tag |

## Phase C: prove the recovery

| Step | Deliverable | Proof |
|---|---|---|
| C1 | `docs/rebuild.md` and `homepi-restore`: disk layout (LUKS2, LVM from B1), OS bootstrap, Ansible from GitHub, restore of the state and InfluxDB backups, verification checklist | Script runs end to end on a test disk |
| C2 | Restore source: local backups, or S3 through SSO (homepi bucket, later the vault) | Download, decrypt and checksum verified from the laptop |
| C3 | Game day 1 on the spare SSD: full rebuild, timed, recorded on video | `docs/game-days/` report: measured RTO vs 4 h target, RPO vs 24 h, every gap fixed or listed |
| C4 | Monthly automated integrity test of a random backup (download, decrypt, list) | Metric and alert `BackupRestoreTestFailing` |

## Phase D: AWS landing zone

| Step | Deliverable | Proof |
|---|---|---|
| D1 | GitHub Actions: `ci.yml` (ansible-lint, yamllint, terraform fmt/validate, tflint, trivy, gitleaks, promtool, alloy validate) and `terraform.yml` (plan on pull request, apply on `main` through the protected environment `aws-homepi`); OIDC provider, roles `ci-plan` (read + state) and `ci-apply`, trust limited to this repo and environment | A pull request shows a plan; apply waits for approval; a workflow from another branch is denied |
| D2 | Account `log-archive` (OU Security): organization trail from the management account, log file validation, bucket with Object Lock COMPLIANCE, readers restricted | A CloudTrail event from `homepi` is found in `log-archive`; deleting it is refused |
| D3 | Account `backup-vault`: replica bucket (versioning, Object Lock COMPLIANCE 30 days), replication from `homepi`, `restore-reader` permission set (SSO, read-only) | New backup replicated within minutes; a restore from the vault succeeds; `homepi` admin cannot read or delete the replica |
| D4 | SCPs on both OUs: Tokyo only (global services exempt), deny leaving the organization, protect CloudTrail, deny root in members, deny `s3:BypassGovernanceRetention` | Each rule tested with a call that must be denied |
| D5 | Primary backup bucket to Object Lock COMPLIANCE after 2 stable weeks (irreversible: explicit go required) | `get-object-lock-configuration` shows COMPLIANCE |
| D6 | Hygiene: root MFA on every account, budget alert, unused Settings projects closed, monthly cost check; GuardDuty 30-day trial optional | Billing shows the expected few dollars per month |

## Phase E: publish

| Step | Deliverable |
|---|---|
| E1 | `README.md`: what HomePi is, current vs target diagram, "what is real" table, how to rebuild, links to incidents and game days |
| E2 | Qiita 19 (Japanese): edge to cloud without long-lived keys: Roles Anywhere, dead man's switch, Object Lock, multi-account. Title aligned with reality (no IoT Core) |
| E3 | Qiita 20 (Japanese): GitOps on the edge, the 2026-11-01 incident report, game day 1 |
| E4 | Corrections in earlier articles: 2 (DNS path), 7 (alert delivery), 8 (Alloy labels) |
| E5 | Demo videos: dead man's switch (A3), full rebuild (C3) |

## Later

- NILM v1.2: training started from the dashboard, model returned to the Pi for inference.

## Expected AWS cost

S3 storage and replication for a few GB, an organization trail (first copy of management events is
free), one custom metric, one alarm, SNS e-mail: a few dollars per month at most. Checked monthly (D6).
