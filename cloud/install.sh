#!/usr/bin/env bash
# Sets up DeltaRoute on an Ubuntu cloud server (Oracle Always Free Ampere A1, or any Ubuntu 22.04/24.04, arm64 or x64)
# so the Claude app on a phone can drive it through `claude remote-control`. It installs the same tools the laptop
# uses and signs in to nothing: the owner runs cloud/login.sh afterwards. Safe to run again.
#   bash ~/DeltaRoute/cloud/install.sh [--vpn /path/to/wireguard.conf]
set -euo pipefail
VPN=""
while [ $# -gt 0 ]; do case "$1" in --vpn) VPN="$2"; shift 2;; *) echo "Unknown option: $1"; exit 2;; esac; done
ROOT="$HOME/DeltaRoute"
[ -f "$ROOT/server.mjs" ] || { echo "DeltaRoute is not at $ROOT. Run cloud/push-to-server.ps1 from the laptop first."; exit 1; }
step(){ printf '\n== %s\n' "$*"; }

step "System packages"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y curl git ca-certificates unzip tmux build-essential python3

step "Node.js 22"
if ! node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
# Global npm tools live in the home folder, so no sudo is needed and updates do not touch the system.
mkdir -p "$HOME/.npm-global"; npm config set prefix "$HOME/.npm-global"
export PATH="$HOME/.npm-global/bin:$HOME/.bun/bin:$PATH"
grep -q 'npm-global/bin' "$HOME/.bashrc" || echo 'export PATH="$HOME/.npm-global/bin:$HOME/.bun/bin:$PATH"' >> "$HOME/.bashrc"

step "Claude Code, Codex, Gemini CLI and Higgsfield CLI"
npm install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli
npm install -g @higgsfield/cli || echo "Higgsfield CLI did not install; image jobs fall back to Codex."

step "gstack research browser"
command -v bun >/dev/null || curl -fsSL https://bun.sh/install | bash
GSTACK="$HOME/.claude/skills/gstack"
if [ -d "$GSTACK/.git" ]; then git -C "$GSTACK" pull --ff-only; else git clone --depth 1 https://github.com/garrytan/gstack.git "$GSTACK"; fi
(cd "$GSTACK" && ./setup </dev/null) || echo "gstack setup reported a problem; research will say so when it runs."
sudo env "PATH=$PATH" npx --yes playwright install-deps chromium || true

step "DeltaRoute config and Claude Code registration"
mkdir -p "$ROOT/state/browser" "$ROOT/jobs"
(cd "$ROOT" && node setup.mjs) || echo "setup.mjs could not finish; check config.json."
# The same MCP name the laptop uses, so skills and hooks refer to the same tools.
claude mcp remove --scope user subscription-router >/dev/null 2>&1 || true
claude mcp add --scope user subscription-router -- node "$ROOT/server.mjs"

if [ -n "$VPN" ]; then
  step "One constant VPN exit (WireGuard)"
  [ -f "$VPN" ] || { echo "VPN config not found: $VPN"; exit 1; }
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y wireguard-tools resolvconf
  # Keep SSH reachable: replies from the server's own address leave through its normal network, not the tunnel.
  SELF="$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}')"
  sudo install -m 600 "$VPN" /etc/wireguard/deltaroute.conf
  sudo sed -i '/^PostUp = ip rule add from .* table main/d;/^PreDown = ip rule del from .* table main/d' /etc/wireguard/deltaroute.conf
  sudo sed -i "/^\[Interface\]/a PostUp = ip rule add from $SELF table main priority 100\nPreDown = ip rule del from $SELF table main priority 100" /etc/wireguard/deltaroute.conf
  sudo systemctl enable --now wg-quick@deltaroute
  echo "Outbound address now: $(curl -s --max-time 15 https://ifconfig.me || echo unknown)"
fi

step "Phone access service (claude remote-control, in tmux so it has a terminal)"
CLAUDE_BIN="$(command -v claude)"
sudo tee /etc/systemd/system/deltaroute-remote.service >/dev/null <<UNIT
[Unit]
Description=DeltaRoute phone access (Claude Code Remote Control)
After=network-online.target ${VPN:+wg-quick@deltaroute.service}
Wants=network-online.target

[Service]
Type=forking
User=$USER
WorkingDirectory=$ROOT
Environment=PATH=$HOME/.npm-global/bin:$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/tmux new-session -d -s deltaroute "$CLAUDE_BIN remote-control --name DeltaRoute"
ExecStop=/usr/bin/tmux kill-session -t deltaroute
Restart=on-failure
RestartSec=20

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable deltaroute-remote.service

step "Done"
echo "Next: sign in once with  bash ~/DeltaRoute/cloud/login.sh"
