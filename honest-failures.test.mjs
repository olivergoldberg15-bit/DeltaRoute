import {testTempRoot} from './test-fixtures.mjs';
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {classifyFailure} from './fallback-policy.mjs';
import {searchBotCheck,SEARCH_BOT_CHECK,searchQuestion,sameTarget,rankPrimaryLinks,replyAfterPrompt,PROMPT_END} from './browser.mjs';
import {changedPaths,dirtyEntries} from './workflows.mjs';
import {codeVerdict,researchVerdict} from './smoke.mjs';
// Failures that used to look like success, or like a different failure, now say what actually happened.
const tmp=fs.mkdtempSync(path.join(testTempRoot,'deltaroute-honest-'));
after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
const git=(cwd,...args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout;};
function repo(name){const dir=path.join(tmp,name);fs.mkdirSync(dir);git(dir,'init','-q');git(dir,'config','user.email','t@example.com');git(dir,'config','user.name','t');fs.writeFileSync(path.join(dir,'a.txt'),'a');git(dir,'add','.');git(dir,'commit','-qm','init');return dir;}

test('a code job that changed no files falls back like a capability failure',()=>{
 const f=classifyFailure('No changes: the code job finished but changed no files, so it is not counted as completed.');
 assert.equal(f.kind,'capability');assert.equal(f.fallbackEligible,true);assert.equal(f.blockAccount,false);
});

test('Google robot page is named as a bot check, never as a missing source',()=>{
 assert.equal(searchBotCheck('https://www.google.com/sorry/index?continue=x',''),true);
 assert.equal(searchBotCheck('https://www.google.com/search?q=x','Our systems have detected unusual traffic from your computer network.'),true);
 assert.equal(searchBotCheck('https://www.google.com/search?q=x','Results for x'),false);
 const f=classifyFailure(SEARCH_BOT_CHECK);assert.equal(f.kind,'challenge');assert.match(SEARCH_BOT_CHECK,/No bypass attempted/);
});

test('changedPaths sees tracked edits and new files, and nothing on a clean tree',()=>{
 const dir=repo('changes');assert.deepEqual(changedPaths(dir,'HEAD'),[]);
 fs.writeFileSync(path.join(dir,'a.txt'),'b');fs.writeFileSync(path.join(dir,'new.txt'),'n');
 assert.deepEqual(changedPaths(dir,'HEAD').sort(),['a.txt','new.txt']);
});

test('a dirty checkout is refused before any job exists, so no step try is used',()=>{
 const runtime=path.join(tmp,'runtime');fs.mkdirSync(runtime);
 for(const file of fs.readdirSync(import.meta.dirname))if(file.endsWith('.mjs'))fs.copyFileSync(path.join(import.meta.dirname,file),path.join(runtime,file));
 fs.writeFileSync(path.join(runtime,'config.json'),JSON.stringify({maxConcurrent:2,timeoutSeconds:1,workers:{}}));
 const dir=repo('dirty');fs.writeFileSync(path.join(dir,'unsaved.txt'),'x');
 const r=spawnSync(process.execPath,['server.mjs','--call','submit_task',JSON.stringify({task:'Edit a.txt',cwd:dir,mode:'code'})],{cwd:runtime,encoding:'utf8',windowsHide:true,env:{...process.env,MODEL_ROUTER_WORKER:''}});
 assert.equal(r.status,1);assert.match(r.stderr,/clean Git checkout.*no step try was used/s);
 assert.deepEqual(fs.readdirSync(path.join(runtime,'jobs')).filter(n=>/^[a-f0-9-]{36}$/.test(n)),[]);
});

test('primary search asks Google the question, not the brief, and keeps the old first choice',()=>{
 assert.equal(searchQuestion('Study how @grok works. Collect 30 replies.\n\nContext: REQUIRED: read the saved contract {"a":1}'),'Study how @grok works. Collect 30 replies.');
 assert.equal(searchQuestion('Search the web and find primary sources for this factual question: When was it built?\nRequired primary publisher domains: x.com.'),'When was it built?');
 assert.equal(searchQuestion(Array.from({length:40},(_,i)=>'w'+i).join(' ')).split(' ').length,32);
 assert.deepEqual(rankPrimaryLinks([{title:'',url:'https://a.test/x/y'},{title:'T',url:'https://www.google.com/goto?url=1'},{title:'T',url:'https://b.test/p/q'}]).map(l=>l.url),['https://b.test/p/q','https://a.test/x/y','https://www.google.com/goto?url=1']);
});

