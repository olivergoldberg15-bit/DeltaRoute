param([switch]$CheckAccounts)
$ErrorActionPreference='Stop'
$nodePath=(Get-Command node -ErrorAction Stop).Source
$configPath=Join-Path $PSScriptRoot 'config.json'
if(-not (Test-Path -LiteralPath $configPath)){Write-Output 'Local config.json is missing. Run node setup.mjs. No configuration was changed.';exit 1}
$config=Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json
$found=(& $nodePath (Join-Path $PSScriptRoot 'setup.mjs') --discover) | ConvertFrom-Json
Write-Output ('Node: '+(& $nodePath --version))
foreach($property in $config.workers.PSObject.Properties){
  $worker=$property.Value
  $installed=if($worker.transport -eq 'browser'){[bool]($config.browser.command -and (Test-Path -LiteralPath $config.browser.command -PathType Leaf))}else{[bool]($worker.command -and (Test-Path -LiteralPath $worker.command -PathType Leaf) -and (-not $worker.script -or (Test-Path -LiteralPath $worker.script -PathType Leaf)))}
  Write-Output ($property.Name+': enabled='+[bool]$worker.enabled+', executable present='+$installed)
}
Write-Output ('Local video dependencies: Python='+[bool]$found.python+', yt-dlp='+[bool]$found.ytDlp+', FFmpeg='+[bool]$found.ffmpeg+', watch='+[bool]$found.watchScript)
Write-Output ('Local context-mode installed: '+[bool]$found.contextStart)
if($CheckAccounts){
  foreach($provider in @('claude','codex')){
    $command=$config.coordinators.$provider.command
    if(-not $command -or -not (Test-Path -LiteralPath $command -PathType Leaf)){Write-Output ($provider+': CLI unavailable');continue}
    $arguments=if($provider -eq 'claude'){@('auth','status')}else{@('login','status')}
    $response=(& $command @arguments 2>&1 | Out-String);$code=$LASTEXITCODE
    $subscription=if($provider -eq 'claude'){$response -match 'claude\.ai|claude_ai|oauth'}else{$response -match 'ChatGPT'}
    Write-Output ($provider+': account status exit='+$code+', subscription login detected='+$subscription+' (quota not tested)')
  }
}else{Write-Output 'Account logins and quota were not checked. Use -CheckAccounts for read-only official login status checks.'}
Write-Output 'No model requests, browser navigation, account resets or configuration edits were performed.'
