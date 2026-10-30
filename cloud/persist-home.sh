#!/usr/bin/env bash
# Keeps the one-time sign-ins through a Codespace rebuild. A rebuild resets everything outside /workspaces, so the
# tools' login folders live in /workspaces/.deltaroute-home (outside the repository, never in Git, owner-only) and
# the home folder links to them. Safe to run again; runs first on every Codespace create.
set -euo pipefail
KEEP=/workspaces/.deltaroute-home
[ -d /workspaces ] || { echo "No /workspaces here; nothing to keep."; exit 0; }
mkdir -p "$KEEP" && chmod 700 "$KEEP"
for dir in .codex .claude .gemini .antigravity; do
  src="$HOME/$dir" dst="$KEEP/$dir"
  [ -L "$src" ] && continue
  if [ -d "$src" ] && [ ! -e "$dst" ]; then mv "$src" "$dst"; fi
  if [ -d "$dst" ]; then rm -rf "$src"; ln -s "$dst" "$src"; fi
done
# Claude rewrites ~/.claude.json in place, so it is copied rather than linked: restored when missing, saved otherwise.
if [ -f "$HOME/.claude.json" ]; then install -m 600 "$HOME/.claude.json" "$KEEP/.claude.json"
elif [ -f "$KEEP/.claude.json" ]; then install -m 600 "$KEEP/.claude.json" "$HOME/.claude.json"; fi
echo "Sign-ins are kept in $KEEP."
