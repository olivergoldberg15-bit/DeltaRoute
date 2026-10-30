#!/usr/bin/env bash
# Run on your own computer (needs the GitHub CLI, signed in: gh auth login) to bring a stopped DeltaRoute Codespace
# back without the browser: it starts the Codespace over SSH, starts the endpoint, makes port 8787 public again and
# waits until /health answers.   bash cloud/wake.sh [codespace name]
set -euo pipefail
NAME="${1:-${DELTAROUTE_CODESPACE:-}}"
if [ -z "$NAME" ]; then
  NAME="$(gh codespace list --json name,repository -q '.[] | select(.repository | endswith("/DeltaRoute")) | .name' | head -n1)"
fi
[ -n "$NAME" ] || { echo "No DeltaRoute Codespace found. Pass its name: bash cloud/wake.sh <name>" >&2; exit 1; }
echo "Waking $NAME (starting it can take a minute)..."
gh codespace ssh -c "$NAME" -- 'bash /workspaces/DeltaRoute/cloud/remote.sh'
gh codespace ports visibility 8787:public -c "$NAME" >/dev/null
URL="https://$NAME-8787.app.github.dev"
for i in $(seq 1 20); do
  if body="$(curl -fsS --max-time 10 "$URL/health" 2>/dev/null)"; then echo "Up: $URL/mcp  $body"; exit 0; fi
  sleep 3
done
echo "The Codespace is running but $URL/health has not answered yet. Check: gh codespace ssh -c $NAME -- tail -n 30 /workspaces/DeltaRoute/state/remote-mcp.log" >&2
exit 1
