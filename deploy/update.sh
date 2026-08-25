#!/usr/bin/env bash
# Обновление сайта podvorye.com на сервере.
# Запуск:  bash /var/www/podvorye.com/deploy/update.sh
#
# Сайт статический, пересобирать на сервере нечего: git pull забирает
# уже готовые файлы. Скрипт нужен, чтобы не забыть про права и проверку nginx.

set -euo pipefail

SITE_DIR="/var/www/podvorye.com"
cd "$SITE_DIR"

echo "→ забираю изменения"
git fetch --quiet origin
BEFORE=$(git rev-parse --short HEAD)
git reset --hard --quiet origin/main
AFTER=$(git rev-parse --short HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  echo "  изменений нет ($AFTER)"
else
  echo "  $BEFORE → $AFTER"
  git --no-pager log --oneline "$BEFORE..$AFTER" | sed 's/^/    /'
fi

echo "→ права"
chown -R www-data:www-data "$SITE_DIR"
find "$SITE_DIR" -type d -exec chmod 755 {} \;
find "$SITE_DIR" -type f -exec chmod 644 {} \;

echo "→ проверка nginx"
nginx -t

echo "→ перезагрузка nginx"
systemctl reload nginx

echo "→ проверка сайта"
code=$(curl -s -o /dev/null -w "%{http_code}" https://podvorye.com/)
echo "  главная: $code"

# Перемотка видео по прокрутке невозможна без частичных запросов,
# поэтому проверяем их отдельно: молчаливая поломка выглядит как
# «видео замерло», и причину потом ищут долго.
range=$(curl -s -o /dev/null -w "%{http_code}" -H "Range: bytes=0-1023" \
  https://podvorye.com/assets/video/hero-rows.mp4)
echo "  видео (ожидается 206): $range"

if [ "$code" != "200" ] || [ "$range" != "206" ]; then
  echo "ВНИМАНИЕ: проверки не прошли, смотрите вывод выше"
  exit 1
fi

echo "готово"
