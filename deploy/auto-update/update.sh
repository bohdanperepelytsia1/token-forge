#!/usr/bin/env bash
# Автооновлення Кузні токенів з GitHub.
# Запускається таймером systemd кожні кілька хвилин (від root, але збірка йде від користувача tokenforge).
#   1) git fetch; якщо на гілці новий коміт —
#   2) окремий реліз: git archive → npm ci --ignore-scripts → npm run build
#   3) перевірка збірки → атомарне перемикання симлінка current → перезапуск сервісу
#   4) перевірка, що сайт відповідає; якщо ні — відкат на попередній реліз
# Налаштування: /etc/token-forge.env (BRANCH, PORT, REQUIRE_SIGNED, KEEP_RELEASES).
set -euo pipefail
umask 022

APP=${APP:-/opt/token-forge}
REPO=$APP/repo
RELEASES=$APP/releases
BRANCH=${BRANCH:-main}
PORT=${PORT:-8090}
RUN_AS=${RUN_AS:-tokenforge}
KEEP_RELEASES=${KEEP_RELEASES:-3}
REQUIRE_SIGNED=${REQUIRE_SIGNED:-0}
SYSTEMCTL=${SYSTEMCTL:-systemctl}
SERVICE=${SERVICE:-token-forge}

log() { echo "[token-forge-update] $*"; }
as_user() {
  # Чисте оточення: збірка не бачить змінних root
  local e=(env -i HOME="$APP/home" PATH="${BUILD_PATH:-/usr/local/bin:/usr/bin:/bin}" LANG=C.UTF-8 npm_config_cache="$APP/home/.npm" ${HTTPS_PROXY:+HTTPS_PROXY="$HTTPS_PROXY"} ${NODE_EXTRA_CA_CERTS:+NODE_EXTRA_CA_CERTS="$NODE_EXTRA_CA_CERTS"})
  if [ "$(id -un)" = "$RUN_AS" ]; then "${e[@]}" "$@"; else runuser -u "$RUN_AS" -- "${e[@]}" "$@"; fi
}

# Лише один запуск одночасно
exec 9>"$APP/.update.lock"
flock -n 9 || { log "вже виконується"; exit 0; }

[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || { log "некоректна назва гілки"; exit 1; }

as_user git -C "$REPO" fetch --quiet --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
NEW=$(as_user git -C "$REPO" rev-parse --verify "origin/$BRANCH^{commit}")
[[ "$NEW" =~ ^[0-9a-f]{40}$ ]] || { log "дивний хеш коміту"; exit 1; }
CUR=$(basename "$(readlink -f "$APP/current" 2>/dev/null || echo none)")

if [ "$NEW" = "$CUR" ] && [ "${FORCE:-0}" != 1 ]; then exit 0; fi
log "новий коміт $NEW (зараз: $CUR)"

if [ "$REQUIRE_SIGNED" = 1 ]; then
  as_user git -C "$REPO" verify-commit "$NEW" || { log "коміт не підписано довіреним ключем — пропускаю"; exit 1; }
fi

REL=$RELEASES/$NEW
rm -rf "$REL"
install -d -o "$RUN_AS" -g "$RUN_AS" "$REL"
as_user bash -c 'git -C "$1" archive "$2" | tar -x -C "$3"' _ "$REPO" "$NEW" "$REL"

log "збираю…"
# --ignore-scripts: залежності не можуть виконати свій код під час встановлення
if ! as_user bash -c 'cd "$1" && npm ci --ignore-scripts --no-audit --no-fund --loglevel=error && npm run build --silent' _ "$REL"; then
  log "збірка не вдалася — лишаю попередню версію"; rm -rf "$REL"; exit 1
fi
for f in dist/index.html dist/config.js dist/models/resources.json scripts/serve.mjs; do
  [ -s "$REL/$f" ] || { log "у збірці немає $f — скасовую"; rm -rf "$REL"; exit 1; }
done
rm -rf "$REL/node_modules"     # для роботи потрібні лише dist/ і scripts/

PREV=$(readlink -f "$APP/current" 2>/dev/null || true)
switch_to() { ln -sfn "$1" "$APP/current.tmp" && mv -Tf "$APP/current.tmp" "$APP/current"; }
switch_to "$REL"
$SYSTEMCTL restart "$SERVICE"

[ "${SKIP_HEALTH:-0}" = 1 ] && { log "оновлено до $NEW (без перевірки)"; exit 0; }
healthy=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  if curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:$PORT/" && curl -fsS -o /dev/null --max-time 3 "http://127.0.0.1:$PORT/models/resources.json"; then healthy=1; break; fi
done
if [ "$healthy" != 1 ]; then
  log "сайт не відповідає після оновлення — відкат"
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then switch_to "$PREV"; $SYSTEMCTL restart "$SERVICE"; fi
  exit 1
fi
log "оновлено до $NEW"

# Прибираємо старі релізи
mapfile -t old < <(ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +"$((KEEP_RELEASES + 1))")
for d in "${old[@]}"; do
  d=${d%/}
  [ "$(readlink -f "$d")" = "$(readlink -f "$APP/current")" ] && continue
  rm -rf -- "$d"
done
