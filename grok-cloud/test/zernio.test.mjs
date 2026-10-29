import test from 'node:test';
import assert from 'node:assert/strict';
import {createZernioX} from '../src/zernio.mjs';
import {xClient,fetchContext} from '../src/x.mjs';
import {poll} from '../src/pipeline.mjs';
import {MemoryStore} from '../src/store.mjs';
import {fixtureProvider} from '../fixtures/stubs.mjs';
import {setupLines} from '../scripts/zernio-setup.mjs';
const json=(data,status=200)=>({ok:status<400,status,json:async()=>data});
const env={ZERNIO_API_KEY:'zk',ZERNIO_ACCOUNT_ID:'acc1',X_BOT_ID:'bot',X_BOT_HANDLE:'helper'};
const tweet=(id,text,author,parent=null)=>({id,text,created:'2026-10-29T10:00:00Z',conversationId:'c',inReplyToTweetId:parent,lang:'en',author:{id:author,username:author}});
test('Zernio finds tags with X search on the bot handle and maps them to X posts', async () => {
 const calls=[];let charged=0;
 const x=createZernioX(env,async(url,init)=>{calls.push({url,init});return json({status:'success',tweets:[tweet('5','@helper is this true?','alice','4')],pagination:{hasMore:true,cursor:'n2'},meta:{newestId:'5'}});},n=>{charged+=n;});
 const r=await x.mentions('3',null,5);const u=new URL(calls[0].url);
 assert.equal(u.origin+u.pathname,'https://zernio.com/api/v1/twitter/search');assert.equal(u.searchParams.get('query'),'@helper -from:helper');assert.equal(u.searchParams.get('sinceId'),'3');assert.equal(u.searchParams.get('limit'),'10');assert.equal(u.searchParams.get('accountId'),'acc1');
 assert.equal(calls[0].init.headers.Authorization,'Bearer zk');
 assert.deepEqual(r.data[0],{id:'5',text:'@helper is this true?',author_id:'alice',lang:'en',created_at:'2026-10-29T10:00:00Z',conversation_id:'c',referenced_tweets:[{type:'replied_to',id:'4'}]});
 assert.equal(r.meta.newest_id,'5');assert.equal(r.meta.next_token,'n2');assert.equal(charged,1);
});
test('Zernio tweet lookup walks the reply thread', async () => {
 const posts={'5':tweet('5','@helper is this true?','alice','4'),'4':tweet('4','The tower opened in 1889.','bob')};
 const x=createZernioX(env,async url=>json({status:'success',tweet:posts[new URL(url).searchParams.get('tweetId')]}));
 const context=await fetchContext({id:'5'},x);
 assert.equal(context.post.username,'alice');assert.deepEqual(context.thread.map(p=>p.id),['4']);assert.deepEqual(context.media,[]);
});
test('Zernio replies with replyToTweetId and one idempotency key per post; a failed publish throws', async () => {
 let sent;const x=createZernioX(env,async(url,init)=>{sent={url,init};return json({post:{_id:'z1',status:'published',platforms:[{platform:'twitter',status:'published',platformPostId:'900',platformPostUrl:'https://x.com/helper/status/900'}]}},201);});
 const r=await x.reply('5','Yes, 1889.');const body=JSON.parse(sent.init.body);
 assert.equal(sent.url,'https://zernio.com/api/v1/posts');assert.equal(sent.init.method,'POST');assert.equal(sent.init.headers['Idempotency-Key'],'grok-cloud-reply-5');
 assert.deepEqual(body,{content:'Yes, 1889.',platforms:[{platform:'twitter',accountId:'acc1',platformSpecificData:{replyToTweetId:'5'}}],publishNow:true});assert.equal(r.data.id,'900');
 const failed=createZernioX(env,async()=>json({post:{status:'failed',platforms:[{platform:'twitter',status:'failed',errorMessage:'X (Twitter) does not allow duplicate tweets'}]}},207));
 await assert.rejects(failed.reply('5','Yes, 1889.'),/zernio_publish_failed/);
 await assert.rejects(createZernioX(env,async()=>json({},401)).post('5'),/zernio_http_error/);
});
test('the bot uses Zernio only when a Zernio key is set', async () => {
 let host;await xClient(env,async url=>{host=new URL(url).host;return json({tweets:[],meta:{}});}).mentions('1');assert.equal(host,'zernio.com');
 await xClient({X_BOT_ID:'bot',X_ACCESS_TOKEN:'t'},async url=>{host=new URL(url).host;return json({data:[]});}).mentions('1');assert.equal(host,'api.x.com');
 assert.throws(()=>xClient({ZERNIO_API_KEY:'zk'}),/zernio_account_required/);
});
test('a full poll through Zernio seeds, drafts in dry-run, and replies only when live', async () => {
 let timeline=[tweet('100','@helper old tag','u0')];const posted=[];
 const fetchImpl=async(url,init={})=>{const u=new URL(url);
  if(u.pathname.endsWith('/twitter/search')){const since=u.searchParams.get('sinceId');const tweets=timeline.filter(t=>!since||BigInt(t.id)>BigInt(since));return json({tweets,pagination:{hasMore:false,cursor:null},meta:{newestId:tweets.at(-1)?.id??null}});}
  if(u.pathname.endsWith('/twitter/tweet'))return json({tweet:timeline.find(t=>t.id===u.searchParams.get('tweetId'))});
  if(u.pathname.endsWith('/posts')){const b=JSON.parse(init.body);posted.push(b.platforms[0].platformSpecificData.replyToTweetId);return json({post:{status:'published',platforms:[{platform:'twitter',status:'published',platformPostId:'9'+posted.length}]}},201);}
  throw Error('unexpected call '+url);};
 const store=new MemoryStore();
 assert.equal((await poll({env,store,fetchImpl,provider:fixtureProvider})).status,'seeded');
 timeline.push(tweet('101','@helper is this true?','alice'),tweet('102','no tag here','carol'));
 const dry=await poll({env,store,fetchImpl,provider:fixtureProvider});
 assert.deepEqual(dry.entries.map(e=>e.status),['dry-run','untagged']);assert.equal(posted.length,0);
 timeline.push(tweet('103','@helper explain this','dave'));
 const live=await poll({env:{...env,LIVE:'1'},store,fetchImpl,provider:fixtureProvider});
 assert.deepEqual(live.entries.map(e=>e.status),['posted']);assert.deepEqual(posted,['103']);
});
test('Zernio setup prints the account values to set, never a key', () => {
 assert.deepEqual(setupLines([{accountId:'acc1',username:'helper',xUserId:'42'}]),['@helper:','  ZERNIO_ACCOUNT_ID=acc1','  X_BOT_ID=42','  X_BOT_HANDLE=helper']);
 assert.match(setupLines([])[0],/No X account is connected/);
});
