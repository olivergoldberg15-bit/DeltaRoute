param([switch]$ManagedHeads)
$ErrorActionPreference='Stop'
$routerRoot=$PSScriptRoot
$nodePath=(Get-Command node -ErrorAction Stop).Source
if(-not (Test-Path -LiteralPath (Join-Path $routerRoot 'config.json'))){& $nodePath (Join-Path $routerRoot 'setup.mjs');if($LASTEXITCODE -ne 0){throw 'Run node setup.mjs first.'}}
$found=(& $nodePath (Join-Path $routerRoot 'setup.mjs') --discover) | ConvertFrom-Json
if($LASTEXITCODE -ne 0){throw 'CLI discovery failed.'}
$localConfig=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $routerRoot 'config.json') | ConvertFrom-Json
$codexPath=$localConfig.coordinators.codex.command
if(-not $codexPath -or -not (Test-Path -LiteralPath $codexPath -PathType Leaf)){throw 'Install the official Codex CLI, then run node setup.mjs --force or configure coordinators.codex.command.'}
$pythonPath=$found.python
if(-not $pythonPath){throw 'Python 3.11+ is required to preserve and validate existing Codex TOML. Install it separately and rerun.'}
$codexHome=if($env:CODEX_HOME){$env:CODEX_HOME}else{Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex'}
New-Item -ItemType Directory -Force -Path $codexHome | Out-Null
$configPath=Join-Path $codexHome 'config.toml'
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss-fff'
if(Test-Path -LiteralPath $configPath){Copy-Item -LiteralPath $configPath -Destination "$configPath.deltaroute-backup-$stamp"}
$helper=Join-Path $routerRoot 'install-codex-config.py'
$guardArgs=@($nodePath,'--config-path',$configPath)
if($found.contextStart){$guardArgs+=@('--context-start',$found.contextStart)}
$registeredJson=& $pythonPath $helper @guardArgs --check
if($LASTEXITCODE -ne 0){throw 'Existing MCP server guard failed; no registration was changed.'}
$registered=$registeredJson | ConvertFrom-Json
if(-not $registered.deltaroute){& $codexPath mcp add deltaroute --env DELTAROUTE_COORDINATOR=codex -- $nodePath (Join-Path $routerRoot 'server.mjs');if($LASTEXITCODE -ne 0){throw 'DeltaRoute MCP registration failed.'}}
if($found.contextStart -and -not $registered.'deltaroute-context'){& $codexPath mcp add deltaroute-context -- $nodePath $found.contextStart;if($LASTEXITCODE -ne 0){throw 'Local context-mode registration failed.'}}
if($ManagedHeads){$guardArgs+='--managed-heads'}
& $pythonPath $helper @guardArgs
if($LASTEXITCODE -ne 0){throw 'MCP tool policy update failed.'}
$agentFile=Join-Path $codexHome 'AGENTS.md'
$skillPath=Join-Path ([Environment]::GetFolderPath('UserProfile')) '.agents/skills/deltaroute/SKILL.md'
$block=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $routerRoot 'CODEX-ROUTING.md')
$block=$block.Replace('__DELTAROUTE_ROOT__',$routerRoot.Replace('\','/')).Replace('{{DELTAROUTE_ROOT}}',$routerRoot.Replace('\','/')).Replace('{{DELTAROUTE_SKILL_PATH}}',$skillPath.Replace('\','/'))
$existing=if(Test-Path -LiteralPath $agentFile){[IO.File]::ReadAllText($agentFile)}else{''}
$begin='<!-- deltaroute:codex:start -->';$end='<!-- deltaroute:codex:end -->'
if($existing.Contains($begin)){
  if(-not $existing.Contains($end)){throw 'Incomplete DeltaRoute marker; preserving existing global instructions.'}
  $pattern=[regex]::Escape($begin)+'[\s\S]*?'+[regex]::Escape($end)
  $updated=[regex]::Replace($existing,$pattern,[Text.RegularExpressions.MatchEvaluator]{param($m)$block.TrimEnd()})
}else{$updated=$existing.TrimEnd()+"`r`n`r`n"+$block}
if(Test-Path -LiteralPath $agentFile){Copy-Item -LiteralPath $agentFile -Destination "$agentFile.deltaroute-backup-$stamp"}
[IO.File]::WriteAllText($agentFile,$updated,[Text.UTF8Encoding]::new($false))
foreach($base in @('.agents/skills')){
  $dest=Join-Path ([Environment]::GetFolderPath('UserProfile')) ($base+'/deltaroute')
  if(Test-Path -LiteralPath (Join-Path $dest 'SKILL.md')){Copy-Item -LiteralPath (Join-Path $dest 'SKILL.md') -Destination (Join-Path $dest "SKILL.md.backup-$stamp")}
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  Get-ChildItem -LiteralPath (Join-Path $routerRoot 'deltaroute-skill') -Force | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force}
  Get-ChildItem -LiteralPath $dest -Filter '*.md' -File -Recurse | ForEach-Object {
    $rendered=[IO.File]::ReadAllText($_.FullName).Replace('__DELTAROUTE_ROOT__',$routerRoot.Replace('\','/')).Replace('{{DELTAROUTE_ROOT}}',$routerRoot.Replace('\','/')).Replace('{{DELTAROUTE_SKILL_PATH}}',$skillPath.Replace('\','/'))
    [IO.File]::WriteAllText($_.FullName,$rendered,[Text.UTF8Encoding]::new($false))
  }
}
Write-Output 'DeltaRoute registered for Codex. Restart Codex to load it. Existing project instructions and deny rules were preserved.'
