# Creates (or reuses) a DeltaRoute sandbox in your Daytona account and installs DeltaRoute in it from GitHub.
# Run after `daytona login`:   powershell -ExecutionPolicy Bypass -File cloud\daytona.ps1
# Then sign in once inside it: daytona ssh deltaroute   and run   bash ~/DeltaRoute/cloud/login.sh
# Auto-stop is off so phone access stays up; the sandbox uses your Daytona credits while it runs.
param([string]$Name = 'deltaroute')
$ErrorActionPreference = 'Stop'
$daytona = Join-Path $env:APPDATA 'bin\daytona\daytona.exe'
if (-not (Test-Path -LiteralPath $daytona)) { & (Join-Path $PSScriptRoot 'get-daytona-cli.ps1') }
& $daytona info $Name *> $null
if ($LASTEXITCODE) {
  & $daytona create --name $Name --auto-stop 0 --cpu 2 --memory 4096 --disk 10
  if ($LASTEXITCODE) { throw "daytona create failed ($LASTEXITCODE)" }
} else { & $daytona start $Name *> $null }
$install = 'if [ -d ~/DeltaRoute/.git ]; then git -C ~/DeltaRoute pull --ff-only; else git clone https://github.com/olivergoldberg15-bit/DeltaRoute.git ~/DeltaRoute; fi && bash ~/DeltaRoute/cloud/install.sh'
& $daytona exec $Name --timeout 0 -- bash -lc $install
if ($LASTEXITCODE) { throw "The install in the sandbox failed ($LASTEXITCODE); its output is above." }
Write-Host "Installed in Daytona sandbox '$Name'. Sign in once:  & '$daytona' ssh $Name   then   bash ~/DeltaRoute/cloud/login.sh"
