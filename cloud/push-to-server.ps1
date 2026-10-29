# Copies DeltaRoute from this laptop to the cloud server, installs it there and walks through the sign-ins.
#   powershell -ExecutionPolicy Bypass -File cloud\push-to-server.ps1 -Server ubuntu@<server ip> -Key <path to the server's SSH key> [-Vpn <WireGuard .conf>] [-BrowserSessions]
# It sends the committed main branch as a git bundle (no config.json, jobs, logs, prompts or worktrees), so the server
# keeps a git copy that later pushes fast-forward. -BrowserSessions also copies the research browser's saved sign-ins
# (Perplexity, Grok) so they need no new login; they stay owner-only on the server. Nothing is printed or kept here.
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$Key,
  [string]$Vpn,
  [switch]$BrowserSessions
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$sshOpts = @('-i', $Key, '-o', 'StrictHostKeyChecking=accept-new')
function Invoke-Checked([string]$exe, [string[]]$argv) { & $exe @argv; if ($LASTEXITCODE) { throw "$exe failed ($LASTEXITCODE)" } }

$stage = Join-Path $env:TEMP ("deltaroute-push-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $stage | Out-Null
try {
  Invoke-Checked git @('-C', $root, 'bundle', 'create', (Join-Path $stage 'deltaroute.bundle'), 'main')
  # The installer comes from the committed main branch too, byte for byte (a tar keeps its LF line endings).
  Invoke-Checked git @('-C', $root, 'archive', '--format=tar', '-o', (Join-Path $stage 'install.tar'), 'main', 'cloud/install.sh')
  $files = @((Join-Path $stage 'deltaroute.bundle'), (Join-Path $stage 'install.tar'))
  $installArgs = '--source ~/deltaroute-push/deltaroute.bundle'
  if ($Vpn) {
    if (-not (Test-Path -LiteralPath $Vpn)) { throw "VPN config not found: $Vpn" }
    Copy-Item -LiteralPath $Vpn -Destination (Join-Path $stage 'vpn.conf'); $files += (Join-Path $stage 'vpn.conf')
    $installArgs += ' --vpn ~/deltaroute-push/vpn.conf'
  }
  if ($BrowserSessions) {
    $session = Join-Path $root 'state\browser\session-state.json'
    if (Test-Path -LiteralPath $session) {
      Copy-Item -LiteralPath $session -Destination (Join-Path $stage 'session-state.json'); $files += (Join-Path $stage 'session-state.json')
      $installArgs += ' --browser-session ~/deltaroute-push/session-state.json'
    } else { Write-Warning "No saved research sign-ins at $session; sign in later with gstack on the server." }
  }
  Invoke-Checked ssh ($sshOpts + @($Server, 'mkdir -p ~/deltaroute-push && chmod 700 ~/deltaroute-push'))
  Invoke-Checked scp ($sshOpts + $files + @("${Server}:deltaroute-push/"))
  # The VPN config and browser session are removed from the drop folder once installed.
  Invoke-Checked ssh ($sshOpts + @('-t', $Server, "tar -xOf ~/deltaroute-push/install.tar cloud/install.sh > ~/deltaroute-push/install.sh && bash ~/deltaroute-push/install.sh $installArgs; s=`$?; rm -f ~/deltaroute-push/vpn.conf ~/deltaroute-push/session-state.json; [ `$s -eq 0 ] && bash ~/DeltaRoute/cloud/login.sh"))
} finally { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
Write-Host "Sign in again any time:  ssh -t -i `"$Key`" $Server bash ~/DeltaRoute/cloud/login.sh"
