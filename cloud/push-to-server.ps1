# Copies DeltaRoute from this laptop to the cloud server and runs cloud/install.sh there.
#   powershell -ExecutionPolicy Bypass -File cloud\push-to-server.ps1 -Server ubuntu@<server ip> -Key <path to the server's SSH key> [-Vpn <WireGuard .conf>] [-BrowserSessions]
# Only committed files are copied (no config.json, jobs, logs, prompts or worktrees). -BrowserSessions also copies
# the research browser's saved sign-ins (Perplexity, Grok) so they need no new login; they stay owner-only on the server.
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

$archive = Join-Path $env:TEMP ("deltaroute-" + [guid]::NewGuid() + ".tar")
Invoke-Checked git @('-C', $root, 'archive', '--format=tar', '--prefix=DeltaRoute/', '-o', $archive, 'HEAD')
Invoke-Checked scp ($sshOpts + @($archive, "${Server}:deltaroute.tar"))
Remove-Item $archive
Invoke-Checked ssh ($sshOpts + @($Server, 'mkdir -p ~/DeltaRoute && tar -xf ~/deltaroute.tar -C ~ && rm ~/deltaroute.tar'))

$installArgs = ''
if ($Vpn) {
  Invoke-Checked scp ($sshOpts + @($Vpn, "${Server}:deltaroute-vpn.conf"))
  $installArgs = '--vpn ~/deltaroute-vpn.conf'
}
if ($BrowserSessions) {
  $session = Join-Path $root 'state\browser\session-state.json'
  if (Test-Path $session) {
    Invoke-Checked ssh ($sshOpts + @($Server, 'mkdir -p ~/DeltaRoute/state/browser'))
    Invoke-Checked scp ($sshOpts + @($session, "${Server}:DeltaRoute/state/browser/session-state.json"))
    Invoke-Checked ssh ($sshOpts + @($Server, 'chmod 600 ~/DeltaRoute/state/browser/session-state.json'))
  } else { Write-Warning "No saved research sign-ins at $session; sign in later with gstack on the server." }
}
Invoke-Checked ssh ($sshOpts + @('-t', $Server, "bash ~/DeltaRoute/cloud/install.sh $installArgs"))
Write-Host "Installed. Now sign in once:  ssh -t -i `"$Key`" $Server bash ~/DeltaRoute/cloud/login.sh"
