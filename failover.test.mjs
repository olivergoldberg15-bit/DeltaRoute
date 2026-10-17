import test from 'node:test';
import assert from 'node:assert/strict';
import {runFailover} from './failover.mjs';

const completed=(extra={})=>({status:'completed',answer:'Verified result',...extra});
const failed=error=>({status:'failed',error});
const usage=(input,output,cached)=>({available:true,inputTokens:input,outputTokens:output,cacheReadTokens:cached});

test('successful first provider stops the fallback chain and records its result',async()=>{
 const called=[],observed=[];
 const result=await runFailover({candidates:['codex','gemini'],execute:async(provider,index)=>{called.push([provider,index]);return completed({id:'first-attempt'});},onAttempt:async record=>observed.push(record)});
 assert.deepEqual(called,[['codex',0]]);
 assert.equal(result.status,'completed');
 assert.equal(result.provider,'codex');
 assert.equal(result.attempts.length,1);
 assert.equal(result.attempts[0].id,'first-attempt');
 assert.equal(observed.length,1);
});

for(const [name,error] of [
 ['expired authentication','Authentication token expired; please sign in again'],
 ['hard quota','Account quota exceeded; usage limit reached'],
 ['provider outage','HTTP 503 service unavailable'],
])test(name+' moves to the next provider without retrying the unavailable account',async()=>{
 const called=[];
 const result=await runFailover({candidates:['codex','gemini'],execute:async provider=>{called.push(provider);return provider==='codex'?failed(error):completed();}});
 assert.deepEqual(called,['codex','gemini']);
 assert.equal(result.status,'completed');
 assert.equal(result.provider,'gemini');
 assert.equal(result.attempts.length,2);
 assert.equal(result.attempts[0].error,error);
 assert.ok(result.attempts[0].failure,'Failure classification is retained with the attempt');
});

test('Cursor account quota skips Grok because both use the same account',async()=>{
 const called=[];
 const result=await runFailover({candidates:['cursor','grok','gemini'],execute:async provider=>{called.push(provider);return provider==='cursor'?failed('Cursor account quota exceeded'):completed();}});
 assert.deepEqual(called,['cursor','gemini']);
 assert.equal(result.status,'completed');
 assert.equal(result.provider,'gemini');
});

test('Cursor authentication failure skips Grok rather than retrying the same login',async()=>{
 const called=[];
 const result=await runFailover({candidates:['grok','cursor','codex'],execute:async provider=>{called.push(provider);return provider==='grok'?failed('Cursor Agent requires subscription browser login. Run login-cursor.ps1.'):completed();}});
 assert.deepEqual(called,['grok','codex']);
 assert.equal(result.status,'completed');
 assert.equal(result.provider,'codex');
});

test('accounts already blocked by the caller are skipped before launching',async()=>{
 const called=[];
 const result=await runFailover({candidates:['cursor','grok','gemini'],blockedAccounts:['cursor'],execute:async provider=>{called.push(provider);return completed();}});
 assert.deepEqual(called,['gemini']);
 assert.equal(result.provider,'gemini');
});

test('cancellation before launch prevents every provider invocation',async()=>{
 let calls=0;
 const result=await runFailover({candidates:['codex','gemini'],isCancelled:()=>true,execute:async()=>{calls++;return completed();}});
 assert.equal(calls,0);
 assert.equal(result.status,'cancelled');
 assert.equal(result.attempts.length,0);
});

test('cancellation after the first failure prevents the next provider launch',async()=>{
 const called=[];let cancelled=false;
 const result=await runFailover({candidates:['codex','gemini'],isCancelled:()=>cancelled,execute:async provider=>{called.push(provider);cancelled=true;return failed('HTTP 503 service unavailable');}});
 assert.deepEqual(called,['codex']);
 assert.equal(result.status,'cancelled');
 assert.equal(result.attempts.length,1);
});

test('cancellation during attempt notification prevents the next provider launch',async()=>{
 const called=[];let cancelled=false;
 const result=await runFailover({candidates:['codex','gemini'],isCancelled:()=>cancelled,execute:async provider=>{called.push(provider);return failed('HTTP 503 service unavailable');},onAttempt:async()=>{cancelled=true;}});
 assert.deepEqual(called,['codex']);
 assert.equal(result.status,'cancelled');
});

test('cancellation wins over a late successful response',async()=>{
 let cancelled=false;
 const result=await runFailover({candidates:['codex','gemini'],isCancelled:()=>cancelled,execute:async()=>{cancelled=true;return completed({tokenUsage:usage(10,2,0)});}});
 assert.equal(result.status,'cancelled');
 assert.equal(result.attempts.length,1);
 assert.equal(result.tokenUsage.inputTokens,10);
});