test('a research answer is only the reply, never the echoed prompt',()=>{
 // grok.com, 2026-10-29: the capture began with the question, twice, before Grok's reply.
 const echo='You\n\nCollect replies. '+PROMPT_END;
 assert.equal(replyAfterPrompt(echo+'\n\n'+echo+'\n\nGrok\nHere are 24 replies.'),'Grok\nHere are 24 replies.');
 assert.equal(replyAfterPrompt(echo),'');
 assert.equal(replyAfterPrompt('Perplexity shows no echo.'),'Perplexity shows no echo.');
});

test('a timed-out navigation only counts when the tab reached the target',()=>{
 assert.equal(sameTarget('https://grok.com','https://grok.com/'),true);
 assert.equal(sameTarget('https://www.google.com/search?q=a%20b','https://www.google.com/search?q=a+b&sei=1'),true);
 assert.equal(sameTarget('https://www.google.com/search?q=a','https://www.google.com/search?q=b'),false);
 assert.equal(sameTarget('https://grok.com','not a url'),false);
});

test('gstack runtime files do not make a checkout dirty; real changes still do',()=>{
 const dir=repo('gstack-files');fs.mkdirSync(path.join(dir,'.gstack'));fs.writeFileSync(path.join(dir,'.gstack','terminal-port'),'5');
 assert.deepEqual(dirtyEntries(dir),[]);
 fs.writeFileSync(path.join(dir,'a.txt'),'changed');assert.deepEqual(dirtyEntries(dir),[' M a.txt']);
});

test('a workflow research attempt is not refused for .gstack/ files, so fallback reaches the provider',()=>{
 const runtime=path.join(tmp,'runtime-gstack');fs.mkdirSync(runtime);
 for(const file of fs.readdirSync(import.meta.dirname))if(file.endsWith('.mjs'))fs.copyFileSync(path.join(import.meta.dirname,file),path.join(runtime,file));
 // No gstack install: an attempt past the checkout guard stops at "not installed", before any browser or provider call.
 fs.writeFileSync(path.join(runtime,'config.json'),JSON.stringify({maxConcurrent:2,timeoutSeconds:5,browser:{command:path.join(tmp,'no-gstack.exe')},workers:{grok:{enabled:true,transport:'browser'}}}));
 // The files gstack's terminal agent wrote into the workflow checkout on 2026-10-28.
 const dir=repo('gstack-workflow');fs.mkdirSync(path.join(dir,'.gstack'));for(const f of ['claude-available.json','terminal-agent-pid','terminal-internal-token','terminal-port'])fs.writeFileSync(path.join(dir,'.gstack',f),'x');
 const submitted=spawnSync(process.execPath,['server.mjs','--call','submit_task',JSON.stringify({task:'Edit a.txt',cwd:dir,mode:'code',provider:'codex'})],{cwd:runtime,encoding:'utf8',windowsHide:true,env:{...process.env,MODEL_ROUTER_WORKER:''}});
 assert.doesNotMatch(submitted.stderr,/clean Git checkout/);assert.match(submitted.stderr,/No enabled installed worker/);
 const baseRef=git(dir,'rev-parse','HEAD').trim();
 const attempt=()=>{const id=crypto.randomUUID();fs.mkdirSync(path.join(runtime,'jobs',id),{recursive:true});fs.writeFileSync(path.join(runtime,'jobs',id,'status.json'),JSON.stringify({id,parentId:crypto.randomUUID(),provider:'grok',category:'research',task:'Find the original source',cwd:dir,mode:'read-only',baseRef,workflowRef:{id:'w',stepId:'s'},invoked:false,status:'queued'}));spawnSync(process.execPath,['server.mjs','--attempt',id],{cwd:runtime,windowsHide:true,env:{...process.env,MODEL_ROUTER_WORKER:''}});return JSON.parse(fs.readFileSync(path.join(runtime,'jobs',id,'status.json'),'utf8'));};
 const reached=attempt();assert.equal(reached.status,'failed');assert.equal(reached.error,'gstack browser is not installed');assert.equal(reached.worktree,null);
 fs.writeFileSync(path.join(dir,'unsaved.txt'),'x');
 // Browser research reads no checkout, so unrelated edits there no longer refuse it (owner, 2026-11-03).
 assert.equal(attempt().error,'gstack browser is not installed');
});

