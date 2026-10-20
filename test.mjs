import {testTempRoot} from './test-fixtures.mjs';
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
// Test only an isolated copied runtime: no installation, user config, login, or model call.
const runtime=fs.mkdtempSync(path.join(testTempRoot,'deltaroute-stdio-tests-'));
for(const file of fs.readdirSync(import.meta.dirname))if(file.endsWith('.mjs'))fs.copyFileSync(path.join(import.meta.dirname,file),path.join(runtime,file));
fs.writeFileSync(path.join(runtime,'config.json'),JSON.stringify({maxConcurrent:2,timeoutSeconds:1,workers:{}}));
after(()=>fs.rmSync(runtime,{recursive:true,force:true}));
const {route,subscriptionEnv}=await import(pathToFileURL(path.join(runtime,'server.mjs')).href);
test('prompt hook applies policy without echoing user text and skips external workers',async()=>{
 async function invoke(env){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,['prompt-hook.mjs'],{cwd:runtime,env,stdio:['pipe','pipe','pipe']});let out='';p.stdout.on('data',d=>out+=d);p.on('error',reject);p.on('close',code=>resolve({code,out}));p.stdin.end(JSON.stringify({prompt:'PRIVATE_SENTINEL_726',session_id:'test'}));});}
 const r=await invoke({...process.env,MODEL_ROUTER_WORKER:''});assert.equal(r.code,0);assert.equal(r.out.includes('PRIVATE_SENTINEL_726'),false);assert.equal(JSON.parse(r.out).hookSpecificOutput.hookEventName,'UserPromptSubmit');assert.match(r.out,/Grok/);
 const nested=await invoke({...process.env,MODEL_ROUTER_WORKER:'1'});assert.equal(nested.out,'');assert.equal(nested.code,0);
});
test('routing only chooses enabled installed workers and handles exhaustion',()=>{
 const workers=[{name:'codex',enabled:true,installed:true},{name:'gemini',enabled:true,installed:true}];
 assert.equal(route('quick_coding',workers).provider,'gemini');assert.equal(route('debugging',workers).provider,'codex');
 workers[1].enabled=false;assert.equal(route('quick_coding',workers).provider,'codex');
 workers[0].installed=false;assert.equal(route('quick_coding',workers).provider,null);
});
test('worker environment removes paid API credentials and endpoint overrides',()=>{
 const source={PATH:'keep',OPENAI_API_KEY:'secret',ANTHROPIC_AUTH_TOKEN:'secret',GEMINI_API_KEY:'secret',GOOGLE_APPLICATION_CREDENTIALS:'secret',OPENAI_BASE_URL:'remote'};
 const env=subscriptionEnv(source);assert.equal(env.PATH,'keep');assert.equal(env.MODEL_ROUTER_WORKER,'1');assert.equal(source.OPENAI_API_KEY,'secret');
 for(const k of Object.keys(source).filter(k=>k!=='PATH'))assert.equal(env[k],undefined);
});
test('MCP initialization, discovery and tool errors work over real stdio',async()=>{
 const p=spawn(process.execPath,['server.mjs'],{cwd:runtime,stdio:['pipe','pipe','pipe'],env:{...process.env,MODEL_ROUTER_WORKER:'',DELTAROUTE_MANAGED_HEAD:'',DELTAROUTE_COORDINATOR:'claude'}});let output='';let stderr='';p.stdout.on('data',d=>output+=d);p.stderr.on('data',d=>stderr+=d);
 const requests=[{id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}},{id:2,method:'tools/list'},{id:3,method:'tools/call',params:{name:'get_task',arguments:{task_id:'../../secret'}}},{id:4,method:'tools/call',params:{name:'submit_task',arguments:{task:'Implement retention for the last 365 days',cwd:runtime,mode:'bad'}}}];
 p.stdin.end(requests.map(r=>JSON.stringify({jsonrpc:'2.0',...r})).join('\n')+'\n');
 const code=await new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',resolve);});assert.equal(code,0,stderr);
 const responses=output.trim().split('\n').map(JSON.parse);assert.equal(responses.length,4);assert.equal(responses[0].result.serverInfo.name,'DeltaRoute');assert.equal(responses[1].result.tools.length,6);assert.equal(responses[2].result.isError,true);assert.equal(responses[3].result.isError,true);assert.match(JSON.stringify(responses[3]),/Invalid mode/);
});
