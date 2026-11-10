# Off-site copy of the age-encrypted backups. The archives are already encrypted on the Pi;
# Object Lock makes every uploaded version undeletable during its retention period.

variable "backup_lock_mode" {
  type        = string
  default     = "GOVERNANCE"
  description = "GOVERNANCE while testing (an admin can bypass it), then COMPLIANCE (nobody can delete before expiry)."

  validation {
    condition     = contains(["GOVERNANCE", "COMPLIANCE"], var.backup_lock_mode)
    error_message = "backup_lock_mode must be GOVERNANCE or COMPLIANCE."
  }
}

resource "aws_s3_bucket" "backups" {
  bucket              = "homepi-backups-${var.homepi_account_id}"
  object_lock_enabled = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket                  = aws_s3_bucket.backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_object_lock_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    default_retention {
      mode = var.backup_lock_mode
      days = 30
    }
  }

  depends_on = [aws_s3_bucket_versioning.backups]
}

# Locked versions cannot expire before their retention ends; these rules only clean up afterwards
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

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

  # A portable InfluxDB export is about 300 MB: keep five weeks only
  rule {
    id     = "influx-exports-35-days"
    status = "Enabled"
    filter {
      prefix = "influx-lp/"
    }
    expiration {
      days = 35
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  # A native InfluxDB backup (metadata, tokens and shards) is about 235 MB: keep five weeks
  rule {
    id     = "influx-native-35-days"
    status = "Enabled"
    filter {
      prefix = "influx-native/"
    }
    expiration {
      days = 35
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 2
    }
  }

  depends_on = [aws_s3_bucket_versioning.backups]
}

data "aws_iam_policy_document" "backups_tls_only" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.backups.arn,
      "${aws_s3_bucket.backups.arn}/*",
    ]
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

resource "aws_s3_bucket_policy" "backups" {
  bucket     = aws_s3_bucket.backups.id
  policy     = data.aws_iam_policy_document.backups_tls_only.json
  depends_on = [aws_s3_bucket_public_access_block.backups]
}
