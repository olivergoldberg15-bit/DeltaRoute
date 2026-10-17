param([switch]$AllowRouterTools)
$ErrorActionPreference='Stop'
$routerRoot=$PSScriptRoot
$nodePath=(Get-Command node -ErrorAction Stop).Source
if(-not (Test-Path -LiteralPath (Join-Path $routerRoot 'config.json'))){& $nodePath (Join-Path $routerRoot 'setup.mjs');if($LASTEXITCODE -ne 0){throw 'Run node setup.mjs first.'}}
$localConfig=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $routerRoot 'config.json') | ConvertFrom-Json
$claudeCommand=$localConfig.coordinators.claude.command
if(-not $claudeCommand -or -not (Test-Path -LiteralPath $claudeCommand -PathType Leaf)){throw 'Install the official Claude Code CLI, then rerun node setup.mjs --force or configure coordinators.claude.command.'}
$userHome=[Environment]::GetFolderPath('UserProfile')
$claudeHome=if($env:CLAUDE_CONFIG_DIR){$env:CLAUDE_CONFIG_DIR}else{Join-Path $userHome '.claude'}
$claudePath=Join-Path $claudeHome 'CLAUDE.md'
$skillPath=Join-Path $claudeHome 'skills/deltaroute/SKILL.md'
$block=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $routerRoot 'ROUTING.md')
$block=$block.Replace('__DELTAROUTE_ROOT__',$routerRoot.Replace('\','/')).Replace('{{DELTAROUTE_ROOT}}',$routerRoot.Replace('\','/')).Replace('{{DELTAROUTE_SKILL_PATH}}',$skillPath.Replace('\','/'))
$existing=if(Test-Path -LiteralPath $claudePath){[IO.File]::ReadAllText($claudePath)}else{''}
$begin='<!-- subscription-worker-router:start -->';$end='<!-- subscription-worker-router:end -->'
if($existing.Contains($begin)){
  if(-not $existing.Contains($end)){throw 'Existing router instructions have an incomplete marker; preserving them.'}
  $pattern=[regex]::Escape($begin)+'[\s\S]*?'+[regex]::Escape($end)
  $updated=[regex]::Replace($existing,$pattern,[Text.RegularExpressions.MatchEvaluator]{param($m)$block.TrimEnd()})
}else{$updated=$existing.TrimEnd()+"`r`n`r`n"+$block}
$userConfigPath=if($env:CLAUDE_CONFIG_DIR){Join-Path $claudeHome '.claude.json'}else{Join-Path $userHome '.claude.json'}
$settingsPath=Join-Path $claudeHome 'settings.json'
$settings=if(Test-Path -LiteralPath $settingsPath){Get-Content -Raw -Encoding UTF8 -LiteralPath $settingsPath | ConvertFrom-Json}else{[pscustomobject]@{}}
$hookCommand='"'+$nodePath+'" "'+(Join-Path $routerRoot 'prompt-hook.mjs')+'"'
$hookPaths=@($settings.hooks.UserPromptSubmit | ForEach-Object {$_.hooks} | ForEach-Object {$_.command} | Where-Object {$_ -match 'prompt-hook\.mjs'})
if(@($hookPaths | Where-Object {$_ -ne $hookCommand}).Count){throw 'A different DeltaRoute prompt hook is installed; migrate it explicitly before replacing it.'}
$registered=$null
if(Test-Path -LiteralPath $userConfigPath){$userConfig=Get-Content -Raw -Encoding UTF8 -LiteralPath $userConfigPath | ConvertFrom-Json;$registered=$userConfig.mcpServers.'subscription-router'}
if($registered){
  if($registered.command -ne $nodePath -or $registered.args[0] -ne (Join-Path $routerRoot 'server.mjs')){throw 'A different subscription-router server is registered. Remove or migrate it explicitly before installing this checkout.'}
}else{
  & $claudeCommand mcp add --scope user --transport stdio subscription-router -- $nodePath (Join-Path $routerRoot 'server.mjs')
  if($LASTEXITCODE -ne 0){throw 'MCP registration failed. Existing global instructions were not modified.'}
}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss-fff'
New-Item -ItemType Directory -Force -Path $claudeHome | Out-Null
if(Test-Path -LiteralPath $claudePath){Copy-Item -LiteralPath $claudePath -Destination "$claudePath.deltaroute-backup-$stamp"}
[IO.File]::WriteAllText($claudePath,$updated,[Text.UTF8Encoding]::new($false))
if(Test-Path -LiteralPath $settingsPath){Copy-Item -LiteralPath $settingsPath -Destination "$settingsPath.deltaroute-backup-$stamp"}
if(-not $settings.hooks){$settings | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) -Force}
# Replace only this checkout's hook. Another installation must be removed by the
# owner, not silently stripped from a shared settings file.
$prior=@()
foreach($previousEntry in @($settings.hooks.UserPromptSubmit)){
  if(-not $previousEntry){continue}
  $remaining=@($previousEntry.hooks | Where-Object {$_.command -ne $hookCommand})
  if($remaining.Count){$previousEntry.hooks=$remaining;$prior+=$previousEntry}
}
$entry=[pscustomobject]@{hooks=@([pscustomobject]@{type='command';command=$hookCommand;timeout=5})}
$settings.hooks | Add-Member -NotePropertyName UserPromptSubmit -NotePropertyValue (@($prior)+@($entry)) -Force
if($AllowRouterTools){
  if(-not $settings.permissions){$settings | Add-Member -NotePropertyName permissions -NotePropertyValue ([pscustomobject]@{}) -Force}
  $routerTools=@('list_workers','recommend_route','submit_task','get_task','cancel_task') | ForEach-Object {'mcp__subscription-router__'+$_}
  $allowed=@($settings.permissions.allow | Where-Object {$_})+@($routerTools)
  $settings.permissions | Add-Member -NotePropertyName allow -NotePropertyValue @($allowed | Select-Object -Unique) -Force
}
[IO.File]::WriteAllText($settingsPath,($settings | ConvertTo-Json -Depth 100),[Text.UTF8Encoding]::new($false))
$agentsPath=Join-Path $claudeHome 'agents';New-Item -ItemType Directory -Force -Path $agentsPath | Out-Null
$agentPath=Join-Path $agentsPath 'repetitive-worker.md'
if(Test-Path -LiteralPath $agentPath){Copy-Item -LiteralPath $agentPath -Destination "$agentPath.deltaroute-backup-$stamp"}
Copy-Item -LiteralPath (Join-Path $routerRoot 'repetitive-worker.md') -Destination $agentPath
$dest=Join-Path $claudeHome 'skills/deltaroute';New-Item -ItemType Directory -Force -Path $dest | Out-Null
if(Test-Path -LiteralPath (Join-Path $dest 'SKILL.md')){Copy-Item -LiteralPath (Join-Path $dest 'SKILL.md') -Destination (Join-Path $dest "SKILL.md.backup-$stamp")}
Get-ChildItem -LiteralPath (Join-Path $routerRoot 'deltaroute-skill') -Force | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force}
Get-ChildItem -LiteralPath $dest -Filter '*.md' -File -Recurse | ForEach-Object {
  $rendered=[IO.File]::ReadAllText($_.FullName).Replace('__DELTAROUTE_ROOT__',$routerRoot.Replace('\','/')).Replace('{{DELTAROUTE_ROOT}}',$routerRoot.Replace('\','/')).Replace('{{DELTAROUTE_SKILL_PATH}}',$skillPath.Replace('\','/'))
  [IO.File]::WriteAllText($_.FullName,$rendered,[Text.UTF8Encoding]::new($false))
}
Write-Output 'DeltaRoute installed for Claude Code with a routing hook and native skill. Restart Claude Code. Existing deny rules remain in force.'
