terraform {
  required_version = "~> 1.17.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.71.0"
    }
  }
  # First apply with local state, then `terraform init -migrate-state` into the bucket it created
  # (same path as terraform/aws/bootstrap). The bucket name is passed by tfinit_mgmt (scripts/lib.sh).
  backend "s3" {
    key          = "mgmt-bootstrap/terraform.tfstate"
    region       = "ap-northeast-1"
    use_lockfile = true
    encrypt      = true
  }
}

variable "management_account_id" {
  type        = string
  description = "The organization management account. Set by awsmgmt from the SSO session, never stored in the repository."

  validation {
    condition     = can(regex("^[0-9]{12}$", var.management_account_id))
    error_message = "Run awsmgmt first: management_account_id must be a 12-digit account ID."
  }
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
