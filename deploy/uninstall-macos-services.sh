#!/bin/sh
set -eu

launch_agents="$HOME/Library/LaunchAgents"
domain="gui/$(id -u)"

for label in com.plaonn.mmcp com.plaonn.mmcp.caddy; do
  launchctl bootout "$domain/$label" 2>/dev/null || true
  rm -f "$launch_agents/$label.plist"
done

echo "MMCP와 Caddy launchd 서비스 제거 완료"
