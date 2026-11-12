#!/usr/bin/env bash
# Одноразове встановлення на Ubuntu-сервері з автооновленням з GitHub.
#   sudo bash install.sh https://github.com/<user>/token-forge.git [гілка] [порт]
# Після цього сервер сам перевіряє репозиторій кожні 5 хвилин і оновлюється.
set -euo pipefail

REPO_URL=${1:?Вкажіть адресу репозиторію: sudo bash install.sh https://github.com/user/token-forge.git}
BRANCH=${2:-main}
PORT=${3:-8090}
APP=/opt/token-forge
USER_NAME=tokenforge
HERE=$(cd "$(dirname "$0")" && pwd)

[ "$(id -u)" = 0 ] || { echo "Запустіть через sudo"; exit 1; }
for cmd in git node npm curl flock runuser; do command -v "$cmd" >/dev/null || { echo "Не знайдено: $cmd"; exit 1; }; done
NODE=$(command -v node)
NODE_MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || { echo "Потрібен Node.js 20+ (зараз $("$NODE" -v))"; exit 1; }
# Node, встановлений у домашній теці (nvm), недоступний системному користувачу
case "$NODE" in /home/*|/root/*) echo "Node.js встановлено в домашній теці ($NODE). Поставте системний Node.js 20+ (наприклад, з NodeSource) і повторіть."; exit 1;; esac

id "$USER_NAME" >/dev/null 2>&1 || useradd --system --home-dir "$APP/home" --create-home --shell /usr/sbin/nologin "$USER_NAME"
install -d -o "$USER_NAME" -g "$USER_NAME" "$APP" "$APP/releases" "$APP/home"

if [ ! -d "$APP/repo/.git" ]; then
  runuser -u "$USER_NAME" -- git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP/repo"
fi

cat > /etc/token-forge.env <<EOF
BRANCH=$BRANCH
PORT=$PORT
HOST=127.0.0.1
BUILD_PATH=$(dirname "$NODE"):/usr/local/bin:/usr/bin:/bin
KEEP_RELEASES=3
# 1 — оновлюватися лише з комітів, підписаних довіреним ключем (див. README)
REQUIRE_SIGNED=0
EOF
chmod 644 /etc/token-forge.env

# Скрипт оновлення лежить поза репозиторієм: коміт не може непомітно змінити те, що запускається від root
install -m 755 -o root -g root "$HERE/update.sh" /usr/local/sbin/token-forge-update
sed "s#@NODE@#$NODE#g" "$HERE/token-forge.service" > /etc/systemd/system/token-forge.service
install -m 644 "$HERE/token-forge-update.service" /etc/systemd/system/token-forge-update.service
install -m 644 "$HERE/token-forge-update.timer" /etc/systemd/system/token-forge-update.timer
systemctl daemon-reload

echo "Перша збірка (кілька хвилин)…"
FORCE=1 SKIP_HEALTH=1 BRANCH=$BRANCH PORT=$PORT SYSTEMCTL=true /usr/local/sbin/token-forge-update
systemctl enable --now token-forge.service token-forge-update.timer
sleep 2
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" && echo "Готово: сайт працює на http://127.0.0.1:$PORT, автооновлення кожні 5 хвилин."
echo "Журнал оновлень: journalctl -u token-forge-update -f"
