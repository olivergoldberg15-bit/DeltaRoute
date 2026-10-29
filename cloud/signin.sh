#!/usr/bin/env bash
# Sign each subscription in on this server, once. Every step shows a link: open it on your phone and sign in there.
# Your passwords are typed on the provider's own page; nothing here sees or stores them.
set -uo pipefail
export PATH="$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"
DR_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DR_DIR"
step() { printf '\n== %s\n' "$*"; }
ok() { printf '   done: %s\n' "$*"; }

step "1/5 Claude (your Claude subscription, not the paid API)"
if claude auth status 2>&1 | grep -qiE 'claude\.ai|claude_ai|oauth'; then ok "already signed in"; else claude auth login --claudeai; fi

step "2/5 ChatGPT for Codex"
if codex login status 2>&1 | grep -qi chatgpt; then ok "already signed in"; else codex login --device-auth; fi

step "3/5 Google for Gemini (choose Login with Google; type /quit when it is done)"
if grep -q '"oauth-personal"' "$HOME/.gemini/settings.json" 2>/dev/null; then ok "already signed in"; else NO_BROWSER=true gemini; fi

step "4/5 Higgsfield (optional, for image jobs)"
if command -v higgsfield >/dev/null 2>&1; then
  read -r -p "   Sign in to Higgsfield now? [y/N] " answer
  case "$answer" in [yY]*) higgsfield auth login ;; *) ok "skipped" ;; esac
else ok "not installed on this machine"; fi

step "5/5 Trust this folder and start Remote Control"
if systemctl --user is-active --quiet deltaroute-remote.service; then
  systemctl --user restart deltaroute-remote.service; ok "already running; restarted on the updated copy"
else
  echo "   Claude opens once here: accept 'trust this folder', then type /exit."
  claude
  systemctl --user enable --now deltaroute-remote.service
fi
sleep 5
if systemctl --user is-active --quiet deltaroute-remote.service; then
  echo
  echo "DeltaRoute is running. On your phone: open the Claude app, go to Code, and pick the session named DeltaRoute."
  echo "Logs: journalctl --user -u deltaroute-remote -f"
else
  echo "Remote Control did not stay up. See: journalctl --user -u deltaroute-remote -n 50" >&2
fi
echo
echo "Perplexity and Grok use the browser session sent from your PC (send-to-server.ps1 -WithResearchSessions)."
echo "Check every worker end to end: cd $DR_DIR && npm run smoke -- --research"
