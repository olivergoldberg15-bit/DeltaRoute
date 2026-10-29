#!/usr/bin/env bash
# Sets up DeltaRoute on an Ubuntu cloud server (Oracle Always Free Ampere A1, or any Ubuntu 22.04/24.04, arm64 or
# x64) so the Claude app on a phone can drive it through `claude remote-control`. It installs the same tools the
# laptop uses (Node 22, Claude Code, Codex, the Gemini CLI, the Higgsfield CLI, gstack pinned with Chromium),
# registers DeltaRoute with Claude Code, keeps Remote Control running as a service, optionally sends all outbound
# traffic through one WireGuard VPN, and runs DeltaRoute's tests here. It signs in to nothing: the owner runs
# cloud/login.sh afterwards. Safe to run again; an existing config.json is kept.
set -euo pipefail

GSTACK_COMMIT=a861c00cfac6e2376d26c7d3ba5207cdc5aefc49
DR_DIR="${DELTAROUTE_DIR:-$HOME/DeltaRoute}"
SOURCE="" VPN_CONF="" SESSION="" DRY_RUN=0
usage() {
  cat <<'EOF'
bash install.sh [--source <git url or bundle>] [--vpn <wireguard.conf>] [--browser-session <session-state.json>] [--dir <path>] [--dry-run]
  --source            Where DeltaRoute comes from (push-to-server.ps1 passes a git bundle). Default: the checkout this script is in.
  --vpn               A WireGuard config (for example from Proton VPN). All outbound traffic leaves through it; SSH stays reachable.
  --browser-session   gstack's session-state.json from the laptop, so Perplexity and Grok start signed in.
  --dir               Install folder (default ~/DeltaRoute).
  --dry-run           Print every step without changing anything.
EOF
}
while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    --vpn) VPN_CONF="$2"; shift 2 ;;
    --browser-session) SESSION="$2"; shift 2 ;;
    --dir) DR_DIR="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done
run() { if [ "$DRY_RUN" = 1 ]; then printf '+ %s\n' "$*"; else "$@"; fi; }
step() { printf '\n== %s\n' "$*"; }
RUN_USER="${USER:-$(id -un)}"
if [ "$DRY_RUN" != 1 ]; then
  [ "$(id -u)" -ne 0 ] || { echo "Run this as your normal user; it uses sudo where it needs to." >&2; exit 1; }
  . /etc/os-release 2>/dev/null || true
  [ "${ID:-}" = ubuntu ] || echo "Warning: written for Ubuntu; continuing on ${ID:-unknown}." >&2
fi
export PATH="$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"

step "System packages"
run sudo apt-get update -y
run sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y git curl ca-certificates unzip tmux python3 ffmpeg build-essential

step "Node.js 22"
if [ "$DRY_RUN" = 1 ] || ! node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])\.'; then
  run bash -c 'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -'
  run sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi

step "Command-line tools in your home folder (no sudo, updates never touch the system)"
run mkdir -p "$HOME/.npm-global"
run npm config set prefix "$HOME/.npm-global"
for rc in "$HOME/.profile" "$HOME/.bashrc"; do
  if [ "$DRY_RUN" != 1 ] && ! grep -q 'npm-global/bin' "$rc" 2>/dev/null; then
    echo 'export PATH="$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"' >> "$rc"
  fi
done
run npm install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli
run npm install -g @higgsfield/cli || echo "Higgsfield CLI did not install here; image jobs fall back to Codex's image tool."

step "gstack research browser (pinned to ${GSTACK_COMMIT:0:7})"
command -v bun >/dev/null 2>&1 || run bash -c 'curl -fsSL https://bun.sh/install | bash'
GS="$HOME/.claude/skills/gstack"
[ -d "$GS/.git" ] || run git clone https://github.com/garrytan/gstack.git "$GS"
run git -C "$GS" fetch --quiet origin "$GSTACK_COMMIT"
run git -C "$GS" checkout --quiet --detach "$GSTACK_COMMIT"
run bash -c "cd '$GS' && ./setup --quiet </dev/null"
run sudo env "PATH=$PATH" npx --yes playwright install-deps chromium

step "DeltaRoute in $DR_DIR"
SCRIPT_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)"
if [ -n "$SOURCE" ]; then
  if [ -d "$DR_DIR/.git" ]; then run git -C "$DR_DIR" pull --ff-only "$SOURCE" main
  else
    # A copy without git history (an earlier file-copy push) is replaced; its config, sign-ins and jobs carry over.
    OLD="" KEEP=()
    if [ -e "$DR_DIR" ]; then
      for keep in config.json state jobs; do [ ! -e "$DR_DIR/$keep" ] || KEEP+=("$keep"); done
      OLD="$DR_DIR.before-$(date +%Y%m%d%H%M%S)"; run mv "$DR_DIR" "$OLD"
    fi
    run git clone --branch main "$SOURCE" "$DR_DIR"
    for keep in "${KEEP[@]}"; do run cp -a "$OLD/$keep" "$DR_DIR/"; done
  fi
