#!/bin/bash
set -euo pipefail
OUT=/var/lib/node_exporter/textfile_collector/homepi_netbird.prom
TMP="${OUT}.tmp"

STATUS_JSON=$(netbird status --json)

{
  echo "# HELP homepi_netbird_peer_connected 1 if peer is Connected, 0 otherwise"
  echo "# TYPE homepi_netbird_peer_connected gauge"
  echo "$STATUS_JSON" | python3 -c '
import json, sys
data = json.load(sys.stdin)
for p in data["peers"]["details"]:
    fqdn = p["fqdn"]
    connected = 1 if p["status"] == "Connected" else 0
    print(f"homepi_netbird_peer_connected{{peer=\"{fqdn}\"}} {connected}")
'
} > "$TMP"
mv "$TMP" "$OUT"
