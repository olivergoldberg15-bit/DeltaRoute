#!/usr/bin/env bash
# DeltaRoute on a cloud server (Ubuntu 22.04 or 24.04, x86_64 or arm64, e.g. Oracle Cloud's free Ampere server).
# Installs Node 22, Claude Code, Codex, the Gemini CLI, the Higgsfield CLI, gstack (pinned) with Chromium and
# DeltaRoute; registers DeltaRoute with Claude Code; sets up Claude Remote Control as an always-on service so the
# Claude app on a phone drives it; optionally sends all outbound traffic through one WireGuard VPN.
# It signs into nothing: cloud/signin.sh does each sign-in afterwards. Safe to run again.
set -euo pipefail

GSTACK_COMMIT=a861c00cfac6e2376d26c7d3ba5207cdc5aefc49
DR_DIR="${DELTAROUTE_DIR:-$HOME/DeltaRoute}"
SOURCE="" VPN_CONF="" SESSION="" DRY_RUN=0
usage() {
  cat <<'EOF'
bash install.sh [--source <git url or bundle>] [--vpn <wireguard.conf>] [--browser-session <session-state.json>] [--dir <path>] [--dry-run]
  --source            Where DeltaRoute comes from (send-to-server.ps1 passes a git bundle). Default: the checkout this script is in.
  --vpn               A WireGuard config (for example from Proton VPN). All outbound traffic leaves through it; SSH stays reachable.
  --browser-session   gstack's session-state.json from your PC, so Perplexity and Grok start signed in.
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
if [ "$DRY_RUN" != 1 ]; then
  [ "$(id -u)" -ne 0 ] || { echo "Run this as your normal user; it uses sudo where it needs to." >&2; exit 1; }
  . /etc/os-release 2>/dev/null || true
  [ "${ID:-}" = ubuntu ] || echo "Warning: written for Ubuntu; continuing on ${ID:-unknown}." >&2
fi
export PATH="$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"

step "System packages"
run sudo apt-get update -y
run sudo apt-get install -y git curl ca-certificates unzip python3 ffmpeg build-essential

step "Node.js 22"
if [ "$DRY_RUN" = 1 ] || ! node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9][0-9])\.'; then
  run bash -c 'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -'
  run sudo apt-get install -y nodejs
fi

step "Command-line tools in your home folder (no sudo)"
run npm config set prefix "$HOME/.npm-global"
if [ "$DRY_RUN" != 1 ] && ! grep -q 'npm-global/bin' "$HOME/.profile" 2>/dev/null; then
  echo 'export PATH="$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:$PATH"' >> "$HOME/.profile"
fi
run npm install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli
run npm install -g @higgsfield/cli || echo "Higgsfield CLI is not available here; image jobs fall back to Codex's image tool."

step "gstack research browser (pinned to ${GSTACK_COMMIT:0:7})"
command -v bun >/dev/null 2>&1 || run bash -c 'curl -fsSL https://bun.sh/install | bash'
GS="$HOME/.claude/skills/gstack"
[ -d "$GS/.git" ] || run git clone https://github.com/garrytan/gstack.git "$GS"
run git -C "$GS" fetch --quiet origin "$GSTACK_COMMIT"
run git -C "$GS" checkout --quiet --detach "$GSTACK_COMMIT"
run bash -c "cd '$GS' && ./setup --quiet </dev/null"
run sudo env "PATH=$PATH" npx -y playwright install-deps chromium

step "DeltaRoute in $DR_DIR"
SCRIPT_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)"
if [ -n "$SOURCE" ]; then
  if [ -d "$DR_DIR/.git" ]; then run git -C "$DR_DIR" pull --ff-only "$SOURCE" main; else run git clone --branch main "$SOURCE" "$DR_DIR"; fi
elif [ -f "$SCRIPT_REPO/server.mjs" ]; then
  DR_DIR="$SCRIPT_REPO"
else
  echo "No DeltaRoute source: pass --source, or run this from inside a DeltaRoute checkout." >&2; exit 2
fi
run bash -c "cd '$DR_DIR' && node setup.mjs --force"
# A server has no screen to open the live dashboard on.
run node -e "const f=process.argv[1],c=JSON.parse(require('fs').readFileSync(f,'utf8'));c.dashboard={...c.dashboard,autoOpen:false};require('fs').writeFileSync(f,JSON.stringify(c,null,2)+'\n',{mode:0o600})" "$DR_DIR/config.json"
run node "$DR_DIR/install-claude.mjs" --allow-router-tools
if [ -n "$SESSION" ]; then
  run mkdir -p "$DR_DIR/state/browser"
  run install -m 600 "$SESSION" "$DR_DIR/state/browser/session-state.json"
fi

step "Claude Remote Control as an always-on service"
UNIT="$HOME/.config/systemd/user/deltaroute-remote.service"
if [ "$DRY_RUN" = 1 ]; then echo "+ write $UNIT"; else
  mkdir -p "$(dirname "$UNIT")"
  cat > "$UNIT" <<EOF
[Unit]
Description=DeltaRoute through Claude Remote Control
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$DR_DIR
Environment=PATH=$HOME/.npm-global/bin:$HOME/.bun/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$HOME/.npm-global/bin/claude remote-control --name DeltaRoute --spawn worktree
Restart=on-failure
RestartSec=15

[Install]
WantedBy=default.target
EOF
fi
# Keeps your services running after you log out of SSH.
run sudo loginctl enable-linger "${USER:-$(id -un)}"
run systemctl --user daemon-reload

if [ -n "$VPN_CONF" ]; then
  step "One constant VPN exit for all outbound traffic"
  run sudo apt-get install -y wireguard-tools
  # wg-quick sets DNS through resolvconf; Ubuntu provides it through resolvectl.
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

step "Check DeltaRoute runs on this machine"
run bash -c "cd '$DR_DIR' && npm test"

printf '\nInstalled. Next, sign in to each subscription once:\n  bash %s/cloud/signin.sh\n' "$DR_DIR"
