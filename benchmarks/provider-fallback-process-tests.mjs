import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

if(process.platform!=='win32'){
 console.log('SKIP Windows subprocess fault scenarios: requires taskkill and the Windows .NET Framework compiler.');
 process.exit(0);
}
const installed=path.resolve(import.meta.dirname,'..');
// Private fixture logs stay in OS temporary storage, outside the checkout/release.
const scratch=path.resolve(process.env.DELTAROUTE_TEST_TMP||os.tmpdir());fs.mkdirSync(scratch,{recursive:true});
const runDir=fs.mkdtempSync(path.join(scratch,'deltaroute-fallback-process-'));
const bin=path.join(runDir,'bin');fs.mkdirSync(bin,{recursive:true});
const shim=String.raw`using System;
using System.IO;
using System.Threading;
using System.Reflection;
class FakeProvider {
 static int Main(string[] args) {
  string name=Path.GetFileNameWithoutExtension(Assembly.GetExecutingAssembly().Location).ToLowerInvariant();
  string joined=String.Join(" ",args);
  bool codex=name.StartsWith("codex");
  if(codex && joined=="login status") {
   if(name.Contains("loginhang")){File.WriteAllText(name+".pid",System.Diagnostics.Process.GetCurrentProcess().Id.ToString());Thread.Sleep(30000);return 1;}
   if(name.Contains("auth")){Console.WriteLine("Not logged in");return 1;}
   Console.WriteLine("Logged in using ChatGPT");return 0;
  }
  if(codex) {
   if(name.Contains("-scope")) File.WriteAllText("outside.txt","scope violation");
   if(name.Contains("-code")) File.WriteAllText("partial.txt","failed provider wrote this");
   Console.WriteLine("{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":10,\"cached_input_tokens\":4,\"output_tokens\":2}}");
   Console.Out.Flush();
   if(name.Contains("hang")){File.WriteAllText("started.txt","started");File.WriteAllText(name+".pid",System.Diagnostics.Process.GetCurrentProcess().Id.ToString());Thread.Sleep(30000);return 1;}
   if(name.Contains("success")) {
    for(int i=0;i<args.Length-1;i++) if(args[i]=="-o") File.WriteAllText(args[i+1],"RECOVERED");
    return 0;
   }
   string error=name.Contains("quota")?"Account quota exceeded":"HTTP 503 service unavailable";
   Console.WriteLine("{\"type\":\"error\",\"message\":\""+error+"\"}");return 1;
  }
  if(name.Contains("hang")){File.WriteAllText("started.txt","started");Thread.Sleep(30000);return 1;}
  if(name.Contains("code")) {
   if(File.Exists("partial.txt")){Console.WriteLine("{\"status\":\"ERROR\",\"error\":\"Worktree contamination detected\",\"response\":\"Failed\"}");return 1;}
   File.WriteAllText("recovery.txt","clean fallback worktree");
  }
  if(name.Contains("quota")){Console.WriteLine("{\"status\":\"ERROR\",\"error\":\"Account quota exceeded\",\"response\":\"Quota\",\"usage\":{\"input_tokens\":20,\"output_tokens\":5}}");return 1;}
  Console.WriteLine("{\"status\":\"SUCCESS\",\"response\":\"RECOVERED\",\"usage\":{\"input_tokens\":20,\"output_tokens\":5}}");return 0;
 }
}`;
const source=path.join(bin,'FakeProvider.cs');fs.writeFileSync(source,shim);
const baseExe=path.join(bin,'FakeProvider.exe');
const windowsRoot=process.env.WINDIR||process.env.SystemRoot;
assert.ok(windowsRoot,'The Windows installation directory is unavailable');
const compiler=['Framework64','Framework'].map(folder=>path.join(windowsRoot,'Microsoft.NET',folder,'v4.0.30319','csc.exe')).find(file=>fs.existsSync(file));
assert.ok(compiler,'Windows fault scenarios require the .NET Framework C# compiler');
const compiled=spawnSync(compiler,['/nologo','/target:exe','/out:'+baseExe,source],{encoding:'utf8',windowsHide:true});
assert.equal(compiled.status,0,compiled.stdout+'\n'+compiled.stderr);
for(const n of ['codex-auth','codex-outage','codex-quota','codex-code','codex-loginhang','codex-hang','codex-success','codex-scope-success','gemini-success','gemini-code','gemini-hang','gemini-quota'])fs.copyFileSync(baseExe,path.join(bin,n+'.exe'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const alive=pid=>{try{process.kill(Number(pid),0);return true;}catch(e){return e.code==='EPERM';}};
const report={createdAt:new Date().toISOString(),scope:'Actual isolated router/process/Git tests using locally compiled fake provider executables. No real model, account, network, API, or subscription calls.',checks:[]};
async function command(exe,args,{cwd,timeout=15000}={}) {return new Promise((resolve,reject)=>{
 const p=spawn(exe,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,MODEL_ROUTER_WORKER:'',DELTAROUTE_MANAGED_HEAD:'',DELTAROUTE_COORDINATOR:'claude'}});let stdout='',stderr='';p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);const timer=setTimeout(()=>{p.kill();reject(Error('Command timeout: '+exe));},timeout);p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('close',code=>{clearTimeout(timer);code===0?resolve({stdout,stderr}):reject(Error('Command failed ('+code+'): '+stderr+'\n'+stdout));});
 });}
