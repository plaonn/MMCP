#!/bin/sh
set -eu

repo_path=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
domain="gui/$(id -u)"
label="com.plaonn.mmcp"
health_url="${MMCP_HEALTH_URL:-http://127.0.0.1:3000/health}"
health_attempts="${MMCP_HEALTH_ATTEMPTS:-15}"

cd "$repo_path"

launchctl print "$domain/$label" >/dev/null
if ! caddy validate --config "$repo_path/deploy/Caddyfile" --adapter caddyfile >/dev/null 2>&1; then
  caddy validate --config "$repo_path/deploy/Caddyfile" --adapter caddyfile
  exit 1
fi
npm run typecheck
npm test
npm run build

launchctl kickstart -k "$domain/$label"

attempt=1
while [ "$attempt" -le "$health_attempts" ]; do
  if response=$(curl -fsS "$health_url" 2>/dev/null); then
    case "$response" in
      *'"status":"ok"'*)
        echo "MMCP update 완료: $health_url"
        exit 0
        ;;
    esac
  fi
  sleep 1
  attempt=$((attempt + 1))
done

echo "MMCP health 확인 실패: $health_url" >&2
launchctl print "$domain/$label" >&2
exit 1
