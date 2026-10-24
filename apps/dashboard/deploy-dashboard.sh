#!/bin/bash
set -e

DEPLOY_DIR="/opt/homepi-dashboard"
WEB_DIR="/var/www/homepi-dashboard"
ZIP="/home/srvpi/homepi-dashboard.zip"

# Couleurs
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
die()  { echo -e "${RED}✗${NC} $1"; exit 1; }

echo "━━━ HomePi Dashboard Deploy ━━━"

# 1. Vérifier le zip
[ -f "$ZIP" ] || die "homepi-dashboard.zip introuvable dans $HOME — copie-le d'abord via scp"
ok "ZIP trouvé : $ZIP"

# 2. Extraire
TMP=$(mktemp -d)
unzip -q "$ZIP" -d "$TMP"
ok "ZIP extrait"

# 3. Sync sources (sans node_modules ni dist)
rsync -a --exclude=node_modules --exclude=dist "$TMP/" "$DEPLOY_DIR/"
rm -rf "$TMP"
ok "Sources synchronisées"

# 4. npm install si package.json a changé
cd "$DEPLOY_DIR"
npm install --silent
ok "Dépendances installées"

# 5. Build avec timestamp pour invalider le SW cache
BUILD_TIME=$(date +%s)
sed -i "s/const CACHE = 'homepi-[^']*'/const CACHE = 'homepi-$BUILD_TIME'/" public/sw.js
npm run build --silent
ok "Build production (cache: homepi-$BUILD_TIME)"

# 6. Deploy vers Nginx
rsync -a --delete dist/ "$WEB_DIR/"
cp public/site.webmanifest public/sw.js "$WEB_DIR/"

# Icônes
mkdir -p "$WEB_DIR/icons"
if ls public/icons/*.png &>/dev/null 2>&1; then
    cp public/icons/*.png "$WEB_DIR/icons/"
elif ls *.png &>/dev/null 2>&1; then
    cp web-app-manifest-192x192.png "$WEB_DIR/icons/icon-192.png" 2>/dev/null || true
    cp web-app-manifest-512x512.png "$WEB_DIR/icons/icon-512.png" 2>/dev/null || true
    cp apple-touch-icon.png         "$WEB_DIR/icons/"             2>/dev/null || true
fi
ok "Fichiers déployés vers $WEB_DIR"

# 7. Cleanup
rm -f "$ZIP"
ok "ZIP supprimé"

echo ""
echo -e "${GREEN}━━━ Deploy terminé ━━━${NC}"
echo "  URL : https://homepi.internal"
echo "  Build : homepi-$BUILD_TIME"
echo "  Les PWA installées se mettront à jour au prochain refresh."
