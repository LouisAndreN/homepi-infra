# Centralized root access (roadmap D6): member accounts need no root credentials at all. The
# management account can remove them, and open a short root session (sts:AssumeRoot) restricted to
# an AWS task policy when a root-only action is needed. Requires trusted access for
# iam.amazonaws.com (docs/runbooks/aws-org.md).
resource "aws_iam_organizations_features" "root_access" {
  enabled_features = ["RootCredentialsManagement", "RootSessions"]
}
