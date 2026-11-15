terraform {
  required_version = "~> 1.17.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.71.0"
    }
  }
  backend "s3" {
    key          = "vault/terraform.tfstate"
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

variable "backup_vault_account_id" {
  type        = string
  description = "Looked up by name by awsmgmt."
  validation {
    condition     = can(regex("^[0-9]{12}$", var.backup_vault_account_id))
    error_message = "Run awsmgmt after terraform/aws/org created the backup-vault account."
  }
}

variable "homepi_account_id" {
  type        = string
  description = "Source of the replication; looked up by name by awsmgmt."
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

# IAM Identity Center (restore-reader) lives in the management account
provider "aws" {
  region              = "ap-northeast-1"
  allowed_account_ids = [var.management_account_id]
  default_tags {
    tags = local.tags
  }
}

# The replica bucket lives in backup-vault (OrganizationAccountAccessRole: under the SCP)
provider "aws" {
  alias               = "vault"
  region              = "ap-northeast-1"
  allowed_account_ids = [var.backup_vault_account_id]
  assume_role {
    role_arn     = "arn:aws:iam::${var.backup_vault_account_id}:role/OrganizationAccountAccessRole"
    session_name = "terraform-vault"
  }
  default_tags {
    tags = local.tags
  }
}
