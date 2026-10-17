param([ValidateSet('perplexity','grok')][string]$Provider='perplexity')
$ErrorActionPreference='Stop'
$configPath=Join-Path $PSScriptRoot 'config.json'
if(-not (Test-Path -LiteralPath $configPath)){throw 'Run node setup.mjs first.'}
$config=Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json
if(-not $config.browser.command -or -not (Test-Path -LiteralPath $config.browser.command -PathType Leaf)){throw 'Install gstack /browse separately, then configure browser.command. This script does not download a browser or import cookies.'}
if($config.browser.stateFile){$stateParent=Split-Path -Parent $config.browser.stateFile;New-Item -ItemType Directory -Force -Path $stateParent | Out-Null;$env:BROWSE_STATE_FILE=$config.browser.stateFile}
if($config.browser.browsersPath){$env:PLAYWRIGHT_BROWSERS_PATH=$config.browser.browsersPath}
$env:BROWSE_START_TIMEOUT='45000'
$url=if($Provider -eq 'perplexity'){'https://www.perplexity.ai'}else{'https://grok.com'}
& $config.browser.command goto $url
if($LASTEXITCODE -ne 0){throw 'gstack could not open the provider page.'}
& $config.browser.command handoff 'Sign into your existing research account using its normal browser flow. Complete challenges yourself, then return to your AI chat.'
if($LASTEXITCODE -ne 0){throw 'gstack browser handoff did not complete.'}
