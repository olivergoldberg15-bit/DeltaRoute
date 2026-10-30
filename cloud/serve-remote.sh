#!/usr/bin/env bash
# Keeps the connected-AI endpoint (remote-mcp.mjs serve) running: if it exits, it starts again after a short wait,
# backing off to a minute while it keeps failing and resetting once it has stayed up. cloud/remote.sh runs this in tmux
# (attach: tmux attach -t =deltaroute-mcp). Its log is state/remote-mcp.log.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${DELTAROUTE_REMOTE_PORT:-8787}"
LOG="$ROOT/state/remote-mcp.log"
mkdir -p "$ROOT/state"
wait=2
while true; do
  started=$(date +%s)
  echo "$(date -u +%FT%TZ) starting endpoint on port $PORT" >>"$LOG"
  (cd "$ROOT" && node remote-mcp.mjs serve --port "$PORT") 2>&1 | tee -a "$LOG"
  code=${PIPESTATUS[0]}
  if [ $(( $(date +%s) - started )) -ge 60 ]; then wait=2; fi
  echo "$(date -u +%FT%TZ) endpoint exited with code $code; restarting in ${wait}s" | tee -a "$LOG"
  sleep "$wait"
  wait=$(( wait * 2 > 60 ? 60 : wait * 2 ))
  # Keep the log from growing without bound.
  if [ "$(wc -c <"$LOG")" -gt 5000000 ]; then tail -c 1000000 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
done
