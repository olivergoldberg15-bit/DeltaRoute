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
 assert.equal((await rpc('tools/list',{},key)).result.tools.length,7);
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

// Remote hardening regressions; these exercise HTTP dispatch without opening a socket or calling a provider.
const {Readable}=await import('node:stream');
const os=(await import('node:os')).default;
function requestWithoutSocket(server,{body,key=museKey,headers={},chunks}={}){
 return new Promise((resolve,reject)=>{
  const req=Readable.from(chunks||[Buffer.from(JSON.stringify(body))]);req.method='POST';req.url='/mcp';req.headers={authorization:'Bearer '+key,...headers};
  let text='';const res={headersSent:false,writeHead(status,headers){this.headersSent=true;this.status=status;this.headers=headers;},write(s){text+=s;},end(s){text+=s||'';resolve({status:this.status,headers:this.headers,body:text?JSON.parse(text):null});}};
  req.on('error',reject);server.emit('request',req,res);
 });
}

test('tool calls queue per server while auth and body-size rejections bypass the queue',async()=>{
 let calls=0,release;const gate=new Promise(r=>release=r);
 const isolated=remote.createRemoteServer({clientsFile,log:()=>{},handle:async msg=>{calls++;await gate;return {jsonrpc:'2.0',id:msg.id,result:{}};}});
 const body={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'list_workers',arguments:{}}};
 const first=requestWithoutSocket(isolated,{body}),second=requestWithoutSocket(isolated,{body});
 try{
  assert.equal(calls,0,'dispatch must yield before entering synchronous tool work');
  assert.equal((await requestWithoutSocket(isolated,{body,key:'wrong'})).status,401);
  assert.equal((await requestWithoutSocket(isolated,{body,headers:{'content-length':String(1024*1024+1)}})).status,413);
  assert.equal((await requestWithoutSocket(isolated,{body,chunks:[Buffer.alloc(1024*1024),Buffer.alloc(1)]})).status,413);
  await new Promise(r=>setTimeout(r,20));assert.equal(calls,1,'only one tool may be in flight');
  assert.equal((await requestWithoutSocket(isolated,{body,key:'wrong'})).status,401);
 }finally{release();await Promise.all([first,second]);}
 assert.equal(calls,2);
});

test('the tool queue yields between synchronous calls and recovers after a failed call',async()=>{
 const run=remote.toolQueue(),order=[];
 const first=run(()=>{order.push('first');setTimeout(()=>order.push('io'),0);throw Error('failed');});
 const failed=assert.rejects(first,/failed/),second=run(()=>order.push('second'));
 assert.deepEqual(order,[]);await Promise.all([failed,second]);assert.deepEqual(order,['first','io','second']);
});

test('a 540-request burst rejects bad keys and oversized bodies without waiting for tool completion',async()=>{
 let calls=0,release;const gate=new Promise(r=>release=r);
 const isolated=remote.createRemoteServer({clientsFile,log:()=>{},handle:async msg=>{calls++;await gate;return {jsonrpc:'2.0',id:msg.id,result:{}};}});
 const body={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'list_workers',arguments:{}}},tools=[],rejected=[];
 for(let i=0;i<180;i++){
  tools.push(requestWithoutSocket(isolated,{body}));
  rejected.push(requestWithoutSocket(isolated,{body,key:'wrong'}),requestWithoutSocket(isolated,{body,headers:{'content-length':String(1024*1024+1)}}));
 }
 try{
  const replies=await Promise.all(rejected);assert.equal(replies.filter(r=>r.status===401).length,180);assert.equal(replies.filter(r=>r.status===413).length,180);
  assert.equal(calls,0,'all immediate rejections finish before queued work starts');
 }finally{release();await Promise.all(tools);}
 assert.equal(calls,180);
});

