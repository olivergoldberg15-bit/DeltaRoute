import config from '../models.config.json' with {type:'json'};
import {callModel} from './models.mjs';
import {tokenCost,toolCost} from './cost.mjs';
import {guard,dryRun,markHandled,buckets} from './guards.mjs';
import {createX,fetchContext} from './x.mjs';
import {search} from './search.mjs';
import {enrichMedia} from './context.mjs';
import {judge} from './judge.mjs';
import {checkFormat} from './reply-format.mjs';
import {logRun} from './log.mjs';
export async function runPost(post,{env=process.env,store,x,provider=callModel,now=new Date(),fetchImpl=fetch}={}) {
 const start=Date.now(), day=buckets(now).day;
 const entry={post_id:post.id,url:`https://x.com/i/status/${post.id}`,author:post.author_id,question:post.text,queries:null,sources:[],candidates:[],winner:null,final_text:null,mode:dryRun(env)?'dry-run':'live',tokens:[],cost:{},asked_at:now.toISOString()};
 const charge=async(providerName,amount)=>{entry.cost[providerName]=(entry.cost[providerName]||0)+amount;await store.add(`spend:${day}`,amount);};
 const withinBudget=async()=> {if(Number(await store.get(`spend:${day}`)||0)>=Number(env.DAILY_SPEND_CAP||10))throw Error('spend_cap');};
 x ||= createX(env,fetchImpl,n=>charge('x',n*config.prices.xRead));
 const preset=config.presets[env.PRESET||'top'];
 async function call(role,request) {
  await withinBudget();
  const id=role==='search'?preset.search:role==='judge'?preset.judge:role;
  const model=config.models[id];
  const result=await provider(model,{...request,env,fetchImpl});
  entry.tokens.push({model:id,provider:model.provider,usage:result.usage,tool_usage:result.toolUsage,skipped:result.skipped});
  let cost=tokenCost(model,result.usage||{},now);
  cost+=toolCost(config.prices,result.toolUsage,request.tools);
  await charge(model.provider,cost);
  return result;
 }
 try {
  if(!preset)throw Error('invalid_preset');
  const blocked=await guard(post,{env,store,now});if(blocked){entry.status=blocked;entry.latency_ms=Date.now()-start;return await logRun(store,entry);}
  const context=await enrichMedia(await fetchContext(post,x),call);
  if(!context.post.username)throw Error('missing_author_username');
  const evidence=await search(context,call); entry.queries=evidence.queries;entry.sources=evidence.sources;
  const pack={...context,...evidence,asked_at:now.toISOString()};
  const results=await Promise.allSettled(preset.answers.map(async model=>{const answer=await call(model,{input:pack});return {model,...answer};}));
  entry.candidates=results.map((r,i)=>r.status==='fulfilled'?r.value:{model:preset.answers[i],skipped:'provider_error'});
  const selection=await judge(pack,entry.candidates.filter(c=>c.text),call);
  entry.candidates=entry.candidates.map(c=>({...c,score:selection.candidates.find(s=>s.model===c.model)?.score??null}));entry.winner=selection.winner;
  let text=selection.text;
  const options={author:context.post.username,allowLinks:env.ALLOW_LINKS==='1',expectedLanguage:context.post.lang};
  let reasons=checkFormat(text,options);
  if(reasons.length){const rewrite=await call('judge',{input:{pack,text,reasons,instruction:'Rewrite once to satisfy every format rule; return only the reply.'}});text=rewrite.text;reasons=checkFormat(text,options);}
  entry.final_text=text;
  if(reasons.length){entry.status='format_failed';entry.reasons=reasons;entry.latency_ms=Date.now()-start;return await logRun(store,entry);}
  await withinBudget();
  const blockedAgain=await guard(post,{env,store,now:new Date(now)});if(blockedAgain)throw Error(blockedAgain);
  if(dryRun(env))entry.status='dry-run';
  else {
   const price=config.prices[env.ALLOW_LINKS==='1'&&/https?:\/\//.test(text)?'xReplyWithUrl':'xReply'];
   if(Number(await store.get(`spend:${day}`)||0)+price>Number(env.DAILY_SPEND_CAP||10))throw Error('spend_cap');
   // Reserve posting cost and dedupe before an ambiguous network outcome; never retry blindly.
   await charge('x',price);await markHandled(post,{env,store,now});
   const reply=await x.reply(post.id,text);if(!reply.data?.id)throw Error('missing_reply_id');entry.reply_id=reply.data.id;entry.status='posted';
  }
  if(dryRun(env))await markHandled(post,{env,store,now});
 }catch(error){entry.status='stopped';entry.reason=['spend_cap','insufficient_answers','media_unavailable','invalid_preset','kill_switch','cooldown','dedupe','hourly_limit'].includes(error.message)?error.message:'pipeline_error';}
 entry.latency_ms=Date.now()-start;
 return logRun(store,entry);
}
export async function poll({env=process.env,store,fetchImpl=fetch,provider=callModel}={}) {
 const token=crypto.randomUUID();if(!await store.lock(token))return {status:'busy'};
 try {
  if(env.KILL_SWITCH==='1'||await store.get('kill_switch')==='1')return {status:'kill_switch'};
  const day=buckets(new Date()).day;
  if(Number(await store.get(`spend:${day}`)||0)>=Number(env.DAILY_SPEND_CAP||10))return {status:'spend_cap'};
  const x=createX(env,fetchImpl,n=>store.add(`spend:${day}`,n*config.prices.xRead));
  const since=await store.get('since_id'), posts=[];
  // First run: remember where the timeline is and answer nothing, so a fresh deploy never replies to old tags.
  if(!since){const first=await x.mentions(null,null,5);if(first.meta?.newest_id)await store.set('since_id',first.meta.newest_id);return {status:'seeded',since_id:first.meta?.newest_id??null};}
  let page,newest;
  const pages=new Set();
  do {
   const mentions=await x.mentions(since,page);
   posts.push(...(mentions.data||[]));
   newest ||= mentions.meta?.newest_id;
   page=mentions.meta?.next_token;
   if(page && pages.has(page))throw Error('repeated_pagination_token');
   if(page)pages.add(page);
   if(Number(await store.get(`spend:${day}`)||0)>=Number(env.DAILY_SPEND_CAP||10))return {status:'spend_cap'};
  }while(page);
  const entries=[];
  for(const post of [...new Map(posts.map(p=>[p.id,p])).values()].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1))entries.push(await runPost(post,{env,store,x,provider,fetchImpl}));
  if(newest)await store.set('since_id',newest);
  return {entries};
 }finally{await store.unlock(token);}
}