test('smoke verdict only passes when the worker really wrote the file',()=>{
 const job={status:'completed',attempts:[{status:'completed',worktree:'/w'}]};
 assert.equal(codeVerdict(job,()=> 'deltaroute-smoke-ok\n').verdict,'PASS');
 assert.equal(codeVerdict(job,()=>null).verdict,'FAIL');
 assert.equal(codeVerdict({status:'failed',error:'No changes'},()=>null).reason,'No changes');
 assert.equal(researchVerdict({status:'needs_coordinator',error:SEARCH_BOT_CHECK}).verdict,'BLOCKED');
 assert.equal(researchVerdict({status:'completed',answer:'Completed in 1889.'}).verdict,'PASS');
});

test('when research falls back and the fallback fails too, both reasons are kept',async()=>{
 const {collectResearchEvidence}=await import('./research-quality.mjs');
 await assert.rejects(collectResearchEvidence('Research the question and cite sources',async()=>{throw Error('Provider requires browser sign-in or has exhausted its free allowance');},async()=>{throw Error(SEARCH_BOT_CHECK);}),
  e=>/failed first: Provider requires browser sign-in.*Then: Primary search browser challenge/s.test(e.message)&&classifyFailure(e.message).kind==='challenge');
});

test('smoke shows the attempt\'s real reason and flags a needed sign-in',()=>{
 const wrapped={status:'needs_coordinator',error:'Eligible external providers unavailable',attempts:[{status:'failed',error:'Research provider failed first: Provider requires browser sign-in or has exhausted its free allowance Then: '+SEARCH_BOT_CHECK}]};
 const v=researchVerdict(wrapped);assert.equal(v.verdict,'SIGN-IN');assert.match(v.reason,/requires browser sign-in/);
 assert.match(codeVerdict({status:'needs_coordinator',error:'Eligible external providers unavailable',attempts:[{status:'failed',error:'No changes: nothing written'}]},()=>null).reason,/^No changes/);
});

test('tree termination checks recorded children even when the attempt already exited',async()=>{
 const {stopProcessTrees}=await import('./server.mjs'),live=new Set([101,102,103]),stopped=[];let waits=0;
 const confirmed=await stopProcessTrees([101,102,103,101,null],{stop:pid=>{stopped.push(pid);return true;},isAlive:pid=>live.has(pid),wait:async()=>{waits++;live.clear();}});
 assert.deepEqual(stopped,[101,102,103]);assert.equal(waits,1);assert.equal(confirmed,true);
 assert.equal(await stopProcessTrees([201],{stop:()=>true,isAlive:()=>true,timeoutMs:0}),false);
 assert.equal(await stopProcessTrees([202],{stop:()=>{throw Error('taskkill failed');},isAlive:()=>true,timeoutMs:0}),false);
 assert.equal(await stopProcessTrees([203],{stop:()=>false,isAlive:()=>false,timeoutMs:0}),true);
});

test('successful taskkill output alone never confirms that a Windows process is gone',async()=>{
 const {killTree}=await import('./server.mjs');let called;
 assert.equal(killTree(321,{platform:'win32',run:(command,args,options)=>{called={command,args,options};return {status:0};},isAlive:()=>true}),false);
 assert.equal(called.command,'taskkill');assert.deepEqual(called.args,['/PID','321','/T','/F']);assert.equal(called.options.windowsHide,true);
 assert.equal(killTree(321,{platform:'win32',run:()=>({status:0}),isAlive:()=>false}),true);
});

