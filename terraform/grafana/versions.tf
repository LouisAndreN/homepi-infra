terraform {
  required_version = "~> 1.17.0"

  required_providers {
    grafana = {
      source  = "grafana/grafana"
      version = "4.52.0"
    }
  }

  # The state path is given at init time: /var/lib/homepi-terraform on the Pi, a temporary file while developing
  backend "local" {}
}
