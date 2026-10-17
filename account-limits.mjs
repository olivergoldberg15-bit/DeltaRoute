import {spawn} from 'node:child_process';

const EMPTY = Object.freeze({available:false,ordinaryUsageAllowed:null,resetsAt:null,windows:[]});

function timestamp(value) {
  // The app-server protocol defines reset timestamps as Unix seconds.
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0)return null;
  const date=new Date(value*1000);
  return Number.isNaN(date.getTime())?null:date.toISOString();
}

/** Sanitize account/rateLimits/read; never infer permission from a clock or percentage. */
export function normalizeCodexAccountLimits(result,{now=Date.now()}={}) {
  if(!result||typeof result!=='object'||Array.isArray(result))return {...EMPTY,error:'Codex usage response was missing.'};
  const byId=result.rateLimitsByLimitId;
  // The legacy view is the ordinary Codex bucket. Other buckets (for example image
  // generation) must not determine when the coding coordinator is rechecked.
  const snapshot=byId&&typeof byId==='object'&&byId.codex&&typeof byId.codex==='object'
    ?byId.codex:result.rateLimits;
  const windows=[];
  for(const kind of ['primary','secondary']) {
    const value=snapshot?.[kind];
    if(!value||typeof value!=='object')continue;
    const usedPercent=typeof value.usedPercent==='number'&&Number.isFinite(value.usedPercent)&&value.usedPercent>=0?value.usedPercent:null;
    const minutes=value.windowDurationMins;
    windows.push({limitId:typeof snapshot.limitId==='string'?snapshot.limitId:'codex',kind,usedPercent,
      windowDurationMins:typeof minutes==='number'&&Number.isFinite(minutes)&&minutes>0?minutes:null,
      resetsAt:timestamp(value.resetsAt),blocked:usedPercent!==null&&usedPercent>=100});
  }
  const resets=windows.filter(value=>value.blocked&&value.resetsAt&&Date.parse(value.resetsAt)>now)
    .map(value=>value.resetsAt).sort((a,b)=>Date.parse(a)-Date.parse(b));
  return {available:true,ordinaryUsageAllowed:typeof result.ordinaryUsageAllowed==='boolean'?result.ordinaryUsageAllowed:null,
    resetsAt:resets[0]||null,windows};
}

/**
 * Read the official native app-server usage endpoint without starting a model turn.
 * spawnImpl and now are dependency-injection seams for offline protocol tests.
 * Reset times only schedule a future read; ordinaryUsageAllowed is authoritative.
 */
export async function readCodexAccountLimits(command,{timeoutMs=15000,spawnImpl=spawn,now=Date.now()}={}) {
  if(typeof command!=='string'||!command.trim())return {...EMPTY,error:'Codex executable is not configured.'};
  const deadline=Number.isFinite(timeoutMs)&&timeoutMs>0?Math.min(timeoutMs,60000):15000;
  return new Promise(resolve=>{
    let child,done=false,buffer='',stage='initializing',timer;
    function finish(value) {
      if(done)return;
      done=true;clearTimeout(timer);
      try{child?.stdin?.end();}catch{}
      // No model/thread was started, so the private stdio helper has no worker to
      // leave behind. Closing this helper never interrupts another native chat.
      try{child?.kill();}catch{}
      resolve(value);
    }
    function fail(message){finish({...EMPTY,error:message});}
    function send(message) {
      try{child.stdin.write(JSON.stringify(message)+'\n');}
      catch{fail('Codex usage protocol pipe failed.');}
    }
    try {
      child=spawnImpl(command,['app-server','--stdio'],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    } catch(error) {
      fail(`Codex usage helper could not start${error?.code&&/^[A-Z0-9_]+$/.test(error.code)?` (${error.code})`:''}.`);return;
    }
    timer=setTimeout(()=>fail('Codex usage read timed out.'),deadline);
    child.on('error',()=>fail('Codex usage helper failed to start.'));
    child.on('exit',()=>{if(!done)fail('Codex usage helper exited before replying.');});
    child.stdin.on?.('error',()=>fail('Codex usage protocol pipe failed.'));
    // Drain stderr without retaining or returning it: it can contain account or
    // environment diagnostics which are unnecessary for quota decisions.
    child.stderr?.on('data',()=>{});
    child.stdout.on('data',chunk=>{
      if(done)return;
      buffer+=chunk.toString();
      if(buffer.length>2_000_000){fail('Codex usage response exceeded the safe protocol size.');return;}
      let newline;
      while(!done&&(newline=buffer.indexOf('\n'))>=0) {
        const line=buffer.slice(0,newline).trim();buffer=buffer.slice(newline+1);
        if(!line)continue;
        let message;try{message=JSON.parse(line);}catch{fail('Codex usage protocol returned invalid JSON.');break;}
        if(!message||typeof message!=='object'||Array.isArray(message)){fail('Codex usage protocol returned an invalid message.');break;}
        const expected=stage==='initializing'?1:2;
        // Startup notifications are unrelated to this request. Never acknowledge
        // a request which could authorize login, tool execution or a model turn.
        if(message.id!==expected||!Object.hasOwn(message,'result')&&!Object.hasOwn(message,'error'))continue;
        if(message.error){fail(`Codex usage request was rejected${Number.isInteger(message.error.code)?` (RPC ${message.error.code})`:''}.`);break;}
        if(stage==='initializing') {
          stage='reading';
          send({method:'initialized',params:{}});
          send({id:2,method:'account/rateLimits/read',params:{excludeResetCreditDetails:true,supportsLunaReserve:false}});
        } else finish(normalizeCodexAccountLimits(message.result,{now}));
      }
    });
    send({id:1,method:'initialize',params:{clientInfo:{name:'deltaroute-usage',title:'DeltaRoute usage reader',version:'1.0.0'},
      capabilities:{experimentalApi:false,requestAttestation:false,explicitGatewayOauth:true}}});
  });
}
