import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createX} from '../src/x.mjs';
import {MemoryStore} from '../src/store.mjs';
import {pkce,authorizeUrl,exchangeCode} from '../scripts/x-auth.mjs';
const json=(data,status=200)=>({ok:status<400,status,json:async()=>data});
const env={X_BOT_ID:'bot',X_CLIENT_ID:'cid'};
test('the bot renews its X token from the stored refresh token and saves the rotated one', async () => {
 const store=new MemoryStore();await store.set('x:refresh_token','r1');const calls=[];
 const x=createX(env,async(url,init)=>{calls.push({url,init});return url.endsWith('/oauth2/token')?json({access_token:'a1',refresh_token:'r2',expires_in:7200}):json({data:[]});},()=>{},store);
 await x.mentions('1');await x.mentions('2');
 const refreshes=calls.filter(c=>c.url.endsWith('/oauth2/token'));assert.equal(refreshes.length,1);
 assert.deepEqual(Object.fromEntries(new URLSearchParams(refreshes[0].init.body)),{grant_type:'refresh_token',refresh_token:'r1',client_id:'cid'});
 assert.equal(calls.filter(c=>c.url.includes('/mentions')).every(c=>c.init.headers.Authorization==='Bearer a1'),true);
 assert.equal(await store.get('x:refresh_token'),'r2');
});
test('a 401 gets one fresh token and one retry, never a loop', async () => {
 const store=new MemoryStore();await store.set('x:refresh_token','r1');await store.set('x:access_token','expired');let api=0,refreshes=0;
 const x=createX(env,async(url,init)=>{if(url.endsWith('/oauth2/token')){refreshes++;return json({access_token:'a'+refreshes,refresh_token:'r'+(refreshes+1),expires_in:7200});}api++;return init.headers.Authorization==='Bearer a1'&&api===2?json({data:{id:'9'}}):json({},401);},()=>{},store);
 assert.equal((await x.reply('1','Answer')).data.id,'9');assert.equal(refreshes,1);
 await assert.rejects(x.mentions('1'),/x_http_error/);assert.equal(refreshes,2);
});
test('a confidential app sends its client secret as Basic auth; no client id keeps the fixed token', async () => {
 const store=new MemoryStore();await store.set('x:refresh_token','r1');let auth;
 await createX({...env,X_CLIENT_SECRET:'s'},async(url,init)=>{if(url.endsWith('/oauth2/token'))auth=init.headers.Authorization;return json({access_token:'a',refresh_token:'r',expires_in:7200,data:[]});},()=>{},store).mentions('1');
 assert.equal(auth,'Basic '+Buffer.from('cid:s').toString('base64'));
 let header;await createX({X_BOT_ID:'bot',X_ACCESS_TOKEN:'fixed'},async(url,init)=>{header=init.headers.Authorization;return json({data:[]});}).mentions('1');assert.equal(header,'Bearer fixed');
 await assert.rejects(createX(env,async()=>json({}),()=>{},new MemoryStore()).mentions('1'),/x_refresh_token_missing/);
});
test('one-time sign-in uses PKCE S256 with offline access and stores the tokens', async () => {
 const p=pkce();assert.equal(p.challenge,crypto.createHash('sha256').update(p.verifier).digest('base64url'));
 const url=new URL(authorizeUrl({clientId:'cid',challenge:p.challenge,state:p.state}));
 assert.equal(url.origin+url.pathname,'https://x.com/i/oauth2/authorize');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.match(url.searchParams.get('scope'),/tweet\.write.*offline\.access/);assert.equal(url.searchParams.get('state'),p.state);
 const store=new MemoryStore();
 const me=await exchangeCode({env,store,code:'c',verifier:p.verifier,fetchImpl:async(u,init)=>u.endsWith('/oauth2/token')?(assert.equal(new URLSearchParams(init.body).get('code_verifier'),p.verifier),json({access_token:'a',refresh_token:'r',expires_in:7200})):json({data:{id:'42',username:'helperbot'}})});
 assert.deepEqual(me,{id:'42',username:'helperbot'});assert.equal(await store.get('x:refresh_token'),'r');assert.equal(await store.get('x:access_token'),'a');
 await assert.rejects(exchangeCode({env,store,code:'c',verifier:'v',fetchImpl:async()=>json({access_token:'a'})}),/offline\.access/);
});
