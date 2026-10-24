#!/usr/bin/env bash
set -euo pipefail
STEP_CA_URL="https://127.0.0.1:8443"
STEP_ROOT_CA="/etc/step-ca/certs/root_ca.crt"
CRL_DEST="/etc/mosquitto/crl/crl.pem"
LOG="/var/log/homepi/crl_sync.log"
mkdir -p "$(dirname "$CRL_DEST")" "$(dirname "$LOG")"
TMP_DER=$(mktemp /tmp/crl.XXXXXX.der)
TMP_PEM=$(mktemp /tmp/crl.XXXXXX.pem)
trap "rm -f $TMP_DER $TMP_PEM" EXIT
curl -sf --cacert "$STEP_ROOT_CA" "${STEP_CA_URL}/1.0/crl" -o "$TMP_DER"   || { echo "[$(date -u +%FT%TZ)] ERREUR download CRL" >> "$LOG"; exit 1; }
openssl crl -inform DER -in "$TMP_DER" -outform PEM -out "$TMP_PEM" 2>/dev/null
openssl crl -in "$TMP_PEM" -CAfile "$STEP_ROOT_CA" -noout 2>/dev/null   || { echo "[$(date -u +%FT%TZ)] ERREUR validation CRL" >> "$LOG"; exit 1; }
cp "$TMP_PEM" "$CRL_DEST"
chmod 644 "$CRL_DEST"
kill -HUP $(pidof mosquitto) 2>/dev/null || true
nginx -s reload 2>/dev/null || true
echo "[$(date -u +%FT%TZ)] CRL sync OK" >> "$LOG"
