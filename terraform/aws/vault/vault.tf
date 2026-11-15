# backup-vault (roadmap D3, article 22): a copy of every backup archive that no identity of the homepi
# account can read, overwrite or delete. Written only by S3 replication from homepi (role
# homepi-backup-replication, terraform/aws/homepi/replication.tf); read only through the SSO
# permission set restore-reader. Deletions are not replicated: wiping homepi leaves the copy intact.

locals {
  vault_bucket     = "homepi-backup-vault-${var.backup_vault_account_id}"
  replication_role = "arn:aws:iam::${var.homepi_account_id}:role/homepi-backup-replication"
}

resource "aws_s3_bucket" "vault" {
  provider            = aws.vault
  bucket              = local.vault_bucket
  object_lock_enabled = true
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "vault" {
  provider = aws.vault
  bucket   = aws_s3_bucket.vault.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "vault" {
  provider                = aws.vault
  bucket                  = aws_s3_bucket.vault.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "vault" {
  provider = aws.vault
  bucket   = aws_s3_bucket.vault.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "vault" {
  provider = aws.vault
  bucket   = aws_s3_bucket.vault.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_object_lock_configuration" "vault" {
  provider = aws.vault
  bucket   = aws_s3_bucket.vault.id
  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = 30
    }
  }
  depends_on = [aws_s3_bucket_versioning.vault]
}

# Same windows as the source bucket: state 90 days, InfluxDB backups 35 days
resource "aws_s3_bucket_lifecycle_configuration" "vault" {
  provider = aws.vault
  bucket   = aws_s3_bucket.vault.id
  rule {
    id     = "state-archives-90-days"
    status = "Enabled"
    filter {
      prefix = "state/"
    }
    expiration {
      days = 90
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }
  rule {
    id     = "influx-backups-35-days"
    status = "Enabled"
    filter {
      prefix = "influx-"
    }
    expiration {
      days = 35
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }
  depends_on = [aws_s3_bucket_versioning.vault]
}

data "aws_iam_policy_document" "vault" {
  # Only the replication role of homepi may write, and only replicas (never a plain PutObject)
  statement {
    sid       = "ReplicationWrites"
    actions   = ["s3:ReplicateObject", "s3:ReplicateTags", "s3:ObjectOwnerOverrideToBucketOwner"]
    resources = ["${aws_s3_bucket.vault.arn}/*"]
    principals {
      type        = "AWS"
      identifiers = [local.replication_role]
    }
  }
  statement {
    sid       = "ReplicationBucketChecks"
    actions   = ["s3:GetBucketVersioning", "s3:PutBucketVersioning"]
    resources = [aws_s3_bucket.vault.arn]
    principals {
      type        = "AWS"
      identifiers = [local.replication_role]
    }
  }
  # Nothing from homepi but replication: its admins and the Pi's roles are denied outright
  statement {
    sid       = "DenyHomepiExceptReplication"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.vault.arn, "${aws_s3_bucket.vault.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:PrincipalAccount"
      values   = [var.homepi_account_id]
    }
    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values   = [local.replication_role]
    }
  }
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.vault.arn, "${aws_s3_bucket.vault.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "vault" {
  provider   = aws.vault
  bucket     = aws_s3_bucket.vault.id
  policy     = data.aws_iam_policy_document.vault.json
  depends_on = [aws_s3_bucket_public_access_block.vault]
}

# Read-only access for a restore (R0 when homepi is lost), through IAM Identity Center
data "aws_ssoadmin_instances" "this" {}

locals {
  sso_instance_arn  = tolist(data.aws_ssoadmin_instances.this.arns)[0]
  identity_store_id = tolist(data.aws_ssoadmin_instances.this.identity_store_ids)[0]
}

data "aws_identitystore_user" "louis" {
  identity_store_id = local.identity_store_id
  alternate_identifier {
    unique_attribute {
      attribute_path  = "UserName"
      attribute_value = "louis"
    }
  }
}

resource "aws_ssoadmin_permission_set" "restore_reader" {
  name             = "restore-reader"
  description      = "Read the backup replicas in backup-vault, nothing else"
  instance_arn     = local.sso_instance_arn
  session_duration = "PT1H"
}

data "aws_iam_policy_document" "restore_reader" {
  statement {
    sid       = "ListVault"
    actions   = ["s3:ListBucket", "s3:ListBucketVersions", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.vault.arn]
  }
  statement {
    sid       = "ReadReplicas"
    actions   = ["s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectAttributes", "s3:GetObjectVersionAttributes"]
    resources = ["${aws_s3_bucket.vault.arn}/*"]
  }
}

resource "aws_ssoadmin_permission_set_inline_policy" "restore_reader" {
  instance_arn       = local.sso_instance_arn
  permission_set_arn = aws_ssoadmin_permission_set.restore_reader.arn
  inline_policy      = data.aws_iam_policy_document.restore_reader.json
}

resource "aws_ssoadmin_account_assignment" "restore_reader" {
  instance_arn       = local.sso_instance_arn
  permission_set_arn = aws_ssoadmin_permission_set.restore_reader.arn
  principal_type     = "USER"
  principal_id       = data.aws_identitystore_user.louis.user_id
  target_type        = "AWS_ACCOUNT"
  target_id          = var.backup_vault_account_id
  depends_on         = [aws_ssoadmin_permission_set_inline_policy.restore_reader]
}

output "vault_bucket" {
  value = aws_s3_bucket.vault.id
}
