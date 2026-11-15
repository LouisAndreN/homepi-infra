# Security logs of the Pi shipped off the host every 5 minutes into log-archive (roadmap D2c).
# The role can only add new objects under pi/ in that bucket: no read, no list, no delete.
# Empty log_archive_account_id (awsenv reads it from SOPS): nothing is created.

variable "log_archive_account_id" {
  type        = string
  default     = ""
  description = "From SOPS (log_archive_account_id), exported by awsenv."
}

locals {
  logship_enabled = var.log_archive_account_id != ""
  logship_bucket  = "homepi-pi-logs-${var.log_archive_account_id}"
}

resource "aws_iam_role" "edge_logs" {
  count                = local.logship_enabled ? 1 : 0
  name                 = "homepi-edge-logs"
  description          = "Write-only shipping of the Pi security logs to log-archive"
  assume_role_policy   = data.aws_iam_policy_document.edge_writer_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "edge_logs" {
  statement {
    sid       = "ShipLogsOnly"
    actions   = ["s3:PutObject"]
    resources = ["arn:aws:s3:::${local.logship_bucket}/pi/*"]
  }
}

resource "aws_iam_role_policy" "edge_logs" {
  count  = local.logship_enabled ? 1 : 0
  name   = "ship-logs-only"
  role   = aws_iam_role.edge_logs[0].id
  policy = data.aws_iam_policy_document.edge_logs.json
}
