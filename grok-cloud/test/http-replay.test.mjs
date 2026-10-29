import test from 'node:test';
import assert from 'node:assert/strict';
import {runPost} from '../src/pipeline.mjs';
import {MemoryStore} from '../src/store.mjs';
import fixture from '../fixtures/evidence.json' with {type:'json'};
test('full pipeline with stubbed HTTP provider and X calls, no network',async()=>{
 let writes=0;const requests=[];
 const env={X_BOT_ID:'bot',X_BOT_HANDLE:'helper',X_ACCESS_TOKEN:'fixture',XAI_API_KEY:'fixture',ANTHROPIC_API_KEY:'fixture',OPENAI_API_KEY:'fixture',GEMINI_API_KEY:'fixture'};
 const fetchImpl=async(url,req)=>{
  requests.push(url);
  if(url.startsWith('https://api.x.com/')){if(req.method==='POST'){writes++;throw Error('unexpected post');}return {ok:true,json:async()=>({data:fixture.post,includes:{users:[{id:'person',username:'person'}]}})};}
  const body=JSON.parse(req.body),system=body.instructions||body.system||body.systemInstruction?.parts[0].text||'';
  let text=fixture.answer;
  if(system.startsWith('Return JSON'))text=JSON.stringify(fixture.queries);
  if(body.tools)text=JSON.stringify({sources:fixture.sources});
  if(system.startsWith('Judge')){const input=JSON.parse(body.input||body.messages?.[0].content);text=JSON.stringify({scores:input.candidates.map(c=>({model:c.model,score:85})),winner:input.candidates[0].model});}
  const usage={input_tokens:100,output_tokens:20,...(body.tools?{server_side_tool_usage:{x_search:body.tools[0].type==='x_search'?2:0,web_search:body.tools[0].type==='web_search'?2:0}}:{})};
  const data=url.includes('anthropic')?{content:[{text}],usage}:url.includes('googleapis')?{candidates:[{content:{parts:[{text}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:20}}:{output:[{content:[{text}]}],usage};
  return {ok:true,json:async()=>data};
 };
 const store=new MemoryStore();const result=await runPost(fixture.post,{env,store,fetchImpl});
 assert.equal(result.status,'dry-run');assert.equal(result.final_text,fixture.answer);assert.equal(writes,0);assert.ok(requests.some(u=>u.includes('anthropic')));assert.equal(result.tokens.filter(t=>t.model).length,8);assert.ok(result.cost.xai>0.02);
});

