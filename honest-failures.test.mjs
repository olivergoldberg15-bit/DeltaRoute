import {testTempRoot} from './test-fixtures.mjs';
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {classifyFailure} from './fallback-policy.mjs';
import {searchBotCheck,SEARCH_BOT_CHECK} from './browser.mjs';
import {changedPaths} from './workflows.mjs';
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