test('invalid project state stops instead of silently sending the same invalid task elsewhere',async()=>{
 const called=[],error='Code delegation requires a clean Git checkout. Commit or stash changes first, or use read-only mode.';
 const result=await runFailover({candidates:['codex','gemini'],execute:async provider=>{called.push(provider);return failed(error);}});
 assert.deepEqual(called,['codex']);
 assert.equal(result.status,'failed');
 assert.equal(result.attempts[0].error,error);
});

test('ordinary task failure is not mistaken for provider unavailability',async()=>{
 const called=[];
 const result=await runFailover({candidates:['codex','gemini'],execute:async provider=>{called.push(provider);return failed('Unit test failed: expected 2, received 3');}});
 assert.deepEqual(called,['codex']);
 assert.equal(result.status,'failed');
});

test('candidate exhaustion returns a coordinator handoff with every error retained',async()=>{
 const called=[];
 const result=await runFailover({candidates:['codex','gemini'],execute:async provider=>{called.push(provider);return failed(provider+' account quota exceeded');}});
 assert.deepEqual(called,['codex','gemini']);
 assert.equal(result.status,'needs_coordinator');
 assert.equal(result.attempts.length,2);
 assert.ok(result.attempts.every(a=>a.status==='failed'&&a.error&&a.failure));
 assert.equal(result.attempts.some(a=>a.status==='completed'),false);
});

test('an empty provider chain returns an explicit coordinator handoff',async()=>{
 let calls=0;
 const result=await runFailover({candidates:[],execute:async()=>{calls++;return completed();}});
 assert.equal(result.status,'needs_coordinator');
 assert.equal(calls,0);
 assert.deepEqual(result.attempts,[]);
});

test('duplicate candidates do not repeatedly spend the same provider allowance',async()=>{
 const called=[];
 const result=await runFailover({candidates:['codex','codex','gemini','gemini'],execute:async provider=>{called.push(provider);return failed('HTTP 503 service unavailable');}});
 assert.deepEqual(called,['codex','gemini']);
 assert.equal(result.status,'needs_coordinator');
});

test('maximum attempts bounds outages across a longer provider chain',async()=>{
 const called=[];
 const result=await runFailover({candidates:['codex','gemini','cursor','perplexity','grok'],maxAttempts:2,execute:async provider=>{called.push(provider);return failed('HTTP 503 service unavailable');}});
 assert.deepEqual(called,['codex','gemini']);
 assert.equal(result.status,'needs_coordinator');
 assert.equal(result.attempts.length,2);
});

test('token totals include failed and successful attempts exactly once',async()=>{
 const result=await runFailover({candidates:['codex','gemini'],execute:async provider=>provider==='codex'?{...failed('HTTP 503 service unavailable'),tokenUsage:usage(100,5,70)}:completed({tokenUsage:usage(200,10,150)})});
 assert.equal(result.status,'completed');
 assert.equal(result.tokenUsage.available,true);
 assert.equal(result.tokenUsage.inputTokens,300);
 assert.equal(result.tokenUsage.outputTokens,15);
 assert.equal(result.tokenUsage.cacheReadTokens,220);
 assert.equal(result.attempts[0].tokenUsage.inputTokens,100);
 assert.equal(result.attempts[1].tokenUsage.inputTokens,200);
});

test('unreported usage remains unknown rather than being reported as zero',async()=>{
 const result=await runFailover({candidates:['perplexity'],execute:async()=>completed({tokenUsage:{available:false,inputTokens:null,outputTokens:null,cacheReadTokens:null}})});
 assert.equal(result.status,'completed');
 assert.equal(result.tokenUsage.available,false);
 assert.equal(result.tokenUsage.inputTokens,null);
 assert.equal(result.tokenUsage.outputTokens,null);
});

test('missing counters from a launched attempt prevent claiming complete usage',async()=>{
 const result=await runFailover({candidates:['codex','gemini'],execute:async provider=>provider==='codex'?failed('HTTP 503 service unavailable'):completed({tokenUsage:usage(200,10,150)})});
 assert.equal(result.status,'completed');
 assert.equal(result.tokenUsage.inputTokens,200);
 assert.equal(result.tokenUsage.complete,false);
 assert.equal(result.tokenUsage.measuredAttempts,1);
 assert.equal(result.tokenUsage.unmeasuredAttempts,1);
});
