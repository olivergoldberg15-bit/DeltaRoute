import test from 'node:test';
import assert from 'node:assert/strict';
import {xLength,replyLimit,checkFormat} from '../src/format.mjs';
import {answerSystem,callModel} from '../src/models.mjs';
import {runPost} from '../src/pipeline.mjs';
import {MemoryStore} from '../src/store.mjs';
import {fixtureProvider,fixtureX} from '../fixtures/stubs.mjs';
test('replies are counted the way X counts them', () => {
 assert.equal(xLength('abc'),3);assert.equal(xLength('日本'),4);assert.equal(xLength('👍'),2);assert.equal(xLength('“Yes” — 1889.'),13);
 assert.equal(xLength('see https://x.com/a/b ok'),30);
});
test('the reply limit follows the bot account type', () => {
 assert.equal(replyLimit({}),280);assert.equal(replyLimit({X_PREMIUM:'1'}),549);
 assert.deepEqual(checkFormat('a'.repeat(280),{maxLength:280}),[]);assert.deepEqual(checkFormat('a'.repeat(281),{maxLength:280}),['length']);
 assert.deepEqual(checkFormat('日'.repeat(141),{maxLength:280}),['length']);assert.deepEqual(checkFormat('a'.repeat(549)),[]);
});
test('plain numbered lines pass like @grok uses them; markdown bullets still do not', () => {
 assert.deepEqual(checkFormat('1. Yes, 16 rises.\n2. No cuts.'),[]);assert.ok(checkFormat('- bullet').includes('markdown'));
});
test('answers lead with the verdict and carry the account limit', () => {
 for(const s of [answerSystem(280),answerSystem(549)]){assert.match(s,/Lead with the verdict/);assert.match(s,/say so plainly/);assert.match(s,/answer each briefly in order/);assert.match(s,/no markdown, emoji, hashtags/);}
 assert.match(answerSystem(280),/at most 280 characters/);assert.match(answerSystem(549),/under 550/);
});
const post={id:'1',author_id:'person',text:'@helper is this true?',lang:'en'};
const env={X_BOT_ID:'bot',X_BOT_HANDLE:'helper'};
test('answer models get the standard-account limit unless X_PREMIUM is set', async () => {
 for(const [extra,limit] of [[{},280],[{X_PREMIUM:'1'},549]]){
  const limits=[];await runPost(post,{env:{...env,...extra},store:new MemoryStore(),x:fixtureX,provider:async(model,req)=>{if(!req.system)limits.push(req.maxLength);return fixtureProvider(model,req);}});
  assert.deepEqual(limits,[limit,limit,limit,limit]);
 }
 let sent;try{await callModel({provider:'anthropic',model:'m'},{maxLength:280,input:'q',env:{ANTHROPIC_API_KEY:'k'},fetchImpl:async(url,init)=>{sent=JSON.parse(init.body);throw Error('stop');}});}catch{}
 assert.match(sent.system,/at most 280 characters/);
});
test('a reply too long for a standard account is held back, never sent to X', async () => {
 const long='Yes. '+'The records show it. '.repeat(16);
 const entry=await runPost(post,{env:{...env,LIVE:'1'},store:new MemoryStore(),x:{...fixtureX,reply:()=>{throw Error('must not post');}},provider:async(model,req)=>{const r=await fixtureProvider(model,req);return !req.system||req.input?.instruction?{...r,text:long}:r;}});
 assert.equal(entry.status,'format_failed');assert.ok(entry.reasons.includes('length'));
});
