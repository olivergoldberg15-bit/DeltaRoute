param([switch]$Force,[switch]$Discover)
$ErrorActionPreference='Stop'
$nodePath=(Get-Command node -ErrorAction Stop).Source
$arguments=@((Join-Path $PSScriptRoot 'setup.mjs'))
if($Force){$arguments+='--force'}
if($Discover){$arguments+='--discover'}
& $nodePath @arguments
if($LASTEXITCODE -ne 0){throw 'DeltaRoute setup failed.'}
