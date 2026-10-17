import {classifyFailure,accountKey} from './fallback-policy.mjs';
export function aggregateAttemptUsage(attempts){
 const rows=attempts.filter(a=>a.invoked!==false).map(a=>a.tokenUsage||{available:false,inputTokens:null,outputTokens:null}),known=rows.filter(u=>u.available&&u.inputTokens!==null&&u.outputTokens!==null);
 const sum=k=>known.reduce((n,u)=>n+(u[k]||0),0);return {available:known.length>0,complete:rows.length>0&&known.length===rows.length,source:'Sum of native counters across fallback attempts; unknown usage is excluded, never zero',measuredAttempts:known.length,unmeasuredAttempts:rows.length-known.length,inputTokens:known.length?sum('inputTokens'):null,outputTokens:known.length?sum('outputTokens'):null,cacheReadTokens:known.length?sum('cacheReadTokens'):null,cacheWriteTokens:known.length?sum('cacheWriteTokens'):null,thinkingTokens:null,apiEquivalentUSD:null};
}
export async function runFailover({candidates,execute,isCancelled=()=>false,onAttempt=async()=>{},maxAttempts=4,blockedAccounts=[]}){
 const attempts=[],blocked=new Set(blockedAccounts),limit=Number.isFinite(Number(maxAttempts))?Math.max(1,Math.min(8,Math.floor(Number(maxAttempts)))):4;let final;
 for(const provider of [...new Set(candidates)]){
  if(isCancelled())return {status:'cancelled',attempts,tokenUsage:aggregateAttemptUsage(attempts)};
  if(attempts.length>=limit||blocked.has(accountKey(provider)))continue;
  let result;try{result=await execute(provider,attempts.length);}catch(e){result={status:'failed',error:e.message,invoked:false};}
  const record={provider,...result};if(record.status!=='completed')record.failure=classifyFailure(record.error||record.status);attempts.push(record);await onAttempt(record);
  if(isCancelled()||record.status==='cancelled')return {status:'cancelled',attempts,tokenUsage:aggregateAttemptUsage(attempts)};
  if(record.handoffRequired){final={status:'needs_coordinator',provider,error:record.error,attempts,tokenUsage:aggregateAttemptUsage(attempts)};break;}
  if(record.status==='completed'){final={status:'completed',provider,attempts,tokenUsage:aggregateAttemptUsage(attempts)};break;}
  if(record.failure.blockAccount)blocked.add(accountKey(provider));
  if(!record.failure.fallbackEligible){final={status:'failed',provider,error:record.error,attempts,tokenUsage:aggregateAttemptUsage(attempts)};break;}
 }
 return final||{status:'needs_coordinator',error:'Eligible external providers unavailable or configured attempt limit reached. Continue in the current coordinator conversation; no recursive coordinator process was started.',attempts,tokenUsage:aggregateAttemptUsage(attempts)};
}
