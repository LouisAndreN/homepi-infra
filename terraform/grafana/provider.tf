variable "grafana_token" {
  type        = string
  sensitive   = true
  description = "Token of the Grafana service account named terraform (kept in ansible/secrets/grafana.sops.yaml)"
}

provider "grafana" {
  url  = "http://127.0.0.1:3000/grafana/"
  auth = var.grafana_token
}

# The data sources already exist: they are imported as they are, then managed.
import {
  to = grafana_data_source.influxdb
  id = "bfh82zffe42kge"
}

import {
  to = grafana_data_source.prometheus
  id = "efhfdmbjuoiyob"
}

import {
  to = grafana_data_source.loki
  id = "dfhoa91hjjpq8a"
}
