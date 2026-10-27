resource "grafana_dashboard" "gitops_status" {
  folder      = grafana_folder.homepi.uid
  config_json = file("${path.module}/dashboards/gitops-status.json")
  overwrite   = true
}
