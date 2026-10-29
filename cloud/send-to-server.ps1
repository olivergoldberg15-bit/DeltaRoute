# Run once on your PC to put DeltaRoute on your cloud server. After that the PC is not needed.
#   .\cloud\send-to-server.ps1 -NewKey                      Make an SSH key and print the public half to paste into the cloud console.
#   .\cloud\send-to-server.ps1 -Server ubuntu@203.0.113.7   Copy DeltaRoute (main), install it there, then walk through sign-ins.
# Options: -Vpn <wireguard.conf> routes all of the server's outbound traffic through that one VPN.
#          -WithResearchSessions copies the research browser's signed-in session so Perplexity and Grok start signed in.
# It copies your own files to your own server over SSH. It never reads or prints a password, key or session.
param([string]$Server,[string]$Key=(Join-Path $HOME '.ssh\deltaroute'),[string]$Vpn,[switch]$WithResearchSessions,[switch]$NewKey)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
if($NewKey){
  # ssh-keygen asks for an optional passphrase; press Enter twice for none.
  if(-not (Test-Path -LiteralPath $Key)){New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Key) | Out-Null;ssh-keygen -t ed25519 -f $Key -C deltaroute}
  Write-Output "Paste this public key into the cloud console when you create the server:"
  Get-Content -LiteralPath "$Key.pub"
  exit 0
}
if(-not $Server){throw 'Pass -Server user@address (for Oracle Ubuntu images the user is ubuntu), or -NewKey first.'}
if(-not (Test-Path -LiteralPath $Key)){throw "No SSH key at $Key. Run with -NewKey first and add it to the server."}
$ssh=@('-i',$Key,'-o','StrictHostKeyChecking=accept-new')
$stage=Join-Path ([IO.Path]::GetTempPath()) ('deltaroute-send-'+[guid]::NewGuid())
New-Item -ItemType Directory -Path $stage | Out-Null
try{
  git -C $root bundle create (Join-Path $stage 'deltaroute.bundle') main
  if($LASTEXITCODE -ne 0){throw 'Could not bundle the main branch.'}
  $files=@((Join-Path $stage 'deltaroute.bundle'),(Join-Path $root 'cloud\install.sh'))
  $installArgs='--source ~/deltaroute-send/deltaroute.bundle'
  if($Vpn){if(-not (Test-Path -LiteralPath $Vpn)){throw "No VPN config at $Vpn"};Copy-Item -LiteralPath $Vpn -Destination (Join-Path $stage 'vpn.conf');$files+=(Join-Path $stage 'vpn.conf');$installArgs+=' --vpn ~/deltaroute-send/vpn.conf'}
  if($WithResearchSessions){
    $session=Join-Path $root 'state\browser\session-state.json'
    if(-not (Test-Path -LiteralPath $session)){throw 'No research browser session on this PC yet; sign in with research-login.ps1 first.'}
    Copy-Item -LiteralPath $session -Destination (Join-Path $stage 'session-state.json');$files+=(Join-Path $stage 'session-state.json');$installArgs+=' --browser-session ~/deltaroute-send/session-state.json'
  }
  ssh @ssh $Server 'mkdir -p ~/deltaroute-send && chmod 700 ~/deltaroute-send'
  scp @ssh @files "${Server}:deltaroute-send/"
  if($LASTEXITCODE -ne 0){throw 'Copying to the server failed.'}
  ssh -t @ssh $Server "bash ~/deltaroute-send/install.sh $installArgs && rm -f ~/deltaroute-send/vpn.conf ~/deltaroute-send/session-state.json && bash ~/DeltaRoute/cloud/signin.sh"
}finally{Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue}
