# Downloads the official Daytona CLI from Daytona's GitHub releases to the folder its own installer uses
# (%APPDATA%\bin\daytona), without changing PATH. Used by cloud/daytona.ps1.
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:APPDATA 'bin\daytona'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
Invoke-WebRequest -Uri "https://github.com/daytona/clients/releases/latest/download/daytona-windows-$arch.exe" -OutFile (Join-Path $dir 'daytona.exe') -UseBasicParsing
& (Join-Path $dir 'daytona.exe') version