test('a conflicting multi-file patch preserves staged, unstaged and untracked files and index bytes',async()=>{
 const {exportPatch,applyPatch}=await import('./patches.mjs'),dir=repo('patch-conflict');
 fs.writeFileSync(path.join(dir,'a.txt'),'base\n');fs.writeFileSync(path.join(dir,'b.txt'),'base\n');git(dir,'add','.');git(dir,'commit','-qm','base');const base=git(dir,'rev-parse','HEAD').trim();
 fs.writeFileSync(path.join(dir,'a.txt'),'worker\n');fs.writeFileSync(path.join(dir,'b.txt'),'worker\n');fs.mkdirSync(path.join(dir,'created'));fs.writeFileSync(path.join(dir,'created','new.txt'),'worker\n');const patch=exportPatch(dir,base,path.join(tmp,'conflict.patch'));
 git(dir,'reset','--hard',base);fs.rmSync(path.join(dir,'created'),{recursive:true});fs.writeFileSync(path.join(dir,'b.txt'),'coordinator\n');git(dir,'add','b.txt');git(dir,'commit','-qm','coordinator');
 fs.writeFileSync(path.join(dir,'staged.txt'),'staged\n');git(dir,'add','staged.txt');fs.writeFileSync(path.join(dir,'staged.txt'),'unstaged\n');fs.writeFileSync(path.join(dir,'note.txt'),'untracked\n');fs.writeFileSync(path.join(dir,'b.txt.rej'),'existing reject\n');
 const before=git(dir,'status','--porcelain=v1','-uall'),index=fs.readFileSync(path.join(dir,'.git','index')),files=Object.fromEntries(['a.txt','b.txt','staged.txt','note.txt','b.txt.rej'].map(p=>[p,fs.readFileSync(path.join(dir,p))]));
 assert.throws(()=>applyPatch(dir,patch.file),e=>/The patch does not apply to this checkout:/.test(e.message)&&e.message.includes('Conflicting files:')&&e.conflicts.includes('b.txt'));
 assert.deepEqual(fs.readFileSync(path.join(dir,'.git','index')),index);assert.equal(git(dir,'status','--porcelain=v1','-uall'),before);
 for(const [p,bytes] of Object.entries(files))assert.deepEqual(fs.readFileSync(path.join(dir,p)),bytes,p);
 assert.equal(fs.existsSync(path.join(dir,'created')),false);assert.equal(fs.existsSync(path.join(dir,'.git','index.lock')),false);assert.equal(git(dir,'ls-files','-u'),'');
});

test('three parallel patches keep the first integration when the next two conflict',async()=>{
 const {exportPatch,applyPatch}=await import('./patches.mjs'),dir=repo('parallel-patches'),base=git(dir,'rev-parse','HEAD').trim(),patches=[];
 for(let i=0;i<3;i++){fs.writeFileSync(path.join(dir,'a.txt'),'worker '+i+'\n');patches.push(exportPatch(dir,base,path.join(tmp,'parallel-'+i+'.patch')).file);git(dir,'reset','--hard',base);}
 assert.equal(applyPatch(dir,patches[0]).applied,true);const before=fs.readFileSync(path.join(dir,'a.txt')),index=fs.readFileSync(path.join(dir,'.git','index'));
 for(const file of patches.slice(1)){assert.throws(()=>applyPatch(dir,file),/Conflicting files: a.txt/);assert.deepEqual(fs.readFileSync(path.join(dir,'a.txt')),before);assert.deepEqual(fs.readFileSync(path.join(dir,'.git','index')),index);assert.equal(git(dir,'ls-files','-u'),'');assert.equal(fs.existsSync(path.join(dir,'a.txt.rej')),false);}
});

test('a clean three-way fallback applies and stages only the patch changes',async()=>{
 const {exportPatch,applyPatch}=await import('./patches.mjs'),dir=repo('patch-threeway'),baseText=Array.from({length:30},(_,i)=>'line '+i+'\n').join('');
 fs.writeFileSync(path.join(dir,'a.txt'),baseText);git(dir,'add','.');git(dir,'commit','-qm','base');const base=git(dir,'rev-parse','HEAD').trim();
 fs.writeFileSync(path.join(dir,'a.txt'),baseText.replace('line 2\n','worker\n'));const patch=exportPatch(dir,base,path.join(tmp,'threeway.patch'));git(dir,'reset','--hard',base);
 fs.writeFileSync(path.join(dir,'a.txt'),baseText.replace('line 0\n','coordinator\n'));git(dir,'add','.');git(dir,'commit','-qm','coordinator');fs.writeFileSync(path.join(dir,'staged.txt'),'keep staged\n');git(dir,'add','staged.txt');
 const applied=applyPatch(dir,patch.file);assert.equal(applied.method,'3way');assert.equal(fs.readFileSync(path.join(dir,'a.txt'),'utf8').replace(/\r\n/g,'\n'),baseText.replace('line 0\n','coordinator\n').replace('line 2\n','worker\n'));assert.equal(git(dir,'show',':staged.txt'),'keep staged\n');assert.equal(git(dir,'ls-files','-u'),'');assert.equal(fs.existsSync(path.join(dir,'.git','index.lock')),false);
});

