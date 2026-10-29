import test from 'node:test';
import assert from 'node:assert/strict';
import {replay} from '../scripts/replay.mjs';
import {fixtureProvider,fixtureX} from '../fixtures/stubs.mjs';
import {sample} from '../scripts/grok-sample.mjs';
test('JSONL replay forces dry run even with LIVE=1',async()=>{const entries=await replay(new URL('../fixtures/posts.jsonl',import.meta.url),{env:{LIVE:'1',X_BOT_ID:'bot',X_BOT_HANDLE:'helper'},x:fixtureX,provider:fixtureProvider});assert.equal(entries[0].status,'dry-run');});
test('sample uses xAI X Search and returns sourced replies',async()=>{const rows=await sample(1,{env:{XAI_API_KEY:'fixture'},provider:async(model,req)=>{assert.equal(req.tools[0].type,'x_search');return {text:JSON.stringify({replies:[{id:'123',url:'https://x.com/grok/status/123',text:'Answer',created_at:'2026-10-28'}]})};}});assert.equal(rows.length,1);assert.equal(rows[0].method,'xai_x_search');});