async function setup(name,codex,gemini,{timeoutSeconds=30,attemptTimeoutSeconds=30}={}) {
 const dir=path.join(runDir,name);fs.mkdirSync(dir,{recursive:true});
 // Snapshot the current implementation immediately before this scenario.
 for(const f of fs.readdirSync(installed))if(f.endsWith('.mjs')){
  let content=fs.readFileSync(path.join(installed,f),'utf8');
  // Observe crashes without changing exception or recovery semantics.
  if(f==='server.mjs'){
   content=content.replace("const ROOT=path.dirname(fileURLToPath(import.meta.url));","const ROOT=path.dirname(fileURLToPath(import.meta.url));\nprocess.on('uncaughtExceptionMonitor',e=>fs.appendFileSync(path.join(ROOT,'uncaught-exceptions.log'),String(e.stack)+'\\n'));\nprocess.on('exit',code=>fs.appendFileSync(path.join(ROOT,'process-exits.log'),JSON.stringify({pid:process.pid,args:process.argv.slice(2),code})+'\\n')); ");
   content=content.replace("if(process.platform==='win32')spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true});","if(process.platform==='win32'){const k=spawnSync('taskkill',['/PID',String(pid),'/T','/F'],{windowsHide:true});fs.appendFileSync(path.join(ROOT,'taskkill.log'),JSON.stringify({pid,status:k.status,stdout:String(k.stdout||''),stderr:String(k.stderr||''),error:k.error?.message})+'\\n');}");
  }
  fs.writeFileSync(path.join(dir,f),content);
 }
 const workers={codex:{enabled:true,command:path.join(bin,codex+'.exe')},gemini:{enabled:true,transport:'antigravity',command:path.join(bin,gemini+'.exe')},cursor:{enabled:false},grok:{enabled:false},perplexity:{enabled:false},local:{enabled:false}};
 fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({maxConcurrent:2,timeoutSeconds,fallback:{maxAttempts:4,attemptTimeoutSeconds,cooldownMs:{auth:300000,quota:300000,outage:300000}},workers}));
 const project=path.join(dir,'project');fs.mkdirSync(project);await command('git',['init'],{cwd:project});fs.writeFileSync(path.join(project,'README.md'),'Original checkout\n');await command('git',['add','README.md'],{cwd:project});await command('git',['-c','user.name=Router Test','-c','user.email=router-test@example.invalid','commit','-m','fixture'],{cwd:project});
 const call=async(name,args={})=>JSON.parse((await command(process.execPath,[path.join(dir,'server.mjs'),'--call',name,JSON.stringify({...args,detail:'full'})],{cwd:project,timeout:15000})).stdout);
 const read=id=>JSON.parse(fs.readFileSync(path.join(dir,'jobs',id,'status.json'),'utf8'));
 const submit=async(extra={})=>call('submit_task',{task:'Fixture operation with automatic fallback',cwd:project,provider:'codex',category:'implementation',wait_seconds:0,...extra});
 const settle=async(id,ms=45000)=>{const until=Date.now()+ms;let j;while(Date.now()<until){j=read(id);if(!['queued','running'].includes(j.status))return j;await pause(100);}throw Error('Task did not settle: '+JSON.stringify(j));};
 return {dir,project,call,read,submit,settle};
}
const filter=process.argv.find((argument,index)=>index>=2&&!argument.startsWith('--'));
async function check(name,body){if(filter&&!name.includes(filter))return;const began=Date.now();try{await body();report.checks.push({name,passed:true,elapsedMs:Date.now()-began});console.log('PASS '+name);}catch(e){report.checks.push({name,passed:false,elapsedMs:Date.now()-began,error:'Assertion or fixture process failed; inspect private temporary diagnostics.'});console.log('FAIL '+name+': '+e.message);}}
await check('expired login falls back to Gemini without model call on Codex',async()=>{
 const t=await setup('auth','codex-auth','gemini-success');const submitted=await t.submit(),j=await t.settle(submitted.id);
 assert.equal(j.status,'completed');assert.equal(j.provider,'gemini');assert.equal(j.attempts.length,2);assert.equal(j.attempts[0].failure.kind,'auth');assert.equal(t.read(j.attempts[0].taskId).invoked,false);assert.equal(j.tokenUsage.inputTokens,20);
 const cooling=await t.call('list_workers');assert.equal(cooling.workers.find(w=>w.name==='codex').availableNow,false);const prior=t.read(j.attempts[0].taskId);prior.finishedAt='2000-01-01T00:00:00.000Z';fs.writeFileSync(path.join(t.dir,'jobs',prior.id,'status.json'),JSON.stringify(prior));const recovered=await t.call('list_workers');assert.equal(recovered.workers.find(w=>w.name==='codex').availableNow,true);
 return {taskId:j.id,status:j.status,providers:j.attempts.map(a=>a.provider),tokenUsage:j.tokenUsage,authCooldownObserved:true,cooldownExpiryReenablesProbe:true};
});
await check('outage recovers and counts failed plus successful native usage once',async()=>{
 const t=await setup('outage','codex-outage','gemini-success');const submitted=await t.submit(),j=await t.settle(submitted.id);
 assert.equal(j.status,'completed');assert.equal(j.provider,'gemini');assert.equal(j.attempts[0].failure.kind,'outage');assert.equal(j.tokenUsage.inputTokens,30);assert.equal(j.tokenUsage.outputTokens,7);assert.equal(j.tokenUsage.cacheReadTokens,4);
 const ledger=await t.call('list_workers',{include_usage:true});assert.equal(ledger.usage.inputTokens,30);assert.equal(ledger.usage.outputTokens,7);
 return {taskId:j.id,status:j.status,tokenUsage:j.tokenUsage,ledger:ledger.usage};
});
await check('hard quota moves to another subscription',async()=>{
 const t=await setup('quota','codex-quota','gemini-success');const submitted=await t.submit(),j=await t.settle(submitted.id);
 assert.equal(j.status,'completed');assert.equal(j.provider,'gemini');assert.equal(j.attempts[0].failure.kind,'quota');assert.equal(j.attempts.length,2);
 return {taskId:j.id,status:j.status,providers:j.attempts.map(a=>a.provider)};
});
await check('code fallback uses a fresh worktree and preserves original checkout',async()=>{
 const t=await setup('code','codex-code','gemini-code');const submitted=await t.submit({mode:'code'}),j=await t.settle(submitted.id);
 assert.equal(j.status,'completed');assert.equal(j.provider,'gemini');assert.equal(j.attempts.length,2);
 const first=t.read(j.attempts[0].taskId),second=t.read(j.attempts[1].taskId);assert.notEqual(first.worktree,second.worktree);assert.ok(fs.existsSync(path.join(first.worktree,'partial.txt')));assert.equal(fs.existsSync(path.join(second.worktree,'partial.txt')),false);assert.ok(fs.existsSync(path.join(second.worktree,'recovery.txt')));assert.equal(fs.existsSync(path.join(t.project,'partial.txt')),false);assert.equal(fs.existsSync(path.join(t.project,'recovery.txt')),false);assert.equal((await command('git',['status','--porcelain'],{cwd:t.project})).stdout.trim(),'');
 return {taskId:j.id,status:j.status,failedWorktree:first.worktree,successfulWorktree:second.worktree,originalUnchanged:true};
});
await check('cancellation stops active child and never launches fallback',async()=>{
 const t=await setup('cancel','codex-hang','gemini-success',{timeoutSeconds:30,attemptTimeoutSeconds:30});const submitted=await t.submit();let parent,child;const until=Date.now()+10000;
 while(Date.now()<until){parent=t.read(submitted.id);if(parent.activeAttempt){child=t.read(parent.activeAttempt);if(child.invoked&&child.childPid)break;}await pause(100);}assert.ok(child?.invoked,'hung provider actually launched');
 const cancelled=await t.call('cancel_task',{task_id:submitted.id});assert.equal(cancelled.status,'cancelled');await pause(500);
 const latest=t.read(submitted.id),active=t.read(parent.activeAttempt);assert.equal(latest.status,'cancelled');assert.equal(active.status,'cancelled');const attemptJobs=fs.readdirSync(path.join(t.dir,'jobs')).filter(n=>/^[a-f0-9-]{36}$/.test(n)).map(t.read).filter(x=>x.parentId===submitted.id);assert.equal(attemptJobs.length,1);assert.equal(attemptJobs[0].provider,'codex');
 assert.equal(alive(child.workerPid),false,'attempt process terminated');assert.equal(alive(child.childPid),false,'actual provider process terminated');
 return {taskId:latest.id,status:latest.status,childStatus:active.status,attempts:attemptJobs.length,actualProviderTerminated:true,childTokenUsage:active.tokenUsage};
});
await check('whole-attempt timeout includes a hung login probe and falls back',async()=>{
 const t=await setup('login-timeout','codex-loginhang','gemini-success',{timeoutSeconds:30,attemptTimeoutSeconds:2});const submitted=await t.submit(),j=await t.settle(submitted.id);
 assert.equal(j.status,'completed');assert.equal(j.provider,'gemini');assert.equal(j.attempts[0].status,'timed_out');assert.equal(j.attempts[0].failure.kind,'timeout');assert.equal(t.read(j.attempts[0].taskId).invoked,false);
 const providerPid=Number(fs.readFileSync(path.join(t.project,'codex-loginhang.pid'),'utf8'));assert.equal(alive(providerPid),false,'hung auth probe actually terminated');
 return {taskId:j.id,status:j.status,firstAttemptStatus:j.attempts[0].status,actualAuthProcessTerminated:true};
});
await check('timed out model retains partial native token usage before fallback',async()=>{
 const t=await setup('model-timeout','codex-hang','gemini-success',{timeoutSeconds:30,attemptTimeoutSeconds:2});const submitted=await t.submit(),j=await t.settle(submitted.id);
 assert.equal(j.status,'completed');assert.equal(j.provider,'gemini');assert.equal(j.attempts[0].status,'timed_out');assert.equal(j.tokenUsage.inputTokens,30);assert.equal(j.tokenUsage.outputTokens,7);
 const first=t.read(j.attempts[0].taskId);assert.equal(alive(first.workerPid),false);assert.equal(alive(first.childPid),false,'timed out provider actually terminated');
 return {taskId:j.id,status:j.status,tokenUsage:j.tokenUsage,actualProviderTerminated:true};
});
await check('all provider quotas exhausted yields an honest coordinator handoff',async()=>{
 const t=await setup('exhausted','codex-quota','gemini-quota');const submitted=await t.submit(),j=await t.settle(submitted.id);
 assert.equal(j.status,'needs_coordinator');assert.equal(j.attempts.length,2);assert.equal(j.handoff.action,'continue_in_current_claude_conversation');assert.ok(fs.existsSync(j.handoff.taskArtifact));assert.equal(j.answer,'');assert.equal(j.tokenUsage.inputTokens,30);assert.ok(t.read(j.id).task.includes('Fixture operation'));
 return {taskId:j.id,status:j.status,handoff:j.handoff,tokenUsage:j.tokenUsage};
});
await check('workflow preserves scoped assignment and gates dependencies until reviewed',async()=>{
 const t=await setup('workflow','codex-success','gemini-success');const plan=await t.call('submit_task',{action:'create_workflow',task:'Keep the original public API',cwd:t.project,workflow:{steps:[{id:'first',task:'Saved bounded assignment',profile:'heavy_coding',acceptance:['Fixture verified']},{id:'next',task:'Next bounded step',depends_on:['first'],acceptance:['Second fixture verified']}]}});
 await assert.rejects(t.call('submit_task',{action:'run_step',workflow_id:plan.id,step_id:'next',provider:'codex'}),/accepted checkpoints/);
 const submitted=await t.call('submit_task',{action:'run_step',workflow_id:plan.id,step_id:'first',task:'STRAY OVERRIDE',provider:'codex'}),j=await t.settle(submitted.id);assert.equal(j.status,'completed');assert.equal(j.task,'Saved bounded assignment');assert.equal(j.limits.attemptTimeoutSeconds,1800);const waiting=await t.call('get_task',{workflow_id:plan.id});assert.equal(waiting.steps[0].ready,false);assert.equal(waiting.steps[0].status,'awaiting_review');
 await assert.rejects(t.call('submit_task',{action:'checkpoint',workflow_id:plan.id,step_id:'first',checkpoint:{accepted:true,note:'Missing evidence',checks:[]}}),/acceptance/);
 await t.call('submit_task',{action:'checkpoint',workflow_id:plan.id,step_id:'first',checkpoint:{accepted:true,note:'Reviewed fixture',checks:[{criterion:'Fixture verified',passed:true,evidence:'Fake provider process returned RECOVERED; isolated harness proof'}]}});
 const next=await t.call('submit_task',{action:'run_step',workflow_id:plan.id,step_id:'next',provider:'codex'});assert.equal((await t.settle(next.id)).status,'completed');return {workflowId:plan.id,taskIds:[j.id,next.id],overrideRejected:true,dependencyGateObserved:true,heavyAttemptSeconds:j.limits.attemptTimeoutSeconds};
});
await check('workflow rejects code scope drift without a permissive fallback',async()=>{
 const t=await setup('workflow-scope','codex-scope-success','gemini-success');const plan=await t.call('submit_task',{action:'create_workflow',task:'Only edit allowed.txt',cwd:t.project,workflow:{steps:[{id:'code',task:'Edit only allowed.txt',mode:'code',allowed_paths:['allowed.txt'],acceptance:['Scoped file changed']}]}});
 const submitted=await t.call('submit_task',{action:'run_step',workflow_id:plan.id,step_id:'code',provider:'codex'}),j=await t.settle(submitted.id);assert.equal(j.status,'needs_coordinator');assert.equal(j.attempts.length,1);assert.equal(j.scopeAudit.passed,false);assert.ok(j.scopeAudit.outside.includes('outside.txt'));assert.equal(fs.existsSync(path.join(t.project,'outside.txt')),false);return {workflowId:plan.id,taskId:j.id,status:j.status,scopeAudit:j.scopeAudit,originalUnchanged:true};
});
report.passed=report.checks.filter(x=>x.passed).length;report.failed=report.checks.length-report.passed;report.finishedAt=new Date().toISOString();
assert.ok(report.checks.length,'No scenario matched the supplied filter');
const reportFile=path.join(installed,'benchmarks','windows-fault-results'+(filter?'-'+filter.replace(/[^a-z0-9-]/gi,''): '')+'.json');fs.writeFileSync(reportFile,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed,reportFile}));if(report.failed)process.exitCode=1;
// Fixtures contain no real account data but may include full local paths; never publish them.
if(!process.argv.includes('--keep-fixtures'))fs.rmSync(runDir,{recursive:true,force:true});
