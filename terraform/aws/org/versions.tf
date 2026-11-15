terraform {
  required_version = "~> 1.17.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.71.0"
    }
  }
  # State in the management account (terraform/aws/mgmt-bootstrap); bucket passed by tfinit_mgmt
  backend "s3" {
    key          = "org/terraform.tfstate"
    region       = "ap-northeast-1"
    use_lockfile = true
    encrypt      = true
  }
}

variable "management_account_id" {
  type        = string
  description = "The organization management account. Set by awsmgmt, never stored in the repository."

  validation {
    condition     = can(regex("^[0-9]{12}$", var.management_account_id))
    error_message = "Run awsmgmt first: management_account_id must be a 12-digit account ID."
  }
}

# Root e-mail addresses of the new accounts: in SOPS (ansible/secrets/aws.sops.yaml), passed by
# awsmgmt through the environment, never in the repository
variable "log_archive_email" {
  type      = string
  sensitive = true
}

variable "backup_vault_email" {
  type      = string
  sensitive = true
}

# Budget notifications (same address as the heartbeat alarm, from SOPS through awsmgmt)
variable "alert_email" {
  type      = string
  sensitive = true
}

provider "aws" {
  region              = "ap-northeast-1"
  allowed_account_ids = [var.management_account_id]

  default_tags {
    tags = {
      project    = "homepi"
      managed_by = "terraform"
      repository = "homepi-infra"
    }
  }
}
