terraform {
  required_version = "~> 1.17.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.71.0"
    }
  }
  backend "s3" {
    key          = "logging/terraform.tfstate"
    region       = "ap-northeast-1"
    use_lockfile = true
    encrypt      = true
  }
}

variable "management_account_id" {
  type = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.management_account_id))
    error_message = "Run awsmgmt first."
  }
}

variable "log_archive_account_id" {
  type        = string
  description = "Looked up by name by awsmgmt (created by terraform/aws/org)."
  validation {
    condition     = can(regex("^[0-9]{12}$", var.log_archive_account_id))
    error_message = "Run awsmgmt after terraform/aws/org created the log-archive account."
  }
}

variable "homepi_account_id" {
  type        = string
  description = "Writer of the Pi logs bucket (role homepi-edge-logs); looked up by name by awsmgmt."
  validation {
    condition     = can(regex("^[0-9]{12}$", var.homepi_account_id))
    error_message = "Run awsmgmt first."
  }
}

locals {
  tags = {
    project    = "homepi"
    managed_by = "terraform"
    repository = "homepi-infra"
  }
}

# The organization trail lives in the management account
provider "aws" {
  region              = "ap-northeast-1"
  allowed_account_ids = [var.management_account_id]
  default_tags {
    tags = local.tags
  }
}

# Its bucket lives in log-archive, reached through the role Organizations created there
# (a role of the member account: every guardrail of the SCP applies to it)
provider "aws" {
  alias               = "log_archive"
  region              = "ap-northeast-1"
  allowed_account_ids = [var.log_archive_account_id]
  assume_role {
    role_arn     = "arn:aws:iam::${var.log_archive_account_id}:role/OrganizationAccountAccessRole"
    session_name = "terraform-logging"
  }
  default_tags {
    tags = local.tags
  }
}
