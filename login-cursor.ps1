$ErrorActionPreference='Stop'
$configPath=Join-Path $PSScriptRoot 'config.json'
if(-not (Test-Path -LiteralPath $configPath)){throw 'Run node setup.mjs first.'}
$config=Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json
$worker=$config.workers.cursor
if(-not $worker.command -or -not (Test-Path -LiteralPath $worker.command -PathType Leaf)){throw 'Install the official Cursor Agent CLI separately, then rerun setup or configure workers.cursor.'}
$arguments=@();if($worker.script){$arguments+=$worker.script};$arguments+='login'
& $worker.command @arguments
if($LASTEXITCODE -ne 0){throw 'Cursor login did not complete. Follow its official browser login instructions.'}