test('limited paths require a real repository below home, including delivery and junction targets',t=>{
 const base=path.join(runtime,'path-policy'),home=path.join(base,'home'),repo=path.join(home,'repo'),child=path.join(repo,'sub'),outside=path.join(base,'outside');
 fs.mkdirSync(path.join(repo,'.git'),{recursive:true});fs.mkdirSync(child);fs.mkdirSync(path.join(home,'plain'));fs.mkdirSync(path.join(outside,'.git'),{recursive:true});
 fs.mkdirSync(path.join(home,'worktree'));fs.writeFileSync(path.join(home,'worktree','.git'),'gitdir: elsewhere');
 t.mock.method(os,'homedir',()=>home);
 assert.equal(remote.homeRepository(child),true);assert.equal(remote.homeRepository(path.join(home,'worktree')),true);
 for(const dir of [home,outside,path.join(home,'plain'),path.join(repo,'missing'),path.join(repo,'.git','..','..'),null,''])assert.equal(remote.homeRepository(dir),false,String(dir));
 fs.symlinkSync(outside,path.join(repo,'escape'),'junction');assert.equal(remote.homeRepository(path.join(repo,'escape')),false);
 const limited={allowCode:true},call=args=>({method:'tools/call',params:{name:'submit_task',arguments:args}});
 assert.equal(remote.refusal(call({cwd:child,mode:'code'}),limited),null);
 for(const args of [{cwd:home},{cwd:outside},{cwd:null},{cwd:repo,deliver_to:home},{cwd:repo,images:{deliver_to:outside}}])assert.match(remote.refusal(call(args),limited),/cwd|deliver_to/);
 assert.equal(remote.refusal(call({cwd:outside,deliver_to:home,allowed_paths:['.github/workflows']}),{full:true}),null);
 assert.match(remote.refusal({method:'tools/call',params:{name:'generate_media',arguments:{cwd:repo,deliver_to:outside}}},limited),/deliver_to/);
 fs.mkdirSync(path.join(home,'.git'));assert.equal(remote.homeRepository(path.join(home,'plain')),false,'home itself cannot be the repository root');
});

test('allowed_paths rejects cross-platform absolute paths, traversal and case variants of .github',()=>{
 for(const p of ['/tmp/a','C:\\work\\a','C:/work/a','C:work','\\\\host\\share','../a','src/../a','src\\..\\a','src/file..txt','.github/workflows','.GiTHuB\\workflows','./.GITHUB/workflows'])assert.equal(remote.safeAllowedPaths({workflow:{steps:[{allowed_paths:[p]}]}}),false,p);
 assert.equal(remote.safeAllowedPaths({allowed_paths:['src/**','README.md']}),true);
 assert.equal(remote.safeAllowedPaths({allowed_paths:null}),false);
});

test('null tool arguments return JSON-RPC invalid params, and remote errors hide local paths',async()=>{
 let calls=0;const isolated=remote.createRemoteServer({clientsFile,log:()=>{},handle:async msg=>{calls++;return {jsonrpc:'2.0',id:msg.id,result:{isError:true,content:[{type:'text',text:"ENOENT: open 'C:\\Users\\olive\\Private Folder\\secret.txt' and /home/olive/secret.txt"}]}};}});
 const result=await requestWithoutSocket(isolated,{body:{jsonrpc:'2.0',id:8,method:'tools/call',params:{name:'submit_task',arguments:null}}});
 assert.equal(result.status,200);assert.equal(result.body.id,8);assert.equal(result.body.error.code,-32602);assert.equal(calls,0);
 const failed=await requestWithoutSocket(isolated,{body:{jsonrpc:'2.0',id:9,method:'tools/call',params:{name:'list_workers',arguments:{}}}});
 assert.doesNotMatch(failed.body.result.content[0].text,/olive|secret|C:|\/home/);assert.match(failed.body.result.content[0].text,/ENOENT/);
 const rpcError=remote.redactRemoteErrors({error:{code:-32603,message:'Failed at C:/Users/olive/file',data:{file:'\\\\server\\share\\secret'}}});
 assert.doesNotMatch(JSON.stringify(rpcError),/Users|olive|server|share|secret/);
 assert.equal(remote.redactRemoteErrors({error:{message:'Refused .github/ and src/file.txt'}}).error.message,'Refused .github/ and src/file.txt');
 const success={result:{content:[{type:'text',text:'C:/allowed/output.png'}]}};assert.equal(remote.redactRemoteErrors(success),success);
});
