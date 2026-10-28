# Dashboards built by hand in the Grafana UI before this repository existed.
# They are imported as they are, in the General folder. Once imported, the code is the source
# of truth: an edit made in the UI shows up as drift and is reverted by the next release.

import {
  to = grafana_dashboard.living_room
  id = "io2k8lp"
}

resource "grafana_dashboard" "living_room" {
  config_json = file("${path.module}/dashboards/io2k8lp.json")
}

import {
  to = grafana_dashboard.soc
  id = "ioxg69q"
}

resource "grafana_dashboard" "soc" {
  config_json = file("${path.module}/dashboards/ioxg69q.json")
}

import {
  to = grafana_dashboard.system_resources
  id = "iogjbsq"
}

resource "grafana_dashboard" "system_resources" {
  config_json = file("${path.module}/dashboards/iogjbsq.json")
}