test('patch rollback covers quoted filenames and never consumes an existing index lock',async()=>{
 const {exportPatch,applyPatch,patchPaths}=await import('./patches.mjs'),dir=repo('patch-quoted'),name='caf\u00e9.txt';
 fs.writeFileSync(path.join(dir,name),'base\n');git(dir,'add','.');git(dir,'commit','-qm','base');const base=git(dir,'rev-parse','HEAD').trim();fs.writeFileSync(path.join(dir,name),'worker\n');const patch=exportPatch(dir,base,path.join(tmp,'quoted.patch'));git(dir,'reset','--hard',base);
 assert.ok(patchPaths(fs.readFileSync(patch.file,'utf8')).includes(name));fs.writeFileSync(path.join(dir,name),'coordinator\n');git(dir,'add','.');git(dir,'commit','-qm','coordinator');const index=fs.readFileSync(path.join(dir,'.git','index'));
 assert.throws(()=>applyPatch(dir,patch.file),/Conflicting files:/);assert.equal(fs.readFileSync(path.join(dir,name),'utf8'),'coordinator\n');assert.deepEqual(fs.readFileSync(path.join(dir,'.git','index')),index);
 fs.writeFileSync(path.join(dir,'.git','index.lock'),'another Git writer');assert.throws(()=>applyPatch(dir,patch.file));assert.equal(fs.readFileSync(path.join(dir,'.git','index.lock'),'utf8'),'another Git writer');
});

test('the apply_patch action reports conflicts without changing the checkout and refuses unsafe attempts',async()=>{
 const {exportPatch}=await import('./patches.mjs'),runtime=path.join(tmp,'runtime-apply');fs.mkdirSync(runtime);
 for(const file of fs.readdirSync(import.meta.dirname))if(file.endsWith('.mjs'))fs.copyFileSync(path.join(import.meta.dirname,file),path.join(runtime,file));
 const dir=repo('action-patch'),base=git(dir,'rev-parse','HEAD').trim();fs.writeFileSync(path.join(dir,'a.txt'),'worker\n');const patch=exportPatch(dir,base,path.join(tmp,'action.patch'));git(dir,'reset','--hard',base);fs.writeFileSync(path.join(dir,'a.txt'),'coordinator\n');
 const id=crypto.randomUUID(),attemptId=crypto.randomUUID(),job={id,status:'failed',cwd:dir,attempts:[{taskId:attemptId}]},attempt={id:attemptId,status:'failed',patch,terminationConfirmed:true};
 for(const j of [job,attempt]){fs.mkdirSync(path.join(runtime,'jobs',j.id),{recursive:true});fs.writeFileSync(path.join(runtime,'jobs',j.id,'status.json'),JSON.stringify(j));}
 const apply=()=>spawnSync(process.execPath,['server.mjs','--call','submit_task',JSON.stringify({action:'apply_patch',task_id:id})],{cwd:runtime,encoding:'utf8',windowsHide:true,env:{...process.env,MODEL_ROUTER_WORKER:''}}),index=fs.readFileSync(path.join(dir,'.git','index'));
 const conflict=apply();assert.equal(conflict.status,1);assert.match(conflict.stderr,/The patch does not apply to this checkout:.*Conflicting files: a.txt/s);assert.equal(fs.readFileSync(path.join(dir,'a.txt'),'utf8'),'coordinator\n');assert.deepEqual(fs.readFileSync(path.join(dir,'.git','index')),index);assert.equal(fs.existsSync(path.join(dir,'a.txt.rej')),false);assert.equal(git(dir,'ls-files','-u'),'');
 fs.writeFileSync(path.join(runtime,'jobs',attemptId,'status.json'),JSON.stringify({...attempt,terminationConfirmed:false}));const unsafe=apply();assert.equal(unsafe.status,1);assert.match(unsafe.stderr,/Wait for the job to stop before applying its patch/);
});
