import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {parseWorkerUsage} from './telemetry.mjs';import {coordinatorUsage} from './coordinator-usage.mjs';
export function summarizeJobs(root,{since=null}={}){
 const total={scope:'Worker jobs only. Excludes coordinator usage and unreported browser/internal-agent usage. Cached reads are included in input; unknown is not zero.',since,measuredJobs:0,unmeasuredInvocations:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,apiEquivalentUSD:null,providers:{}};
 const dir=path.join(root,'jobs');if(!fs.existsSync(dir))return total;
 for(const id of fs.readdirSync(dir).filter(x=>/^[a-f0-9-]{36}$/.test(x))){try{const j=JSON.parse(fs.readFileSync(path.join(dir,id,'status.json'),'utf8'));if(j.isOrchestrator)continue;if(since&&j.createdAt<since)continue;if(!j.childPid&&!j.invoked&&j.provider!=='perplexity')continue;let u=j.tokenUsage;if(!u){const read=n=>{try{return fs.readFileSync(path.join(dir,id,n),'utf8');}catch{return '';}};u=parseWorkerUsage(j.provider,read('stdout.log'),read('stderr.log'));}const p=total.providers[j.provider]||={measuredJobs:0,unmeasuredInvocations:0,inputTokens:0,outputTokens:0,cacheReadTokens:0};if(u.available&&u.inputTokens!==null&&u.outputTokens!==null){for(const x of [p,total]){x.measuredJobs++;x.inputTokens+=u.inputTokens;x.outputTokens+=u.outputTokens;x.cacheReadTokens+=u.cacheReadTokens||0;}}else{p.unmeasuredInvocations++;total.unmeasuredInvocations++;}}catch{}}
 for(const p of Object.values(total.providers))if(!p.measuredJobs){p.inputTokens=null;p.outputTokens=null;p.cacheReadTokens=null;}
 if(!total.measuredJobs){total.inputTokens=null;total.outputTokens=null;total.cacheReadTokens=null;}
 return total;
}
// Fresh tokens: new input plus output. Gemini reports input without its cache; Codex reports input with it (freshInputTokens is the part that was not cached).
const freshOf=u=>!u?.available?null:(u.cacheReadTokens!=null&&u.inputTokens!=null&&u.cacheReadTokens>u.inputTokens?u.inputTokens:(u.freshInputTokens??u.inputTokens??0))+(u.outputTokens||0);
/**
 * One honest savings number: of the fresh tokens processed in the window, how many ran off the Claude plan.
 * Worker side: every attempt with counters, plus minutes of worker time. Claude side: Claude Code's own transcripts.
 */
export function savingsReport(root,{since=null,home,coordinator=null}={}){
 const dir=path.join(root,'jobs'),projects={};let workerFresh=0,workerMinutes=0,unmeasured=0;
 if(fs.existsSync(dir))for(const id of fs.readdirSync(dir).filter(x=>/^[a-f0-9-]{36}$/.test(x))){try{const j=JSON.parse(fs.readFileSync(path.join(dir,id,'status.json'),'utf8'));if(j.isOrchestrator||!j.invoked||since&&j.createdAt<since)continue;
  const p=projects[j.cwd||'(unknown)']||={jobs:0,freshTokens:0,minutes:0,providers:{}};const fresh=freshOf(j.tokenUsage),minutes=j.startedAt&&j.finishedAt?(Date.parse(j.finishedAt)-Date.parse(j.startedAt))/60000:0;
  p.jobs++;p.minutes+=minutes;p.providers[j.provider]=(p.providers[j.provider]||0)+1;workerMinutes+=minutes;if(fresh===null)unmeasured++;else{p.freshTokens+=fresh;workerFresh+=fresh;}}catch{}}
 for(const p of Object.values(projects))p.minutes=Math.round(p.minutes);
 const claude=coordinator||coordinatorUsage({since,home});const claudeFresh=claude.available?claude.freshTokens:null;
 const share=claudeFresh===null||workerFresh+claudeFresh===0?null:Math.round(1000*workerFresh/(workerFresh+claudeFresh))/10;
 return {since,headline:share===null?'Claude usage unknown: no Claude Code transcripts in this window.':`${share}% of fresh tokens in this window ran off your Claude plan (workers ${workerFresh.toLocaleString('en-US')}, Claude ${claudeFresh.toLocaleString('en-US')}).`,offClaudeSharePercent:share,workers:{freshTokens:workerFresh,minutes:Math.round(workerMinutes),unmeasuredAttempts:unmeasured},claude:{freshTokens:claudeFresh,cacheReadTokens:claude.cacheReadTokens??null,replies:claude.replies,sessions:claude.sessions,source:claude.source},projects,honesty:'Token counts, not plan limits: each provider weights usage its own way, and cached reads are left out on both sides. Browser workers (Perplexity, Grok, Muse) report no tokens and count as unmeasured.'};
}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
/** A static savings page (no server, nothing opens on its own). */
export function renderSavings(report){
 const rows=Object.entries(report.projects).sort((a,b)=>b[1].freshTokens-a[1].freshTokens).map(([cwd,p])=>`<tr><td>${esc(cwd)}</td><td>${p.jobs}</td><td>${p.freshTokens.toLocaleString('en-US')}</td><td>${p.minutes}</td><td>${esc(Object.entries(p.providers).map(([k,v])=>k+' '+v).join(', '))}</td></tr>`).join('');
 return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DeltaRoute savings</title><style>:root{--bg:#fff;--fg:#1a1a1a;--muted:#666;--line:#ddd;--accent:#2a6df4}@media (prefers-color-scheme:dark){:root{--bg:#141414;--fg:#eee;--muted:#999;--line:#333;--accent:#6c9cff}}body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:0 auto;padding:24px 16px}h1{font-size:20px}.big{font-size:42px;font-weight:700;color:var(--accent)}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;font-size:13px}.muted{color:var(--muted);font-size:13px}</style>
<h1>Δ DeltaRoute: Claude limit saved</h1><div class="big">${report.offClaudeSharePercent===null?'unknown':report.offClaudeSharePercent+'%'}</div><p>${esc(report.headline)}</p><p class="muted">Worker time: ${report.workers.minutes} minutes. Unmeasured attempts: ${report.workers.unmeasuredAttempts}. Since: ${esc(report.since||'all time')}.</p>
<table><tr><th>Project</th><th>Jobs</th><th>Fresh tokens off Claude</th><th>Worker minutes</th><th>Providers</th></tr>${rows}</table><p class="muted">${esc(report.honesty)}</p>`;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const root=path.dirname(fileURLToPath(import.meta.url)),since=process.argv.slice(2).find(a=>!a.startsWith('--'))||null;
 if(process.argv.includes('--savings')){const report=savingsReport(root,{since}),file=path.join(root,'state','savings.html');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,renderSavings(report));console.log(report.headline+'\nPage: '+file);}
 else console.log(JSON.stringify(summarizeJobs(root,{since}),null,2));}
