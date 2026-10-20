// Real end-to-end check: launch each enabled code worker on a tiny job and prove a file changed.
// The unit tests never launch a worker, which is how every worker died after the Oct 17 2026
// reinstall while 195 tests stayed green. This spends a little of each subscription, so it runs
// only on demand. Research workers are opt-in (--research) because they open a browser.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const MARK='deltaroute-smoke-ok';
const flag=name=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:undefined;};
const deadlineSeconds=Number(flag('--timeout')||900);
const sh=(cwd,cmd,args)=>{const r=spawnSync(cmd,args,{cwd,encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error((r.stderr||r.stdout||cmd+' failed').trim());return r.stdout;};
function call(tool,args){const r=spawnSync(process.execPath,[path.join(ROOT,'server.mjs'),'--call',tool,JSON.stringify(args)],{cwd:ROOT,encoding:'utf8',windowsHide:true,env:{...process.env,MODEL_ROUTER_WORKER:''}});if(r.status!==0)throw Error((r.stderr||'call failed').trim());return JSON.parse(r.stdout);}
function waitFor(id){const until=Date.now()+deadlineSeconds*1000;let job=call('get_task',{task_id:id,detail:'full'});while(['queued','running'].includes(job.status)&&Date.now()<until)job=call('get_task',{task_id:id,wait_seconds:45,detail:'full'});return job;}

export function codeVerdict(job,readFile){
 if(job.status!=='completed')return {verdict:'FAIL',reason:job.error||job.status};
 const winner=(job.attempts||[]).findLast(a=>a.status==='completed');const file=winner?.worktree&&path.join(winner.worktree,'SMOKE.txt');
 const text=file?readFile(file):null;
 if(text==null)return {verdict:'FAIL',reason:'reported completed but SMOKE.txt was not written'};
 return text.trim()===MARK?{verdict:'PASS',reason:'wrote SMOKE.txt in its worktree'}:{verdict:'FAIL',reason:'SMOKE.txt has the wrong content'};
}
export function researchVerdict(job){
 if(job.status==='completed')return /1889/.test(job.answer||'')?{verdict:'PASS',reason:'answered with a source'}:{verdict:'FAIL',reason:'completed without the expected fact'};
 const error=job.error||job.attempts?.at(-1)?.error||job.status;
 return /browser challenge|robot check/i.test(error)?{verdict:'BLOCKED',reason:error}:{verdict:'FAIL',reason:error};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,'config.json'),'utf8'));
 const only=flag('--workers')?.split(',');
 const coders=['codex','gemini','cursor'].filter(n=>cfg.workers[n]?.enabled&&(!only||only.includes(n)));
 const results=[];
 for(const name of coders){
  const started=Date.now();let row;
  try{
   const repo=path.join(ROOT,'state','smoke',name+'-'+started);fs.mkdirSync(repo,{recursive:true});
   sh(repo,'git',['init','-q']);sh(repo,'git',['config','user.email','smoke@deltaroute.local']);sh(repo,'git',['config','user.name','DeltaRoute smoke']);
   fs.writeFileSync(path.join(repo,'README.md'),'Smoke test repository.\n');sh(repo,'git',['add','.']);sh(repo,'git',['commit','-qm','smoke base']);
   const submitted=call('submit_task',{task:'Create a file named SMOKE.txt in the repository root containing exactly this single line: '+MARK+'\nDo not change anything else.',cwd:repo,mode:'code',provider:name,fallback:false,category:'quick_coding'});
   const job=waitFor(submitted.id||submitted.task_id);
   row={worker:name,...codeVerdict(job,f=>fs.existsSync(f)?fs.readFileSync(f,'utf8'):null),taskId:job.id};
  }catch(e){row={worker:name,verdict:'FAIL',reason:e.message};}
  row.seconds=Math.round((Date.now()-started)/1000);results.push(row);console.log(row.verdict.padEnd(8),name.padEnd(11),row.seconds+'s',' '+row.reason);
 }
 const researchers=process.argv.includes('--research')?['perplexity','grok'].filter(n=>cfg.workers[n]?.enabled&&cfg.workers[n].transport==='browser'&&(!only||only.includes(n))):[];
 for(const name of researchers){
  const started=Date.now();let row;
  try{const submitted=call('submit_task',{task:'In what year was the Eiffel Tower completed? Answer with the year and one source.',provider:name,fallback:false,category:'research'});row={worker:name,...researchVerdict(waitFor(submitted.id||submitted.task_id))};}
  catch(e){row={worker:name,verdict:'FAIL',reason:e.message};}
  row.seconds=Math.round((Date.now()-started)/1000);results.push(row);console.log(row.verdict.padEnd(8),name.padEnd(11),row.seconds+'s',' '+row.reason);
 }
 const summary={ranAt:new Date().toISOString(),results};fs.mkdirSync(path.join(ROOT,'state'),{recursive:true});fs.writeFileSync(path.join(ROOT,'state','smoke-last.json'),JSON.stringify(summary,null,1));
 if(!results.length)console.log('No enabled workers matched.');
 process.exitCode=results.some(r=>r.verdict==='FAIL')?1:0;
}
