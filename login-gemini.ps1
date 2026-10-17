$ErrorActionPreference='Stop'
$configPath=Join-Path $PSScriptRoot 'config.json'
if(-not (Test-Path -LiteralPath $configPath)){throw 'Run node setup.mjs first.'}
$config=Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json
$worker=$config.workers.gemini
if(-not $worker.command -or -not (Test-Path -LiteralPath $worker.command -PathType Leaf)){throw 'Install an official Google Gemini/Antigravity CLI separately, then rerun setup or configure workers.gemini.'}
Write-Output 'Opening the installed Google CLI. Choose your existing subscription account login; API keys and Vertex are not accepted by DeltaRoute.'
$arguments=@();if($worker.script){$arguments+=$worker.script}
& $worker.command @arguments
if($LASTEXITCODE -ne 0){throw 'Google CLI returned an error. Complete its official sign-in flow and rerun.'}
