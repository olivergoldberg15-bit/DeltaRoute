import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readCodexAccountLimits,normalizeCodexAccountLimits} from './account-limits.mjs';

const now=Date.parse('2026-10-17T20:00:00Z');
const seconds=iso=>Date.parse(iso)/1000;
const window=(usedPercent,resetsAt)=>({usedPercent,resetsAt:seconds(resetsAt),windowDurationMins:300});
function fixture(handler) {
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
  child.stdin=new EventEmitter();child.messages=[];child.ended=false;child.killed=false;
  child.stdin.end=()=>{child.ended=true;};
  child.kill=()=>{child.killed=true;return true;};
  child.stdin.write=text=>{const message=JSON.parse(text);child.messages.push(message);queueMicrotask(()=>handler(message,child));return true;};
  return child;
}
function response(child,id,result){child.stdout.emit('data',Buffer.from(JSON.stringify({id,result})+'\n'));}

test('official handshake reads usage only, disables reserve, sanitizes data and kills helper',async()=>{
  const child=fixture((message,proc)=>{
    if(message.id===1)response(proc,1,{userAgent:'native'});
    if(message.id===2)response(proc,2,{ordinaryUsageAllowed:false,accountId:'must-not-return',rateLimits:{limitId:'codex',
      primary:window(100,'2026-10-17T21:00:00Z'),secondary:window(100,'2026-10-20T20:00:00Z')}});
  });
  let args,options;
  const result=await readCodexAccountLimits('codex.exe',{now,spawnImpl:(command,a,o)=>{assert.equal(command,'codex.exe');args=a;options=o;return child;}});
  assert.deepEqual(args,['app-server','--stdio']);assert.equal(options.windowsHide,true);
  assert.deepEqual(child.messages.map(row=>row.method),['initialize','initialized','account/rateLimits/read']);
  assert.equal(child.messages[2].params.supportsLunaReserve,false);
  assert.equal(result.ordinaryUsageAllowed,false);assert.equal(result.resetsAt,'2026-10-17T21:00:00.000Z');
  assert.equal(result.windows.length,2);assert.ok(!JSON.stringify(result).includes('must-not-return'));
  assert.equal(child.killed,true);assert.equal(child.ended,true);
});

test('percentages or elapsed reset clocks never infer ordinary usage permission',()=>{
  for(const ordinaryUsageAllowed of [null,undefined]) {
    const result=normalizeCodexAccountLimits({ordinaryUsageAllowed,rateLimits:{primary:window(0,'2026-10-17T19:00:00Z')}},{now});
    assert.equal(result.ordinaryUsageAllowed,null);assert.equal(result.resetsAt,null);
  }
  const blocked=normalizeCodexAccountLimits({ordinaryUsageAllowed:false,rateLimits:{primary:window(100,'2026-10-17T19:00:00Z')}},{now});
  assert.equal(blocked.ordinaryUsageAllowed,false);assert.equal(blocked.resetsAt,null);
});

test('only blocked coding windows determine recheck time; other buckets are irrelevant',()=>{
  const result=normalizeCodexAccountLimits({ordinaryUsageAllowed:false,rateLimits:{primary:window(100,'2026-10-17T20:01:00Z')},
    rateLimitsByLimitId:{codex:{limitId:'codex',primary:window(99,'2026-10-17T20:02:00Z'),secondary:window(100,'2026-10-19T20:00:00Z')},
      image:{primary:window(100,'2026-10-17T20:00:01Z')}}},{now});
  assert.equal(result.resetsAt,'2026-10-19T20:00:00.000Z');assert.equal(result.windows.length,2);
});

test('missing or invalid reset hints stay unknown',()=>{
  const result=normalizeCodexAccountLimits({ordinaryUsageAllowed:false,rateLimits:{primary:{usedPercent:100,resetsAt:null},
    secondary:{usedPercent:100,resetsAt:1e100,windowDurationMins:-5}}},{now});
  assert.equal(result.resetsAt,null);assert.equal(result.windows[1].resetsAt,null);
  assert.equal(result.windows[1].windowDurationMins,null);
});

test('timeout terminates helper and reports unavailable without assuming zero usage',async()=>{
  const child=fixture(()=>{});const result=await readCodexAccountLimits('codex.exe',{timeoutMs:8,spawnImpl:()=>child});
  assert.equal(result.available,false);assert.equal(result.ordinaryUsageAllowed,null);assert.match(result.error,/timed out/);
  assert.equal(child.killed,true);
});

test('RPC failure excludes backend account details and terminates helper',async()=>{
  const child=fixture((message,proc)=>{if(message.id===1)response(proc,1,{});if(message.id===2)proc.stdout.emit('data',
    JSON.stringify({id:2,error:{code:-32000,message:'private account payload'}})+'\n');});
  const result=await readCodexAccountLimits('codex.exe',{spawnImpl:()=>child});
  assert.equal(result.available,false);assert.match(result.error,/-32000/);assert.ok(!JSON.stringify(result).includes('private account'));
  assert.equal(child.killed,true);
});

test('malformed protocol fails closed and terminates helper',async()=>{
  const child=fixture((message,proc)=>{if(message.id===1)proc.stdout.emit('data','not json\n');});
  const result=await readCodexAccountLimits('codex.exe',{spawnImpl:()=>child});
  assert.equal(result.available,false);assert.match(result.error,/invalid JSON/);assert.equal(child.killed,true);
});

test('JSON primitive is not accepted as a protocol message',async()=>{
  const child=fixture((message,proc)=>{if(message.id===1)proc.stdout.emit('data','null\n');});
  const result=await readCodexAccountLimits('codex.exe',{spawnImpl:()=>child});
  assert.equal(result.available,false);assert.match(result.error,/invalid message/);assert.equal(child.killed,true);
});

test('spawn errors and early exit are unavailable, not recovered',async()=>{
  const thrown=await readCodexAccountLimits('missing',{spawnImpl:()=>{const error=new Error('secret diagnostics');error.code='ENOENT';throw error;}});
  assert.equal(thrown.available,false);assert.match(thrown.error,/ENOENT/);assert.ok(!thrown.error.includes('secret'));
  const child=fixture((message,proc)=>{if(message.id===1)proc.emit('exit',1);});
  const exited=await readCodexAccountLimits('codex.exe',{spawnImpl:()=>child});assert.equal(exited.ordinaryUsageAllowed,null);
});

test('chunked JSON and unsolicited notifications do not confuse response correlation',async()=>{
  const child=fixture((message,proc)=>{
    if(message.id===1){proc.stdout.emit('data','{"method":"notice","params":{}}\n');response(proc,99,{ordinaryUsageAllowed:false});response(proc,1,{});}
    if(message.id===2){const data=JSON.stringify({id:2,result:{ordinaryUsageAllowed:true,rateLimits:{}}})+'\n';
      proc.stdout.emit('data',data.slice(0,13));proc.stdout.emit('data',data.slice(13));}
  });
  const result=await readCodexAccountLimits('codex.exe',{spawnImpl:()=>child});assert.equal(result.available,true);
  assert.equal(result.ordinaryUsageAllowed,true);assert.equal(result.resetsAt,null);
});
