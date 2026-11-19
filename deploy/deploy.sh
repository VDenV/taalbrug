#!/usr/bin/env bash
# Выкладка сайта с локальной машины:  ./deploy/deploy.sh user@149.56.13.250
set -euo pipefail

TARGET="${1:?Использование: ./deploy/deploy.sh user@host}"
cd "$(dirname "$0")/.."

rsync -avz --delete \
  --include='index.html' --exclude='*' \
  ./ "${TARGET}:/var/www/taalbrug/"
echo "Выложено на https://taalbrug.snapko.nl"
