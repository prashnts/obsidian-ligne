#!/usr/bin/env bash
# Isolated, headless Obsidian on test-vault for automated checks (separate profile: never touches your
# running Obsidian or its vault list). Then: node tools/cdp.mjs shot out.png | eval "<js>" | reload
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
prof=${OBS_PROFILE:-${TMPDIR:-/tmp}/ligne-obsidian-profile}
mkdir -p "$prof"
asar=$(ls -t ~/.config/obsidian/obsidian-*.asar 2>/dev/null | head -1 || true)
[ -n "$asar" ] && cp -n "$asar" "$prof/" || true
vault=$(realpath "${VAULT:-$here/test-vault}")
echo "{\"vaults\":{\"lignetest00000001\":{\"path\":\"$vault\",\"ts\":1,\"open\":true}}}" > "$prof/obsidian.json"
exec /opt/Obsidian/obsidian --user-data-dir="$prof" --ozone-platform=headless --remote-debugging-port=${PORT:-9334} "$@"
