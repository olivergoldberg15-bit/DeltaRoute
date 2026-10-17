param([Parameter(Mandatory=$true)][string]$WorkflowId,[switch]$Once,[switch]$Background)
$ErrorActionPreference='Stop'
if($WorkflowId -notmatch '^[a-f0-9-]{36}$'){throw 'Supply the saved DeltaRoute workflow UUID.'}
$nodePath=(Get-Command node -ErrorAction Stop).Source
$scriptPath=Join-Path $PSScriptRoot 'coordinator-supervisor.mjs'
$arguments=@($scriptPath,$WorkflowId)
if($Once){$arguments+='--once'}
if($Background){
  $logDir=Join-Path $PSScriptRoot ('workflows/'+$WorkflowId)
  if(-not (Test-Path -LiteralPath (Join-Path $logDir 'plan.json'))){throw 'Saved workflow does not exist.'}
  $quoted=@('"'+$scriptPath+'"',$WorkflowId)
  if($Once){$quoted+='--once'}
  $process=Start-Process -FilePath $nodePath -ArgumentList $quoted -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'supervisor-output.log') -RedirectStandardError (Join-Path $logDir 'supervisor-error.log')
  Write-Output ('DeltaRoute managed supervisor started. PID: '+$process.Id)
}else{& $nodePath @arguments;exit $LASTEXITCODE}
