# AWS organization (roadmap phase D, article 22)

Target: four accounts. `louis-management` (billing, Organizations, IAM Identity Center, organization
trail), `homepi` in OU Workloads (backups, heartbeat, Roles Anywhere), `log-archive` and
`backup-vault` in OU Security. Applied from the laptop; CI apply (D1) waits for the public
repository, because GitHub enforces required reviewers on environments of private repositories
only on GitHub Enterprise.

Terraform roots and their state:

| Root | Account | State |
|---|---|---|
| `terraform/aws/bootstrap` | homepi | `homepi-tfstate-<homepi>` |
| `terraform/aws/homepi` | homepi | same bucket |
| `terraform/aws/mgmt-bootstrap` | management | `homepi-tfstate-<management>` (its own bucket) |
| `terraform/aws/org` | management | same bucket |

The organization state lives in the management account: an admin of a workload account must not be
able to rewrite it.

## D0: access to the management account (once, by hand)

1. IAM Identity Center (Tokyo) > AWS accounts > `louis-management` > Assign users: `louis`,
   permission set `AdministratorAccess`.
2. Laptop: `aws configure sso --profile homepi-mgmt` (same start URL and region as `homepi-admin`,
   choose the management account, region `ap-northeast-1`, output `json`).
3. `. scripts/lib.sh; awsmgmt` must refuse until the two e-mail addresses are in SOPS, and say the
   profile points at the management account.

## D0b: root e-mail addresses of the new accounts (SOPS)

Two addresses that receive mail (Gmail `+` aliases work), each unique across AWS. They are personal
data: SOPS only (`log_archive_email`, `backup_vault_email` in `ansible/secrets/aws.sops.yaml`).

## D0c: service control policies enabled (reversible)

    aws organizations enable-policy-type --root-id <root> --policy-type SERVICE_CONTROL_POLICY

`FullAWSAccess` stays attached everywhere: the guardrails are deny statements on top of it.

## D1: management state bucket (`terraform/aws/mgmt-bootstrap`)

First apply with a local state (a temporary `backend_override.tf` with `backend "local" {}`),
then remove the override and `tfinit_mgmt -migrate-state`. Same path as `terraform/aws/bootstrap`.

## D2a: OU Security, the two accounts, the guardrails (`terraform/aws/org`)

`plan` must show exactly: 1 OU, 2 accounts, 1 policy, 2 attachments, nothing changed or destroyed.
The accounts are never destroyed by Terraform (`prevent_destroy`; closing an account takes 90 days).

Guardrails on both OUs (never on the management account, by AWS design):

| Rule | Test (must be denied, from a member account) |
|---|---|
| Stay in the organization | `aws organizations leave-organization` |
| No root user | sign-in as root of a member account and any call |
| CloudTrail untouched | `aws cloudtrail stop-logging` on any trail |
| No Object Lock bypass | `aws s3api delete-object --bypass-governance-retention` on a locked version in homepi |
| Tokyo only | `aws s3api list-objects-v2 --region us-west-2` on any bucket |

After attaching to Workloads, the Pi's paths must still work: off-site upload (S3 PutObject through
Roles Anywhere) and the heartbeat (CloudWatch PutMetricData), both in Tokyo. Check
`homepi_offsite_upload_success` and the CloudWatch alarm in the hour after.

Object Lock stays in GOVERNANCE everywhere (owner decision 2026-11-16, replaces the COMPLIANCE plan
of D5). With `DenyGovernanceBypass` on both OUs, no identity of a member account can shorten a
retention or delete a locked version: not its admins, not `OrganizationAccountAccessRole` (a role of
the member account, so under the SCP), not its root (denied too). The only way is from the
management account: detach the SCP first, which CloudTrail records. That is the break-glass that
COMPLIANCE would not leave: a mistaken retention can still be corrected, deliberately and visibly.

## Next

D2b organization trail into `log-archive` (Object Lock GOVERNANCE 7 days, then GOVERNANCE 90 days), D3 `backup-vault` replica with replication from `homepi`,
D2c the Pi's security logs off the host into `log-archive` (C1 decision: logs are not backed up,
they are shipped), D6 hygiene.
