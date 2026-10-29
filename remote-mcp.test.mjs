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
const server=remote.createRemoteServer({handle:handleMessage,clientsFile});
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
test('removing a client revokes its key at once',async()=>{
 const key=remote.addClient('temp',{file:clientsFile});assert.equal((await post({jsonrpc:'2.0',id:1,method:'ping'},key)).status,200);
 assert.equal(remote.removeClient('temp',{file:clientsFile}),true);assert.equal((await post({jsonrpc:'2.0',id:1,method:'ping'},key)).status,401);
});
