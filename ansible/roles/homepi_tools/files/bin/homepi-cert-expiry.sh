#!/bin/bash
set -euo pipefail

OUT=/var/lib/node_exporter/textfile_collector/homepi_cert_expiry.prom
TMP="${OUT}.tmp"

declare -A CERTS=(
  [root_ca]="/etc/step-ca/certs/root_ca.crt"
  [intermediate_ca]="/etc/step-ca/certs/intermediate_ca.crt"
  [nginx_primary]="/etc/nginx/ssl/homepi.fullchain.pem"
  [nginx_wildcard]="/etc/nginx/ssl/wildcard.homepi.fullchain.pem"
)

{
  echo "# HELP homepi_cert_expiry_days Days until certificate expiry"
  echo "# TYPE homepi_cert_expiry_days gauge"
  for name in "${!CERTS[@]}"; do
    path="${CERTS[$name]}"
    if [ ! -f "$path" ]; then
      echo "# WARN cert not found: $path" >&2
      continue
    fi
    exp=$(openssl x509 -in "$path" -noout -enddate | cut -d= -f2)
    days=$(( ($(date -d "$exp" +%s) - $(date +%s)) / 86400 ))
    echo "homepi_cert_expiry_days{cert=\"${name}\"} ${days}"
  done
} > "$TMP"

mv "$TMP" "$OUT"
