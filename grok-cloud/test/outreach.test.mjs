import test from 'node:test';
import assert from 'node:assert/strict';
import {proposal,outreach} from '../src/outreach.mjs';
import {MemoryStore} from '../src/store.mjs';
const prospect={to:'events@example.org',subject:'Your weekly meetup',body:'Your weekly meetup could use Hive for event planning.',published:true,patternBuilt:false,emailSource:'https://example.org/contact',fitSource:'https://example.org/events'};
test('outreach proposal matches Atlas and rejects guessed/unpublished contact',()=>{const p=proposal(prospect,'hive',prospect.to);assert.deepEqual(Object.keys(p),['kind','organizationId','contactId','to','subject','body','sourceUrls']);for(const change of [{published:false},{patternBuilt:true},{emailSource:''}])assert.throws(()=>proposal({...prospect,...change},'hive',prospect.to));assert.throws(()=>proposal(prospect,'hive','no address'));});
test('outreach only queues independently verified contact; never emails',async()=>{const store=new MemoryStore();const result=await outreach({env:{HIVE_ORGANIZATION_ID:'hive'},store,provider:async()=>({text:JSON.stringify({prospects:[prospect]}),usage:{input:1,output:1}}),fetchImpl:async()=>({ok:true,text:async()=>prospect.to})});assert.equal(result.queued,1);assert.equal((await store.list('outreach_queue'))[0].kind,'email');});
