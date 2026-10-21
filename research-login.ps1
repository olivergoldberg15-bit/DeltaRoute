param([ValidateSet('perplexity','grok')][string]$Provider='perplexity',[switch]$Finish)
$ErrorActionPreference='Stop'
$configPath=Join-Path $PSScriptRoot 'config.json'
if(-not (Test-Path -LiteralPath $configPath)){throw 'Run node setup.mjs first.'}
$config=Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json
if(-not $config.browser.command -or -not (Test-Path -LiteralPath $config.browser.command -PathType Leaf)){throw 'Install gstack /browse separately, then configure browser.command. This script does not download a browser or import cookies.'}
if($config.browser.stateFile){$stateParent=Split-Path -Parent $config.browser.stateFile;New-Item -ItemType Directory -Force -Path $stateParent | Out-Null;$env:BROWSE_STATE_FILE=$config.browser.stateFile}
if($config.browser.browsersPath){$env:PLAYWRIGHT_BROWSERS_PATH=$config.browser.browsersPath}
$env:BROWSE_START_TIMEOUT='45000'
# The hidden research browser starts from a blank profile unless gstack persists its session (0600 file in the ignored state folder).
$env:BROWSE_PERSIST_STATE='1'
$B=$config.browser.command
if($Finish){
  # Handoff moves gstack into its separate visible profile for good. Copy those logins into the hidden research browser.
  & $B state save deltaroute-login
  if($LASTEXITCODE -ne 0){throw 'Could not read the sign-in window. Keep it open, then run -Finish again.'}
  & $B stop | Out-Null
  & $B goto 'about:blank' | Out-Null
  & $B state load deltaroute-login
  $loaded=$LASTEXITCODE
  Remove-Item -LiteralPath (Join-Path $stateParent 'browse-states/deltaroute-login.json') -Force -ErrorAction SilentlyContinue
  if($loaded -ne 0){throw 'Could not load the logins into the research browser.'}
  & $B stop | Out-Null
  Write-Output 'Logins saved for DeltaRoute research. The sign-in window can be closed.'
  return
}
$url=if($Provider -eq 'perplexity'){'https://www.perplexity.ai'}else{'https://grok.com'}
& $B goto $url
if($LASTEXITCODE -ne 0){throw 'gstack could not open the provider page.'}
& $B handoff 'Sign into your existing research account using its normal browser flow. Complete challenges yourself, leave this window open, then run research-login.ps1 -Finish.'
if($LASTEXITCODE -ne 0){throw 'gstack browser handoff did not complete.'}
