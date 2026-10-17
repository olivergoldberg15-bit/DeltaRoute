import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {parseWorkerUsage} from './telemetry.mjs';
export function summarizeJobs(root,{since=null}={}){
 const total={scope:'Worker jobs only. Excludes coordinator usage and unreported browser/internal-agent usage. Cached reads are included in input; unknown is not zero.',since,measuredJobs:0,unmeasuredInvocations:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,apiEquivalentUSD:null,providers:{}};
 const dir=path.join(root,'jobs');if(!fs.existsSync(dir))return total;
 for(const id of fs.readdirSync(dir).filter(x=>/^[a-f0-9-]{36}$/.test(x))){try{const j=JSON.parse(fs.readFileSync(path.join(dir,id,'status.json'),'utf8'));if(j.isOrchestrator)continue;if(since&&j.createdAt<since)continue;if(!j.childPid&&!j.invoked&&j.provider!=='perplexity')continue;let u=j.tokenUsage;if(!u){const read=n=>{try{return fs.readFileSync(path.join(dir,id,n),'utf8');}catch{return '';}};u=parseWorkerUsage(j.provider,read('stdout.log'),read('stderr.log'));}const p=total.providers[j.provider]||={measuredJobs:0,unmeasuredInvocations:0,inputTokens:0,outputTokens:0,cacheReadTokens:0};if(u.available&&u.inputTokens!==null&&u.outputTokens!==null){for(const x of [p,total]){x.measuredJobs++;x.inputTokens+=u.inputTokens;x.outputTokens+=u.outputTokens;x.cacheReadTokens+=u.cacheReadTokens||0;}}else{p.unmeasuredInvocations++;total.unmeasuredInvocations++;}}catch{}}
 for(const p of Object.values(total.providers))if(!p.measuredJobs){p.inputTokens=null;p.outputTokens=null;p.cacheReadTokens=null;}
 if(!total.measuredJobs){total.inputTokens=null;total.outputTokens=null;total.cacheReadTokens=null;}
 return total;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(summarizeJobs(path.dirname(fileURLToPath(import.meta.url)),{since:process.argv[2]||null}),null,2));