elif [ -f "$SCRIPT_REPO/server.mjs" ]; then
  DR_DIR="$SCRIPT_REPO"
else
  echo "No DeltaRoute source: pass --source, or run this from inside a DeltaRoute checkout." >&2; exit 2
fi
# Creates config.json the first time; afterwards the server's own settings are kept.
run bash -c "cd '$DR_DIR' && node setup.mjs"
# A server has no screen to open the live dashboard on.
run node -e "const f=process.argv[1],c=JSON.parse(require('fs').readFileSync(f,'utf8'));c.dashboard={...c.dashboard,autoOpen:false};require('fs').writeFileSync(f,JSON.stringify(c,null,2)+'\n',{mode:0o600})" "$DR_DIR/config.json"
# Same MCP name, hook, instructions and skill as the laptop (install.ps1 there).
run node "$DR_DIR/install-claude.mjs" --allow-router-tools
if [ -n "$SESSION" ]; then
  run mkdir -p "$DR_DIR/state/browser"
  run install -m 600 "$SESSION" "$DR_DIR/state/browser/session-state.json"
fi

if [ -n "$VPN_CONF" ]; then
  step "One constant VPN exit for all outbound traffic"
  [ "$DRY_RUN" = 1 ] || [ -f "$VPN_CONF" ] || { echo "VPN config not found: $VPN_CONF" >&2; exit 1; }
  run sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y wireguard-tools
  # wg-quick sets DNS through resolvconf; Ubuntu provides that through resolvectl.
  command -v resolvconf >/dev/null 2>&1 || run sudo ln -sf "$(command -v resolvectl || echo /usr/bin/resolvectl)" /usr/local/bin/resolvconf
  # On a rerun, take the VPN down first so the server's own address is read from the normal route.
  run sudo systemctl stop wg-quick@deltaroute 2>/dev/null || true
  MAIN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' || true)"
  if [ "$DRY_RUN" != 1 ] && [ -z "$MAIN_IP" ]; then echo "Could not read this server's own address; not starting the VPN so SSH stays reachable." >&2; exit 1; fi
  MAIN_IP="${MAIN_IP:-SERVER_IP}"
  run sudo install -m 600 "$VPN_CONF" /etc/wireguard/deltaroute.conf
  # Replies from the server's own address keep using the normal route, so SSH stays reachable through the VPN.
  run sudo sed -i "/^\[Interface\]/a PostUp = ip rule add from $MAIN_IP table main priority 100\nPreDown = ip rule del from $MAIN_IP table main priority 100" /etc/wireguard/deltaroute.conf
  run sudo systemctl enable --now wg-quick@deltaroute
  if [ "$DRY_RUN" != 1 ]; then
    sleep 3
    if sudo wg show deltaroute latest-handshakes | awk '{exit !($2>0)}'; then echo "VPN is up: outbound traffic leaves through it."
    else echo "The VPN did not complete a handshake. Check the config; until then traffic stays on the normal route." >&2; fi
  fi
fi

step "Phone access service (claude remote-control, in tmux so it has a terminal)"
UNIT=/etc/systemd/system/deltaroute-remote.service
# GitHub Codespaces and other containers have no systemd; there cloud/remote.sh starts phone access on each start.
if [ "$DRY_RUN" != 1 ] && [ ! -d /run/systemd/system ]; then echo "No systemd here (for example GitHub Codespaces): cloud/remote.sh starts phone access."
elif [ "$DRY_RUN" = 1 ]; then echo "+ write $UNIT"; else
  sudo tee "$UNIT" >/dev/null <<EOF
[Unit]
Description=DeltaRoute phone access (Claude Code Remote Control)
After=network-online.target ${VPN_CONF:+wg-quick@deltaroute.service}
Wants=network-online.target

[Service]
Type=forking
User=$RUN_USER
WorkingDirectory=$DR_DIR
Environment=PATH=$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
# Attach to answer a question it is waiting on: tmux attach -t deltaroute (leave with Ctrl+B then D).
ExecStart=/usr/bin/tmux new-session -d -s deltaroute "$HOME/.npm-global/bin/claude remote-control --name DeltaRoute"
ExecStop=/usr/bin/tmux kill-session -t deltaroute
Restart=always
RestartSec=20

[Install]
WantedBy=multi-user.target
EOF
fi
if [ "$DRY_RUN" = 1 ] || [ -d /run/systemd/system ]; then
  run sudo systemctl daemon-reload
  run sudo systemctl enable deltaroute-remote.service
fi

step "Check DeltaRoute runs on this machine"
run bash -c "cd '$DR_DIR' && npm test"

printf '\nInstalled. Next, sign in to each subscription once:\n  bash %s/cloud/login.sh\n' "$DR_DIR"
