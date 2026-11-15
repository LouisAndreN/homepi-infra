# Service control policies (roadmap D4). They never apply to the management account. Attached to the
# two OUs, so every member account gets them. Each rule is tested with a call that must be denied.

data "aws_iam_policy_document" "guardrails" {
  # An account must not leave the organization (it would escape every policy below)
  statement {
    sid       = "DenyLeaveOrganization"
    effect    = "Deny"
    actions   = ["organizations:LeaveOrganization"]
    resources = ["*"]
  }

  # The root user of a member account is for break-glass through the management account only
  statement {
    sid       = "DenyMemberRoot"
    effect    = "Deny"
    actions   = ["*"]
    resources = ["*"]
    condition {
      test     = "StringLike"
      variable = "aws:PrincipalArn"
      values   = ["arn:aws:iam::*:root"]
    }
  }

  # Members cannot blind the audit: no stopping, deleting or reconfiguring trails
  statement {
    sid    = "ProtectCloudTrail"
    effect = "Deny"
    actions = [
      "cloudtrail:StopLogging",
      "cloudtrail:DeleteTrail",
      "cloudtrail:UpdateTrail",
      "cloudtrail:PutEventSelectors",
      "cloudtrail:PutInsightSelectors",
    ]
    resources = ["*"]
  }

  # Object Lock GOVERNANCE must hold against an account admin too
  statement {
    sid       = "DenyGovernanceBypass"
    effect    = "Deny"
    actions   = ["s3:BypassGovernanceRetention"]
    resources = ["*"]
  }

  # Tokyo only. Global services are exempt: their API endpoints live in us-east-1.
  statement {
    sid    = "DenyOutsideTokyo"
    effect = "Deny"
    not_actions = [
      "account:*", "aws-portal:*", "billing:*", "budgets:*", "ce:*", "cur:*", "freetier:*",
      "health:*", "iam:*", "organizations:*", "payments:*", "pricing:*", "route53:*",
      "route53domains:*", "sso:*", "sso-directory:*", "identitystore:*", "sts:*", "support:*",
      "tax:*", "trustedadvisor:*", "cloudfront:*", "waf:*", "shield:*", "globalaccelerator:*",
      "s3:GetAccountPublicAccessBlock", "s3:PutAccountPublicAccessBlock", "s3:ListAllMyBuckets",
      "notifications:*", "cost-optimization-hub:*",
    ]
    resources = ["*"]
    condition {
      test     = "StringNotEquals"
      variable = "aws:RequestedRegion"
      values   = ["ap-northeast-1"]
    }
  }
}

resource "aws_organizations_policy" "guardrails" {
  name        = "homepi-guardrails"
  description = "Member accounts: stay in the organization, no root, CloudTrail untouched, no Object Lock bypass, Tokyo only"
  type        = "SERVICE_CONTROL_POLICY"
  content     = data.aws_iam_policy_document.guardrails.json
}

resource "aws_organizations_policy_attachment" "guardrails_workloads" {
  policy_id = aws_organizations_policy.guardrails.id
  target_id = local.workloads_ou_id
}

resource "aws_organizations_policy_attachment" "guardrails_security" {
  policy_id = aws_organizations_policy.guardrails.id
  target_id = aws_organizations_organizational_unit.security.id
}
