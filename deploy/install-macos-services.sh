#!/bin/sh
set -eu

repo_path=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
node_path=$(command -v node)
caddy_path=$(command -v caddy)
launch_agents="$HOME/Library/LaunchAgents"
domain="gui/$(id -u)"

escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[&|]/\\&/g'
}

install_plist() {
  label="$1"
  template="$repo_path/deploy/launchd/$label.plist.template"
  destination="$launch_agents/$label.plist"
  temporary=$(mktemp)

  sed \
    -e "s|__REPO_PATH__|$(escape_sed_replacement "$repo_path")|g" \
    -e "s|__NODE_PATH__|$(escape_sed_replacement "$node_path")|g" \
    -e "s|__CADDY_PATH__|$(escape_sed_replacement "$caddy_path")|g" \
    "$template" > "$temporary"
  plutil -lint "$temporary" >/dev/null

  launchctl bootout "$domain/$label" 2>/dev/null || true
  mv "$temporary" "$destination"
  launchctl bootstrap "$domain" "$destination"
}

mkdir -p "$launch_agents"
npm --prefix "$repo_path" run build
caddy validate --config "$repo_path/deploy/Caddyfile" --adapter caddyfile

install_plist com.plaonn.mmcp
install_plist com.plaonn.mmcp.caddy

echo "MMCP와 Caddy launchd 서비스 설치 완료"
