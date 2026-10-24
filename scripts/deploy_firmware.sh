#!/bin/bash
set -e
VERSION="$1"
[ -z "$VERSION" ] && echo "Usage: $0 <version>" && exit 1
BIN="~/homepi-firmware/homepi_sensor/build/homepi_sensor.bin"
DEST="/opt/homepi/firmware/v${VERSION}.bin"
cp "$BIN" "$DEST"
SHA=$(sha256sum "$DEST" | awk '{print $1}')
echo "$SHA" > "${DEST}.sha256"
echo "URL:    https://homepi.internal/fw/v${VERSION}.bin"
echo "SHA256: $SHA"
