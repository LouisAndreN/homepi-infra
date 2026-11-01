terraform {
  required_version = "~> 1.17.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.71.0"
    }
  }
  # State in the bucket this root created. The bucket name is passed by tfinit (scripts/lib.sh).
  backend "s3" {
    key          = "bootstrap/terraform.tfstate"
    region       = "ap-northeast-1"
    use_lockfile = true
    encrypt      = true
  }
}

variable "homepi_account_id" {
  type        = string
  description = "The homepi workload account. Set by awsenv from the SSO session, never stored in the repository."

  validation {
    condition     = can(regex("^[0-9]{12}$", var.homepi_account_id))
    error_message = "Run awsenv first: homepi_account_id must be a 12-digit account ID."
  }
}

provider "aws" {
  region = "ap-northeast-1"

  # Refuse to run against any other account, whatever profile is loaded
  allowed_account_ids = [var.homepi_account_id]

  default_tags {
    tags = {
      project    = "homepi"
      managed_by = "terraform"
      repository = "homepi-infra"
    }
  }
}
