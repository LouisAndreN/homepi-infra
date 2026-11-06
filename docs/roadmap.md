# HomePi roadmap to v1

Target architecture: `docs/architecture/homepi-target-architecture-v1.drawio` (green = built and
verified, orange = the step below that delivers it).

Rules:
- A step is done only when its **proof** is obtained and recorded (command output, test, report).
- Every change goes through the repo: check mode clean (`failed=0`, expected changes only), signed
  tag, GitOps apply. No hand edit on the Pi without an entry in `docs/known-limits.md`.
- Irreversible decisions (Object Lock COMPLIANCE, deleting a volume, closing an account) need an
  explicit go after the preparation is reviewed.

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

| Step | Scope | Proof |
|---|---|---|
| B1 | `storage`: LVM layout as data (used by the restore), Loki moved to its own XFS volume (space taken from `lv-scratch`, recreated smaller) | `df -i /var` no longer contains Loki; Loki data intact after the move |
| B2 | `network`: nftables, hostapd, dnsmasq, NetBird settings | Check mode 0 change; IoT Wi-Fi and LAN rules unchanged (nft diff empty) |
| B3 | `pki_mqtt`: step-ca (`ca.json` with the `aws-edge` provisioner and its template, secrets in SOPS), Mosquitto (mTLS, ACL, CRL) | A device re-enrolls; a revoked certificate is refused |
| B4 | `influxdb`, `telegraf`: config, buckets, tasks as code (the downsampling task leaves `/tmp`) | The task exists after a restore; it appears in the InfluxDB export |
| B5 | `observability`: Loki config, Grafana `grafana.ini` and secret key in SOPS, Alertmanager config, Prometheus reloads instead of restarting | Rule change applied without a Prometheus restart |
| B6 | `access`: Nginx (one canonical name `homepi.internal`), Authelia (config, users in SOPS), CrowdSec (whitelists, bouncer, collections) | Login from LAN, tablet and NetBird; a CrowdSec test ban on a public IP works, never on LAN |
| B7 | `apps`: HomePi API, dashboard deployed from a build artifact (manifest fixed in the source), Hailo runtime | Dashboard installs as an app on Android with its icon |
| B8 | Hygiene: auditd rules reduced, Grafana Terraform state in S3, `homepi-audit` lists unmanaged files under `/etc` | `homepi-audit` reports no unmanaged service configuration; `known-limits.md` "not managed" list is empty |

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
