resource "grafana_data_source" "influxdb" {
  uid         = "bfh82zffe42kge"
  name        = "influxdb"
  type        = "influxdb"
  url         = "http://localhost:8086"
  access_mode = "proxy"
  is_default  = true

  # Basic auth was on with an empty user name, a leftover: Flux queries authenticate with the
  # InfluxDB token. Turned off after a test query through the Grafana API, before and after.
  basic_auth_enabled = false

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
