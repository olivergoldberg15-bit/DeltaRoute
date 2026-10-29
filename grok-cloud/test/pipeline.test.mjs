import test from 'node:test';
import assert from 'node:assert/strict';
import {runPost} from '../src/pipeline.mjs';
import {MemoryStore} from '../src/store.mjs';
import {fixtureProvider,fixtureX} from '../fixtures/stubs.mjs';
test('full fixture replay dry-runs, accounts costs and logs candidates',async()=>{const store=new MemoryStore();const result=await runPost({id:'1',author_id:'person',text:'@helper What is supported?'},{store,env:{X_BOT_ID:'bot',X_BOT_HANDLE:'helper'},x:fixtureX,provider:fixtureProvider});assert.equal(result.status,'dry-run');assert.equal(result.candidates.length,4);assert.ok(Object.values(result.cost).reduce((a,b)=>a+b,0)>0);assert.equal((await store.list('logs'))[0].final_text,result.final_text);});
