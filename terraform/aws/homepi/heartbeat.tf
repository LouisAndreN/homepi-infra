# Dead man's switch. Alertmanager sends its always-firing Watchdog alert to a relay on the Pi every
# 5 minutes; the relay publishes one heartbeat with the edge-heartbeat role. No heartbeat for 15 minutes
# means the alerting chain is broken somewhere (Pi off, disk or inodes full, DNS, Prometheus,
# Alertmanager, network, aws-edge certificate), and the alarm e-mails from outside the Pi.

variable "alert_email" {
  type        = string
  sensitive   = true
  description = "Receives the heartbeat alarm. Decrypted from ansible/secrets/aws.sops.yaml by the caller, never stored in the repository."

  validation {
    condition     = can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[a-z]{2,}$", var.alert_email))
    error_message = "alert_email must be an e-mail address (export TF_VAR_alert_email from SOPS)."
  }
}

locals {
  heartbeat_namespace = "HomePi"
  heartbeat_metric    = "WatchdogHeartbeat"
}

# Same trust as edge-writer: step-ca trust anchor and the homepi-backup certificate only
resource "aws_iam_role" "edge_heartbeat" {
  name                 = "homepi-edge-heartbeat"
  description          = "Publishes the HomePi heartbeat metric only"
  assume_role_policy   = data.aws_iam_policy_document.edge_writer_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "edge_heartbeat_permissions" {
  statement {
    sid     = "PublishHeartbeatOnly"
    effect  = "Allow"
    actions = ["cloudwatch:PutMetricData"]
    # PutMetricData has no resource ARN; the namespace condition is the restriction
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = [local.heartbeat_namespace]
    }
  }
}

resource "aws_iam_role_policy" "edge_heartbeat" {
  name   = "publish-heartbeat-only"
  role   = aws_iam_role.edge_heartbeat.id
  policy = data.aws_iam_policy_document.edge_heartbeat_permissions.json
}

# Not encrypted with KMS: CloudWatch alarms cannot publish to a topic encrypted with the AWS managed
# SNS key, and the messages hold no secret
resource "aws_sns_topic" "alerts" {
  name = "homepi-alerts"
}

data "aws_iam_policy_document" "alerts_topic" {
  statement {
    sid       = "CloudWatchAlarmsOfThisAccountOnly"
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]
    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.homepi_account_id]
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.alerts_topic.json
}

# Pending until the link in the confirmation e-mail is clicked
resource "aws_sns_topic_subscription" "alert_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "heartbeat_missing" {
  alarm_name          = "homepi-heartbeat-missing"
  alarm_description   = "No Watchdog heartbeat from the HomePi alerting chain for 15 minutes. Check that the Pi is on, then disk and inodes, DNS, Prometheus, Alertmanager, the network and the aws-edge certificate."
  namespace           = local.heartbeat_namespace
  metric_name         = local.heartbeat_metric
  dimensions          = { host = "homepi" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

output "heartbeat" {
  value = {
    role_arn  = aws_iam_role.edge_heartbeat.arn
    alarm     = aws_cloudwatch_metric_alarm.heartbeat_missing.alarm_name
    topic_arn = aws_sns_topic.alerts.arn
  }
}
