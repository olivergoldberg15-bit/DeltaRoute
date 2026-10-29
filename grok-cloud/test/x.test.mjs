import test from 'node:test';
import assert from 'node:assert/strict';
import {createX, fetchContext} from '../src/x.mjs';
test('X cursor, reply and parent/quote context', async () => {
 const calls=[]; const x=createX({X_BOT_ID:'bot'},async (url,init)=>{calls.push({url,init}); return {ok:true,json:async()=>({data:{id:'1',text:'question',referenced_tweets:[]}})};});
 await x.mentions('123'); assert.match(calls[0].url,/since_id=123/);
 await x.reply('1','Answer'); assert.equal(JSON.parse(calls[1].init.body).reply.in_reply_to_tweet_id,'1');
 const context=await fetchContext({id:'1'}, {post:async id=>({data:{id,referenced_tweets:id==='1'?[{type:'quoted',id:'q'},{type:'replied_to',id:'p'}]:[]},includes:{media:[{type:'photo'}]}})});
 assert.deepEqual(context.thread.map(p=>p.id),['q','p']); assert.equal(context.media.length,3);
});
