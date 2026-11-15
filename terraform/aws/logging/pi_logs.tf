# Security logs of the Pi (roadmap D2c): written every 5 minutes by the role homepi-edge-logs of the
# homepi account, which can only add objects under pi/. Object Lock: a shipped entry can be neither
# changed nor deleted for 30 days, even by an admin of log-archive (SCP), so a root attacker on the
# Pi can stop the shipping but not erase what already left the host.

locals {
  pi_logs_writer = "arn:aws:iam::${var.homepi_account_id}:role/homepi-edge-logs"
}

resource "aws_s3_bucket" "pi_logs" {
  provider            = aws.log_archive
  bucket              = "homepi-pi-logs-${var.log_archive_account_id}"
  object_lock_enabled = true
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "pi_logs" {
  provider = aws.log_archive
  bucket   = aws_s3_bucket.pi_logs.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "pi_logs" {
  provider                = aws.log_archive
  bucket                  = aws_s3_bucket.pi_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "pi_logs" {
  provider = aws.log_archive
  bucket   = aws_s3_bucket.pi_logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "pi_logs" {
  provider = aws.log_archive
  bucket   = aws_s3_bucket.pi_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_object_lock_configuration" "pi_logs" {
  provider = aws.log_archive
  bucket   = aws_s3_bucket.pi_logs.id
  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = 30
    }
  }
  depends_on = [aws_s3_bucket_versioning.pi_logs]
}

resource "aws_s3_bucket_lifecycle_configuration" "pi_logs" {
  provider = aws.log_archive
  bucket   = aws_s3_bucket.pi_logs.id
  rule {
    id     = "expire-after-one-year"
    status = "Enabled"
    filter {}
    expiration {
      days = 365
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 2
    }
  }
  depends_on = [aws_s3_bucket_versioning.pi_logs]
}

data "aws_iam_policy_document" "pi_logs" {
  statement {
    sid       = "PiShipsUnderPi"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.pi_logs.arn}/pi/*"]
    principals {
      type        = "AWS"
      identifiers = [local.pi_logs_writer]
    }
  }
  # Nothing else from homepi: no read, no list, no delete, for any principal of that account
  statement {
    sid       = "DenyHomepiExceptShipping"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.pi_logs.arn, "${aws_s3_bucket.pi_logs.arn}/*"]
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
      values   = [local.pi_logs_writer]
    }
  }
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.pi_logs.arn, "${aws_s3_bucket.pi_logs.arn}/*"]
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

resource "aws_s3_bucket_policy" "pi_logs" {
  provider   = aws.log_archive
  bucket     = aws_s3_bucket.pi_logs.id
  policy     = data.aws_iam_policy_document.pi_logs.json
  depends_on = [aws_s3_bucket_public_access_block.pi_logs]
}

output "pi_logs_bucket" {
  value = aws_s3_bucket.pi_logs.id
}
