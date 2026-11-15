# Organization CloudTrail (roadmap D2b, article 22): every management event of every account and
# region, delivered to a bucket in log-archive that no workload account can reach. Management events
# only: the first copy is free; storage is a few cents a month.

variable "trail_lock_days" {
  type        = number
  default     = 7
  description = "Object Lock GOVERNANCE retention of each log file: 7 days while testing, then 90."
}

data "aws_organizations_organization" "this" {}

locals {
  trail_name = "homepi-org-trail"
  trail_arn  = "arn:aws:cloudtrail:ap-northeast-1:${var.management_account_id}:trail/${local.trail_name}"
  org_id     = data.aws_organizations_organization.this.id
}

resource "aws_s3_bucket" "trail" {
  provider            = aws.log_archive
  bucket              = "homepi-cloudtrail-${var.log_archive_account_id}"
  object_lock_enabled = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "trail" {
  provider = aws.log_archive
  bucket   = aws_s3_bucket.trail.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "trail" {
  provider                = aws.log_archive
  bucket                  = aws_s3_bucket.trail.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "trail" {
  provider = aws.log_archive
  bucket   = aws_s3_bucket.trail.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "trail" {
  provider = aws.log_archive
  bucket   = aws_s3_bucket.trail.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_object_lock_configuration" "trail" {
  provider = aws.log_archive
  bucket   = aws_s3_bucket.trail.id
  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = var.trail_lock_days
    }
  }
  depends_on = [aws_s3_bucket_versioning.trail]
}

# One year of logs, then gone; superseded versions (none expected) after 30 days
resource "aws_s3_bucket_lifecycle_configuration" "trail" {
  provider = aws.log_archive
  bucket   = aws_s3_bucket.trail.id
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
      days_after_initiation = 7
    }
  }
  depends_on = [aws_s3_bucket_versioning.trail]
}

# Only CloudTrail, only for this trail (aws:SourceArn), only under AWSLogs/; TLS only
data "aws_iam_policy_document" "trail_bucket" {
  statement {
    sid       = "CloudTrailAclCheck"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.trail.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }
  }
  statement {
    sid     = "CloudTrailWrite"
    actions = ["s3:PutObject"]
    resources = [
      "${aws_s3_bucket.trail.arn}/AWSLogs/${var.management_account_id}/*",
      "${aws_s3_bucket.trail.arn}/AWSLogs/${local.org_id}/*",
    ]
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
  }
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.trail.arn, "${aws_s3_bucket.trail.arn}/*"]
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

resource "aws_s3_bucket_policy" "trail" {
  provider   = aws.log_archive
  bucket     = aws_s3_bucket.trail.id
  policy     = data.aws_iam_policy_document.trail_bucket.json
  depends_on = [aws_s3_bucket_public_access_block.trail]
}

resource "aws_cloudtrail" "org" {
  name                          = local.trail_name
  s3_bucket_name                = aws_s3_bucket.trail.id
  is_organization_trail         = true
  is_multi_region_trail         = true
  include_global_service_events = true
  enable_log_file_validation    = true
  depends_on                    = [aws_s3_bucket_policy.trail]
}

output "trail_bucket" {
  value = aws_s3_bucket.trail.id
}
