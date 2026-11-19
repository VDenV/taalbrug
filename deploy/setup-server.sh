#!/usr/bin/env bash
# Одноразовая настройка сервера (Debian/Ubuntu). Запускать на сервере от root или через sudo:
#   sudo EMAIL=you@example.com bash setup-server.sh
set -euo pipefail

DOMAIN="taalbrug.snapko.nl"
WEBROOT="/var/www/taalbrug"
: "${EMAIL:?Укажите EMAIL для Lets Encrypt - sudo EMAIL=... bash setup-server.sh}"

apt-get update
apt-get install -y nginx certbot python3-certbot-nginx rsync

mkdir -p "$WEBROOT"
cp "$(dirname "$0")/nginx/${DOMAIN}.conf" "/etc/nginx/sites-available/${DOMAIN}.conf"
ln -sf "/etc/nginx/sites-available/${DOMAIN}.conf" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
nginx -t && systemctl reload nginx

# Файрвол (если используется ufw): открыть 80/443
if command -v ufw >/dev/null && ufw status | grep -q active; then
  ufw allow 'Nginx Full'
fi

# HTTPS. DNS должен уже указывать на этот сервер, а режим Cloudflare быть "DNS only".
certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos --no-eff-email --redirect -n
echo "Готово: https://${DOMAIN}"
