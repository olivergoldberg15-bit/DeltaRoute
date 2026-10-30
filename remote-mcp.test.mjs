import {testTempRoot} from './test-fixtures.mjs';
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
// A copied runtime: no user config, login or provider call. Clients and keys live in its own state folder.
const runtime=fs.mkdtempSync(path.join(testTempRoot,'deltaroute-remote-mcp-'));
for(const file of fs.readdirSync(import.meta.dirname))if(file.endsWith('.mjs')||file==='models.json')fs.copyFileSync(path.join(import.meta.dirname,file),path.join(runtime,file));
fs.writeFileSync(path.join(runtime,'config.json'),JSON.stringify({maxConcurrent:2,timeoutSeconds:1,workers:{}}));
const {handleMessage}=await import(pathToFileURL(path.join(runtime,'server.mjs')).href);
const remote=await import(pathToFileURL(path.join(runtime,'remote-mcp.mjs')).href);
const clientsFile=path.join(runtime,'state','remote-clients.json');
const museKey=remote.addClient('muse',{file:clientsFile}),coderKey=remote.addClient('coder',{file:clientsFile,allowCode:true});
const jobsDir=path.join(runtime,'jobs');
const server=remote.createRemoteServer({handle:handleMessage,clientsFile,jobsDir,log:()=>{}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/mcp`;
after(()=>{server.close();fs.rmSync(runtime,{recursive:true,force:true});});
const post=(body,key=museKey,method='POST',target=url)=>fetch(target,{method,headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(key?{Authorization:'Bearer '+key}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})});
const rpc=async(method,params,key)=>(await (await post({jsonrpc:'2.0',id:1,method,params},key)).json());

test('only a connected AI with its own key gets in, and keys are stored as fingerprints only',async()=>{
 assert.equal((await post({jsonrpc:'2.0',id:1,method:'ping'},null)).status,401);
 assert.equal((await post({jsonrpc:'2.0',id:1,method:'ping'},'dr_wrong')).status,401);
 assert.equal((await post({jsonrpc:'2.0',id:1,method:'ping'})).status,200);
 const stored=fs.readFileSync(clientsFile,'utf8');assert.equal(stored.includes(museKey),false);assert.match(stored,/keySha256/);
 assert.throws(()=>remote.addClient('muse',{file:clientsFile}),/exists/);assert.throws(()=>remote.addClient('bad name',{file:clientsFile}),/Client name/);
});
test('it speaks MCP over HTTP: initialize, tools/list, notifications, one endpoint',async()=>{
 const init=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'muse'}});
 assert.equal(init.result.serverInfo.name,'DeltaRoute');assert.equal(init.result.protocolVersion,'2025-06-18');
 assert.deepEqual((await rpc('tools/list')).result.tools.map(t=>t.name).sort(),[...remote.REMOTE_TOOLS].sort());
 assert.equal((await post({jsonrpc:'2.0',method:'notifications/initialized'})).status,202);
 assert.equal((await post(null,museKey,'GET')).status,405);
 assert.equal((await post(null,museKey,'DELETE')).status,204);
 assert.equal((await post({jsonrpc:'2.0',id:1,method:'ping'},museKey,'POST',url.replace('/mcp','/other'))).status,404);
 const batch=await (await post([{jsonrpc:'2.0',id:1,method:'ping'},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'ping'}])).json();
 assert.deepEqual(batch.map(r=>r.id),[1,2]);
});
test('a connected AI never acts in the owner\'s name or beyond what it was allowed',async()=>{
 const call=(name,args,key)=>rpc('tools/call',{name,arguments:args},key);
 assert.match((await call('model_registry',{action:'apply',proposal_id:'x',approved_by_user:'yes'})).result.content[0].text,/not allowed/);
 assert.match((await call('submit_task',{action:'approve_plan',workflow_id:'w',approved_by_user:'Approved'})).result.content[0].text,/approvals stay with the owner/);
 assert.match((await call('submit_task',{task:'Edit a.txt',cwd:runtime,mode:'code'})).result.content[0].text,/Code jobs are off/);
 // Allowed through to DeltaRoute's own checks (no installed workers here, so it stops before launching anything).
 assert.doesNotMatch((await call('submit_task',{task:'Edit a.txt',cwd:runtime,mode:'code',provider:'codex'},coderKey)).result.content[0].text,/Code jobs are off/);
 assert.equal((await call('list_workers',{})).result.isError,undefined);
});
test('full access is the owner\'s choice: every tool and action, and switching keeps the same key',async()=>{
 const key=remote.addClient('owner-agent',{file:clientsFile});
 assert.equal((await rpc('tools/list',{},key)).result.tools.length,remote.REMOTE_TOOLS.length);
 assert.equal(remote.setClient('owner-agent',{file:clientsFile,full:true}),true);
 assert.equal((await rpc('tools/list',{},key)).result.tools.length,6);
 const approve=await rpc('tools/call',{name:'submit_task',arguments:{action:'approve_plan',workflow_id:'none',approved_by_user:'Approved'}},key);
 assert.doesNotMatch(approve.result.content[0].text,/approvals stay with the owner/);
 assert.equal(remote.setClient('owner-agent',{file:clientsFile}),true);
 assert.match((await rpc('tools/call',{name:'submit_task',arguments:{action:'approve_plan',workflow_id:'none',approved_by_user:'Approved'}},key)).result.content[0].text,/approvals stay with the owner/);
 assert.equal(remote.setClient('nobody',{file:clientsFile,full:true}),false);
 remote.removeClient('owner-agent',{file:clientsFile});
});
test('removing a client revokes its key at once',async()=>{
 const key=remote.addClient('temp',{file:clientsFile});assert.equal((await post({jsonrpc:'2.0',id:1,method:'ping'},key)).status,200);
 assert.equal(remote.removeClient('temp',{file:clientsFile}),true);assert.equal((await post({jsonrpc:'2.0',id:1,method:'ping'},key)).status,401);
});

test('health answers without a key, and every DeltaRoute reply is marked so proxy faults stand out',async()=>{
 const health=await fetch(url.replace('/mcp','/health'));assert.equal(health.status,200);
 const body=await health.json();assert.equal(body.ok,true);assert.equal(body.service,'DeltaRoute');assert.deepEqual(Object.keys(body).sort(),['ok','service','uptimeSeconds','version']);
 assert.ok(health.headers.get('x-deltaroute'));
 for(const r of [await post({jsonrpc:'2.0',id:1,method:'ping'},null),await post({},museKey,'POST',url.replace('/mcp','/nope'))])assert.ok(r.headers.get('x-deltaroute'));
 assert.equal((await post({jsonrpc:'2.0',id:1,method:'ping'},museKey,'POST',url+'/')).status,200);
});
test('standard Streamable HTTP clients get a session id and, if they ask only for a stream, an event stream',async()=>{
 const init=await post({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'sdk'}}});
 assert.match(init.headers.get('mcp-session-id'),/^[0-9a-f-]{36}$/);
 // A session from before a restart still works: nothing is kept per session.
 const later=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:'Bearer '+museKey,'Mcp-Session-Id':'00000000-0000-0000-0000-000000000000'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'ping'})});
 assert.equal(later.status,200);
 const sse=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream',Authorization:'Bearer '+museKey},body:JSON.stringify({jsonrpc:'2.0',id:7,method:'ping'})});
 assert.match(sse.headers.get('content-type'),/text\/event-stream/);
 const data=JSON.parse(/data: (.+)/.exec(await sse.text())[1]);assert.equal(data.id,7);
});
test('a finished job\'s output files download with a key, and nothing outside its out/ folder does',async()=>{
 const id='11111111-2222-3333-4444-555555555555',child='66666666-7777-8888-9999-000000000000';
 fs.mkdirSync(path.join(jobsDir,child,'out'),{recursive:true});fs.mkdirSync(path.join(jobsDir,id),{recursive:true});
 fs.writeFileSync(path.join(jobsDir,id,'status.json'),JSON.stringify({id,status:'completed',attempts:[{taskId:child}]}));
 fs.writeFileSync(path.join(jobsDir,child,'out','cat.png'),Buffer.from([0x89,0x50,0x4e,0x47]));fs.writeFileSync(path.join(jobsDir,child,'secret.txt'),'no');
 const files=url.replace('/mcp','/files/'+id);
 assert.equal((await fetch(files)).status,401);
 const list=await (await post(null,museKey,'GET',files)).json();assert.deepEqual(list.files.map(f=>f.name),['cat.png']);
 const png=await post(null,museKey,'GET',files+'/cat.png');assert.equal(png.status,200);assert.equal(png.headers.get('content-type'),'image/png');assert.deepEqual([...new Uint8Array(await png.arrayBuffer())],[0x89,0x50,0x4e,0x47]);
 for(const bad of ['/..%2Fsecret.txt','/secret.txt','/..%2F..%2Fstatus.json'])assert.equal((await post(null,museKey,'GET',files+bad)).status,404,bad);
 assert.equal((await post(null,museKey,'GET',url.replace('/mcp','/files/not-a-task'))).status,400);
 assert.equal((await post(null,museKey,'GET',files+'/%E0%A4%A')).status,400);
 assert.equal(remote.resolveOutput(id,'../secret.txt',jobsDir),null);
});
test('the client list is cached, reloaded on change, and a bad read keeps the last good copy',()=>{
 const file=path.join(runtime,'state','store-test.json');fs.writeFileSync(file,JSON.stringify({a:{keySha256:'x'}}));
 const read=remote.clientStore(file);assert.deepEqual(Object.keys(read()),['a']);
 fs.writeFileSync(file,'{"a":{"keySha256":"x"},"b":{"keySha256":"y"}}');assert.deepEqual(Object.keys(read()).sort(),['a','b']);
 fs.writeFileSync(file,'{half-written');assert.deepEqual(Object.keys(read()).sort(),['a','b']);
 fs.rmSync(file);assert.deepEqual(read(),{});
});
test('the retrying client retries forwarding faults, never resubmits a task, and reads tool results',async()=>{
 const reply=(status,ours,body={})=>new Response(JSON.stringify(body),{status,headers:ours?{'X-DeltaRoute':'1'}:{}});
 const scripted=steps=>{let i=0;const fn=async()=>{const s=steps[i++];if(s instanceof Error)throw s;return s;};fn.count=()=>i;return fn;};
 const opts=f=>({key:'k',fetchImpl:f,sleep:async()=>{}});
 let f=scripted([reply(404,false),reply(502,false),reply(200,true,{jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:'{"ok":1}'}]}})]);
 assert.deepEqual(await remote.remoteCall('https://x.app.github.dev/mcp','list_workers',{},opts(f)),{ok:1});assert.equal(f.count(),3);
 f=scripted([reply(401,true),reply(200,true,{jsonrpc:'2.0',id:1,result:{content:[{type:'text',text:'"fine"'}]}})]);
 assert.equal(await remote.remoteCall('https://x','get_task',{task_id:'t'},opts(f)),'fine');
 f=scripted([reply(401,true),reply(401,true)]);await assert.rejects(remote.remoteCall('https://x','get_task',{},opts(f)),/HTTP 401/);
 f=scripted([Error('socket hang up'),reply(200,true)]);await assert.rejects(remote.remoteCall('https://x','submit_task',{task:'a'},opts(f)),/not retried/);assert.equal(f.count(),1);
 f=scripted([reply(404,false),reply(404,false)]);await assert.rejects(remote.remoteRequest('https://x',{...opts(f),retries:1}),/forwarding layer/);
 f=scripted([reply(400,true,{error:'bad'})]);await assert.rejects(remote.remoteCall('https://x','get_task',{},opts(f)),/HTTP 400/);assert.equal(f.count(),1);
});
