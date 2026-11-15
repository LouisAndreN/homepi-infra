# Organization layout (roadmap phase D, article 22):
#   root
#   ├── management (louis-management: billing, Organizations, IAM Identity Center, organization trail)
#   ├── OU Workloads ── homepi        (the Pi's backups, heartbeat, Roles Anywhere; created by hand)
#   └── OU Security  ── log-archive   (organization CloudTrail, Object Lock)
#                    └─ backup-vault  (replica of the backups, unreachable from homepi)
# The management account and the homepi account existed before this root: they are read, not managed.

data "aws_organizations_organization" "this" {}

data "aws_organizations_organizational_units" "root" {
  parent_id = data.aws_organizations_organization.this.roots[0].id
}

locals {
  root_id         = data.aws_organizations_organization.this.roots[0].id
  workloads_ou_id = one([for ou in data.aws_organizations_organizational_units.root.children : ou.id if ou.name == "Workloads"])
}

resource "aws_organizations_organizational_unit" "security" {
  name      = "Security"
  parent_id = local.root_id
}

# Closing an account takes 90 days: never destroyed by Terraform. OrganizationAccountAccessRole lets
# the management account administer it (the only way in until Identity Center assignments exist).
resource "aws_organizations_account" "log_archive" {
  name              = "log-archive"
  email             = var.log_archive_email
  parent_id         = aws_organizations_organizational_unit.security.id
  role_name         = "OrganizationAccountAccessRole"
  close_on_deletion = false

  lifecycle {
    prevent_destroy = true
    # The API never returns role_name, and an e-mail change is done in the account itself
    ignore_changes = [role_name, email]
  }
}

resource "aws_organizations_account" "backup_vault" {
  name              = "backup-vault"
  email             = var.backup_vault_email
  parent_id         = aws_organizations_organizational_unit.security.id
  role_name         = "OrganizationAccountAccessRole"
  close_on_deletion = false

  lifecycle {
    prevent_destroy = true
    ignore_changes  = [role_name, email]
  }
}

output "log_archive_account_id" {
  value = aws_organizations_account.log_archive.id
}

output "backup_vault_account_id" {
  value = aws_organizations_account.backup_vault.id
}

output "security_ou_id" {
  value = aws_organizations_organizational_unit.security.id
}

output "workloads_ou_id" {
  value = local.workloads_ou_id
}
