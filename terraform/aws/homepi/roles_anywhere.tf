# The Pi authenticates to AWS with an X.509 certificate issued by its own step-ca and receives
# temporary credentials. No long-lived AWS key exists on the Pi.

resource "aws_rolesanywhere_trust_anchor" "step_ca" {
  name    = "homepi-step-ca-intermediate"
  enabled = true

  source {
    source_type = "CERTIFICATE_BUNDLE"
    source_data {
      # Public certificate of the step-ca intermediate; it also signs the sensor certificates,
      # so the role trust policy below filters on the certificate common name.
      x509_certificate_data = file("${path.module}/pki/intermediate_ca.crt")
    }
  }
}

data "aws_iam_policy_document" "edge_writer_trust" {
  statement {
    sid     = "RolesAnywhereFromStepCaOnly"
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:TagSession", "sts:SetSourceIdentity"]

    principals {
      type        = "Service"
      identifiers = ["rolesanywhere.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_rolesanywhere_trust_anchor.step_ca.arn]
    }
    # Only the dedicated backup certificate, never a sensor certificate from the same CA
    condition {
      test     = "StringEquals"
      variable = "aws:PrincipalTag/x509Subject/CN"
      values   = ["homepi-backup"]
    }
  }
}

resource "aws_iam_role" "edge_writer" {
  name                 = "homepi-edge-writer"
  description          = "Write-only access for the Pi: uploads backup archives, cannot read, list or delete"
  assume_role_policy   = data.aws_iam_policy_document.edge_writer_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "edge_writer_permissions" {
  statement {
    sid     = "UploadBackupsOnly"
    effect  = "Allow"
    actions = ["s3:PutObject"]
    resources = [
      "${aws_s3_bucket.backups.arn}/state/*",
      "${aws_s3_bucket.backups.arn}/influx-lp/*",
      "${aws_s3_bucket.backups.arn}/influx-native/*",
      "${aws_s3_bucket.backups.arn}/influx-delta/*",
    ]
  }
}

resource "aws_iam_role_policy" "edge_writer" {
  name   = "upload-backups-only"
  role   = aws_iam_role.edge_writer.id
  policy = data.aws_iam_policy_document.edge_writer_permissions.json
}

resource "aws_rolesanywhere_profile" "edge_writer" {
  name    = "homepi-edge-writer"
  enabled = true
  # One profile for the Pi's roles; named after the first one (renaming it would replace it)
  role_arns        = concat([aws_iam_role.edge_writer.arn, aws_iam_role.edge_heartbeat.arn], aws_iam_role.edge_logs[*].arn)
  duration_seconds = 3600
}

# The Pi needs these three ARNs; they contain the account ID and are written to the Pi by Ansible later
output "edge_writer" {
  value = {
    trust_anchor_arn = aws_rolesanywhere_trust_anchor.step_ca.arn
    profile_arn      = aws_rolesanywhere_profile.edge_writer.arn
    role_arn         = aws_iam_role.edge_writer.arn
  }
}
