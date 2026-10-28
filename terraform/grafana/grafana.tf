resource "grafana_data_source" "influxdb" {
  uid         = "bfh82zffe42kge"
  name        = "influxdb"
  type        = "influxdb"
  url         = "http://localhost:8086"
  access_mode = "proxy"
  is_default  = true

  # Observed in production: basic auth is on with an empty user name. Kept as is by the import;
  # it is changed in a separate commit once a query has been tested without it.
  basic_auth_enabled = true

  json_data_encoded = jsonencode({
    defaultBucket = "iot-hot"
    httpMode      = "POST"
    organization  = "iot-org"
    pdcInjected   = false
    tlsSkipVerify = true
    version       = "Flux"
  })
}

resource "grafana_data_source" "prometheus" {
  uid         = "efhfdmbjuoiyob"
  name        = "prometheus"
  type        = "prometheus"
  url         = "http://localhost:9090"
  access_mode = "proxy"
  is_default  = false

  json_data_encoded = jsonencode({
    exemplarTraceIdDestinations = []
    httpMethod                  = "POST"
    pdcInjected                 = false
    tlsSkipVerify               = false
  })
}

resource "grafana_data_source" "loki" {
  uid         = "dfhoa91hjjpq8a"
  name        = "loki"
  type        = "loki"
  url         = "http://localhost:3100"
  access_mode = "proxy"
  is_default  = false

  json_data_encoded = jsonencode({
    derivedFields = [{
      matcherRegex    = "SRC=([\\d.]+)"
      matcherType     = "regex"
      name            = "src_ip"
      url             = ""
      urlDisplayLabel = ""
    }]
    pdcInjected = false
  })
}

resource "grafana_folder" "homepi" {
  uid   = "homepi"
  title = "HomePi"
}
