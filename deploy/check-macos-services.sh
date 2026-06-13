#!/bin/sh
set -eu

repo_path=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
domain="gui/$(id -u)"
health_url="${MMCP_HEALTH_URL:-http://127.0.0.1:3000/health}"

check_service() {
  label="$1"
  output=$(launchctl print "$domain/$label")
  state=$(printf '%s\n' "$output" | awk '$1 == "state" && $2 == "=" { print $3; exit }')
  pid=$(printf '%s\n' "$output" | awk '$1 == "pid" && $2 == "=" { print $3; exit }')
  echo "$label state=$state pid=${pid:-unknown}"
  if [ -n "${pid:-}" ]; then
    ps -o pid=,etime=,%cpu=,rss= -p "$pid"
  fi
}

check_service com.plaonn.mmcp
check_service com.plaonn.mmcp.caddy

echo "health=$(curl -fsS "$health_url")"
if ! caddy validate --config "$repo_path/deploy/Caddyfile" --adapter caddyfile >/dev/null 2>&1; then
  caddy validate --config "$repo_path/deploy/Caddyfile" --adapter caddyfile
  exit 1
fi
echo "caddy_config=valid"

for path in "$repo_path/dist" "$HOME/.config/mmcp"; do
  if [ -e "$path" ]; then
    du -sk "$path"
  fi
done
