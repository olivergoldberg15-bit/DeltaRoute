#!/usr/bin/env bash
# Starts phone access (claude remote-control in tmux) where there is no systemd, for example GitHub Codespaces,
# where .devcontainer runs it on every start. It waits for the Claude sign-in and never starts a second copy.
set -uo pipefail
export PATH="$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The endpoint other AIs connect to (docs/CONNECT.md) runs whenever at least one is connected; it needs no Claude sign-in.
# cloud/serve-remote.sh restarts it if it ever exits.
if [ -s "$ROOT/state/remote-clients.json" ] && ! tmux has-session -t =deltaroute-mcp 2>/dev/null; then
  (cd "$ROOT" && tmux new-session -d -s deltaroute-mcp "bash cloud/serve-remote.sh") && echo "Connected-AI endpoint is up on port 8787 (health: /health)."
fi
if ! claude auth status 2>&1 | grep -qiE 'claude\.ai|claude_ai|oauth'; then echo "Phone access starts after the Claude sign-in: bash $ROOT/cloud/login.sh"; exit 0; fi
if tmux has-session -t =deltaroute 2>/dev/null; then echo "Phone access is already running."; exit 0; fi
cd "$ROOT" && tmux new-session -d -s deltaroute "claude remote-control --name DeltaRoute" && echo "Phone access is up: Claude app > Code > DeltaRoute"
