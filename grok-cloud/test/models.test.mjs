import test from 'node:test';
import assert from 'node:assert/strict';
import {callModel} from '../src/models.mjs';
for (const [provider,key,data] of [['xai','XAI_API_KEY',{output_text:'ok',usage:{input_tokens:2,output_tokens:3}}],['openai','OPENAI_API_KEY',{output:[{content:[{text:'ok'}]}]}],['anthropic','ANTHROPIC_API_KEY',{content:[{text:'ok'}]}],['google','GEMINI_API_KEY',{candidates:[{content:{parts:[{text:'ok'}]}}]}]]) {
 test(`${provider} request and usage`,async()=>{let request;const result=await callModel({provider,model:'fixture'},{env:{[key]:'fixture'},input:'question',fetchImpl:async(url,init)=>{request=JSON.parse(init.body);return {ok:true,json:async()=>data};}}); assert.equal(result.text,'ok');assert.ok(request);});
}
test('missing key never calls fetch',async()=>assert.equal((await callModel({provider:'xai'},{env:{},fetchImpl:()=>{throw Error();}})).skipped,'missing_key'));
