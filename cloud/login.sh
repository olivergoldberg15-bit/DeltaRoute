#!/usr/bin/env bash
# One-time sign-ins on the server, done by the owner. Each one prints a link: open it on the phone or laptop,
# sign in, and paste back any code it asks for. Nothing here stores or prints a password.
set -uo pipefail
export PATH="$HOME/.npm-global/bin:$HOME/.bun/bin:$PATH"
ask(){ printf '\n== %s\n' "$1"; read -r -p "Press Enter to start (or type s to skip): " a; [ "$a" != "s" ]; }

if ask "Claude (your Claude subscription)"; then claude auth login; claude auth status || true; fi
if ask "Codex (your ChatGPT subscription; pick Sign in with ChatGPT, never an API key)"; then codex login --device-auth; codex login status || true; fi
if ask "Gemini (choose Login with Google, then type /quit when it is ready)"; then NO_BROWSER=true gemini; fi
if command -v higgsfield >/dev/null && ask "Higgsfield (image jobs)"; then higgsfield auth login; fi

# Rebuild config now that the CLIs are signed in, then start phone access.
(cd "$HOME/DeltaRoute" && node setup.mjs) || true
sudo systemctl restart deltaroute-remote.service
sleep 5
printf '\n== Phone access\n'
tmux capture-pane -p -t deltaroute 2>/dev/null | tail -15 || true
echo "If it is waiting on a question, answer it with:  tmux attach -t deltaroute   (leave with Ctrl+B then D)."
echo "Open the Claude app on your phone, go to Code, and pick the session named DeltaRoute."
echo "Perplexity and Grok use the browser sessions copied from the laptop (push-to-server.ps1 -BrowserSessions)."
