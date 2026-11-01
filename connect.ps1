# Puts DeltaRoute on your phone and in Claude/ChatGPT chats, running on this computer (not a cloud server).
#   powershell -ExecutionPolicy Bypass -File connect.ps1            start the endpoint and the tunnel, print the connector link
#   powershell -ExecutionPolicy Bypass -File connect.ps1 -AtLogon   also start both whenever you log in to Windows
#   powershell -ExecutionPolicy Bypass -File connect.ps1 -Stop      stop the endpoint (the tunnel stays configured)
# The tunnel is Tailscale Funnel: a fixed https address for this PC that only forwards to DeltaRoute's port.
# Chats reach DeltaRoute only while this computer is on and awake.
param([switch]$AtLogon,[switch]$Stop,[int]$Port=8787,[string]$Client='phone')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $MyInvocation.MyCommand.Path
$node=(Get-Command node -ErrorAction SilentlyContinue).Source
if(-not $node){throw 'Node.js 22+ is needed.'}
$state=Join-Path $root 'state'; New-Item -ItemType Directory -Force $state | Out-Null
$log=Join-Path $state 'remote-mcp.log'

function Test-Endpoint{try{(Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3).service -eq 'DeltaRoute'}catch{$false}}

if($Stop){
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.CommandLine -like '*remote-mcp.mjs*serve*'} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force}
  Write-Output 'DeltaRoute endpoint stopped.'; return
}

if(-not (Test-Endpoint)){
  Start-Process -FilePath $node -ArgumentList @((Join-Path $root 'remote-mcp.mjs'),'serve','--port',$Port) -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError "$log.err"
  for($i=0;$i -lt 20 -and -not (Test-Endpoint);$i++){Start-Sleep -Milliseconds 500}
  if(-not (Test-Endpoint)){throw "The endpoint did not start; see $log.err"}
}
Write-Output "Endpoint running on http://127.0.0.1:$Port (health: /health)."

# One secret link per client, shown once when it is made. Run 'node remote-mcp.mjs remove-client phone' to replace it.
$clients=& $node (Join-Path $root 'remote-mcp.mjs') list-clients
$link=$null
if(-not ($clients -match "^$Client\s")){
  $out=& $node (Join-Path $root 'remote-mcp.mjs') add-client $Client --link
  $link=($out | Where-Object {$_ -like '/c/*'} | Select-Object -First 1)
}

$tailscale=(Get-Command tailscale -ErrorAction SilentlyContinue).Source
if(-not $tailscale -and (Test-Path 'C:\Program Files\Tailscale\tailscale.exe')){$tailscale='C:\Program Files\Tailscale\tailscale.exe'}
if(-not $tailscale){
  Write-Output 'Tailscale is not installed. Install it from https://tailscale.com/download, sign in, then run this again.'
}else{
  & $tailscale funnel --bg $Port | Out-Null
  $dns=((& $tailscale status --json) | ConvertFrom-Json).Self.DNSName.TrimEnd('.')
  $public="https://$dns"
  if($link){Write-Output "`nYour connector URL (shown once, keep it private like a password):`n$public$link`n"}
  else{Write-Output "`nPublic address: $public  (your connector URL is this address plus the /c/... link you saved when it was made)`n"}
  Write-Output 'Add it in Claude: Settings > Connectors > Add custom connector (works in the phone app too).'
  Write-Output 'Add it in ChatGPT: Settings > Connectors > Advanced > Developer mode > Create, with No authentication.'
}
if($link -and -not $tailscale){Write-Output "`nYour connector link path (shown once, keep it private): $link"}

if($AtLogon){
  $startup=[Environment]::GetFolderPath('Startup')
  $cmd=Join-Path $startup 'DeltaRoute connect.cmd'
  Set-Content -Path $cmd -Encoding ascii -Value "@echo off`r`npowershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -Port $Port"
  Write-Output "DeltaRoute will start at every Windows login ($cmd). Delete that file to stop it."
}
