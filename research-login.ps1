param([ValidateSet('perplexity','grok','muse')][string]$Provider='perplexity',[switch]$Finish,[switch]$LoadOnly)
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
# gstack reopens its saved tabs in the background after it starts; until then commands answer "No active page", and a
# daemon finishing a heavy page can answer "busy". Retry those, as browser.mjs does (2026-11-01: an unretried load lost a
# fresh meta.ai login). Native stderr is captured, so errors must not stop the script mid-wait.
function Invoke-Browse{
  $prior=$ErrorActionPreference;$ErrorActionPreference='Continue'
  try{for($i=0;$i -lt 12;$i++){$out=(& $B @args 2>&1 | Out-String).Trim();if($LASTEXITCODE -eq 0 -or $out -notmatch 'No active page|busy|did not answer'){break};Start-Sleep -Seconds 3};$out}
  finally{$ErrorActionPreference=$prior}
}
if($Finish){
  if(-not $LoadOnly){
    # Handoff moves gstack into its separate visible profile for good. Copy those logins into the hidden research browser.
    Invoke-Browse state save deltaroute-login
    if($LASTEXITCODE -ne 0){throw 'Could not read the sign-in window. Keep it open, then run -Finish again.'}
    Invoke-Browse stop | Out-Null
  }
  Invoke-Browse goto 'about:blank' | Out-Null
  Invoke-Browse state load deltaroute-login
  # The saved file holds plaintext cookies: delete it only once they are loaded, so a failed load can be retried.
  if($LASTEXITCODE -ne 0){throw 'Could not load the logins into the research browser. They are kept; run research-login.ps1 -Finish -LoadOnly to try again.'}
  Remove-Item -LiteralPath (Join-Path $stateParent 'browse-states/deltaroute-login.json') -Force -ErrorAction SilentlyContinue
  Invoke-Browse stop | Out-Null
  Write-Output 'Logins saved for DeltaRoute research. The sign-in window can be closed.'
  return
}
$url=@{perplexity='https://www.perplexity.ai';grok='https://grok.com';muse='https://www.meta.ai'}[$Provider]
Invoke-Browse goto $url
if($LASTEXITCODE -ne 0){throw 'gstack could not open the provider page.'}
& $B handoff 'Sign into your existing research account using its normal browser flow. Complete challenges yourself, leave this window open, then run research-login.ps1 -Finish.'
if($LASTEXITCODE -ne 0){throw 'gstack browser handoff did not complete.'}
