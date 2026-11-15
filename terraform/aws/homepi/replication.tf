# Replication of every new backup version to backup-vault (roadmap D3). Two steps, because the vault
# bucket policy names this role and the replication rule needs the vault bucket:
#   1. backup_vault_account_id set, vault_replication_enabled = false: the role exists
#   2. terraform/aws/vault applied, then vault_replication_enabled = true: the rule is on
# Delete markers are not replicated: deleting in homepi never deletes the copy.

variable "backup_vault_account_id" {
  type        = string
  default     = ""
  description = "From SOPS (backup_vault_account_id), exported by awsenv. Empty: no replication resource."
}

# true since 2026-11-16 (vault applied): a plan without it would destroy the replication rule
variable "vault_replication_enabled" {
  type    = bool
  default = true
}

locals {
  vault_enabled = var.backup_vault_account_id != ""
  vault_bucket  = "homepi-backup-vault-${var.backup_vault_account_id}"
}

data "aws_iam_policy_document" "replication_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.homepi_account_id]
    }
  }
}

resource "aws_iam_role" "replication" {
  count              = local.vault_enabled ? 1 : 0
  name               = "homepi-backup-replication"
  description        = "S3 replication of the backup archives to backup-vault"
  assume_role_policy = data.aws_iam_policy_document.replication_trust.json
}

data "aws_iam_policy_document" "replication" {
  statement {
    sid       = "ReadSourceConfiguration"
    actions   = ["s3:GetReplicationConfiguration", "s3:ListBucket"]
    resources = [aws_s3_bucket.backups.arn]
  }
  statement {
    sid = "ReadSourceVersions"
    actions = [
      "s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectVersionTagging",
      "s3:GetObjectRetention", "s3:GetObjectLegalHold",
    ]
    resources = ["${aws_s3_bucket.backups.arn}/*"]
  }
  statement {
    sid       = "WriteReplicas"
    actions   = ["s3:ReplicateObject", "s3:ReplicateTags", "s3:ObjectOwnerOverrideToBucketOwner"]
    resources = ["arn:aws:s3:::${local.vault_bucket}/*"]
  }
}

resource "aws_iam_role_policy" "replication" {
  count  = local.vault_enabled ? 1 : 0
  name   = "replicate-backups-to-vault"
  role   = aws_iam_role.replication[0].id
  policy = data.aws_iam_policy_document.replication.json
}

resource "aws_s3_bucket_replication_configuration" "vault" {
  count  = local.vault_enabled && var.vault_replication_enabled ? 1 : 0
  role   = aws_iam_role.replication[0].arn
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "all-archives-to-vault"
    status = "Enabled"
    filter {}

    delete_marker_replication {
      status = "Disabled"
    }

    destination {
      bucket        = "arn:aws:s3:::${local.vault_bucket}"
      account       = var.backup_vault_account_id
      storage_class = "STANDARD"
      access_control_translation {
        owner = "Destination"
      }
    }
  }
  depends_on = [aws_s3_bucket_versioning.backups, aws_iam_role_policy.replication]
}
