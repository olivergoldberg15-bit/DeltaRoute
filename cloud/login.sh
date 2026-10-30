#!/usr/bin/env bash
# One-time sign-ins on the server, done by the owner. Each one prints a link: open it on the phone or laptop,
# sign in on the provider's own page, and paste back any code it asks for. Nothing here stores or prints a password.
# Steps that are already signed in are skipped, so it is safe to run again.
set -uo pipefail
export PATH="$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ask(){ printf '\n== %s\n' "$1"; read -r -p "Press Enter to start (or type s to skip): " a; [ "$a" != "s" ]; }
already(){ printf '\n== %s: already signed in\n' "$1"; }

if claude auth status 2>&1 | grep -qiE 'claude\.ai|claude_ai|oauth'; then already "Claude"
elif ask "Claude (your Claude subscription, not API billing)"; then claude auth login --claudeai; fi
if codex login status 2>&1 | grep -qi chatgpt; then already "Codex"
elif ask "Codex (your ChatGPT subscription; pick Sign in with ChatGPT, never an API key)"; then codex login --device-auth; fi
if grep -q '"oauth-personal"' "$HOME/.gemini/settings.json" 2>/dev/null; then already "Gemini"
elif ask "Gemini (choose Login with Google, then type /quit when it is ready)"; then NO_BROWSER=true gemini; fi
if command -v higgsfield >/dev/null && ask "Higgsfield (image jobs, optional)"; then higgsfield auth login; fi

# Remote Control needs the DeltaRoute folder trusted once, and it has no terminal to ask on.
if ! node -e "const c=JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.claude.json','utf8'));process.exit(c.projects?.[process.argv[1]]?.hasTrustDialogAccepted?0:1)" "$ROOT" 2>/dev/null; then
  printf '\n== Trust the DeltaRoute folder (once)\nClaude opens here: accept "trust this folder", then type /exit.\n'
  (cd "$ROOT" && claude)
fi

if [ -d /run/systemd/system ]; then sudo systemctl restart deltaroute-remote.service; else bash "$ROOT/cloud/remote.sh"; fi
sleep 5
printf '\n== Phone access\n'
tmux capture-pane -p -t '=deltaroute:' 2>/dev/null | tail -15 || true
echo "If it is waiting on a question, answer it with:  tmux attach -t =deltaroute   (leave with Ctrl+B then D)."
echo "Open the Claude app on your phone, go to Code, and pick the session named DeltaRoute."
echo "Perplexity and Grok use the browser sessions copied from the laptop (push-to-server.ps1 -BrowserSessions)."
echo "Check every worker end to end:  cd $ROOT && npm run smoke -- --research"
