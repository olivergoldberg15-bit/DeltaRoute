// DeltaRoute over HTTP (MCP Streamable HTTP, JSON responses), so any MCP-capable AI the owner connects (Meta Muse
// custom connectors, ChatGPT or Claude connectors, other agents) can use DeltaRoute's tools. Every connected AI has its
// own key: only its SHA-256 is stored, in state/remote-clients.json (owner-only, never in Git), and removing the
// client revokes it. By default a connected AI acts for the owner but never in the owner's name: it cannot approve
// plans or reviews, change the model registry, or start code jobs unless allowed with --allow-code. --full is the
// owner's choice to give an AI every tool and action, approvals included, exactly as the owner has them.
// It listens on 127.0.0.1; a host's port forwarding (GitHub Codespaces) publishes it. No dependencies.
//   node remote-mcp.mjs add-client <name> [--allow-code | --full]   prints that client's key once
//   node remote-mcp.mjs set-client <name> --full | --allow-code | --limited   changes access, same key
//   node remote-mcp.mjs list-clients | remove-client <name>
//   node remote-mcp.mjs serve [--port 8787]                 endpoint: POST /mcp with Authorization: Bearer <key>
//   node remote-mcp.mjs health <base url>                   is it up? (GET /health, no key)
//   node remote-mcp.mjs call <base url> <tool> [json args]  a retrying client; key from DELTAROUTE_KEY
//   node remote-mcp.mjs download <base url> <task id> [dir] fetches a finished job's output files
// Other routes: GET /health (no key; says only that it is up), GET /files/<task id>[/<file>] (key; a job's out/ files).
// Every response DeltaRoute itself sends carries X-DeltaRoute, so a 404 or 502 without it came from the forwarding layer.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
export const CLIENTS_FILE=path.join(ROOT,'state','remote-clients.json');
export const REMOTE_TOOLS=['list_workers','recommend_route','submit_task','get_task','cancel_task'];
export const JOBS_DIR=path.join(ROOT,'jobs');
const MAX_BODY=1024*1024;
const VERSION=(()=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version;}catch{return 'unknown';}})();
const TYPES={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.txt':'text/plain; charset=utf-8','.md':'text/markdown; charset=utf-8','.json':'application/json','.html':'text/html; charset=utf-8','.mp4':'video/mp4','.mp3':'audio/mpeg','.wav':'audio/wav','.pdf':'application/pdf'};
const TASK_ID=/^[a-f0-9-]{36}$/;
const sha=key=>crypto.createHash('sha256').update(String(key)).digest('hex');

export function loadClients(file=CLIENTS_FILE){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return {};}}
// Written whole and renamed into place, so a request never reads a half-written file.
function saveClients(clients,file){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(clients,null,1)+'\n',{mode:0o600});fs.renameSync(tmp,file);}
// Read once and again only when the file changes. A read that fails while the file exists keeps the last good copy,
// so a moment of disk or editor trouble cannot turn every key away; a deleted file revokes everyone.
export function clientStore(file=CLIENTS_FILE){
 let stamp=null,cached={};
 return ()=>{let st;try{st=fs.statSync(file);}catch{stamp=null;return cached={};}
  const now=st.mtimeMs+':'+st.size;if(now===stamp)return cached;
  try{cached=JSON.parse(fs.readFileSync(file,'utf8'));stamp=now;}catch{}return cached;};
}
const access=({full=false,allowCode=false})=>full?{full:true,tools:null,allowCode:true}:{full:false,tools:REMOTE_TOOLS,allowCode:Boolean(allowCode)};
export function addClient(name,{file=CLIENTS_FILE,allowCode=false,full=false}={}){
 if(!/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(String(name)))throw Error('Client name: 1-40 letters, digits, - or _');
 const clients=loadClients(file);if(clients[name])throw Error('A client with that name exists; remove it first to issue a new key');
 const key='dr_'+crypto.randomBytes(32).toString('base64url');
 clients[name]={keySha256:sha(key),...access({full,allowCode}),createdAt:new Date().toISOString()};saveClients(clients,file);return key;
}
export function setClient(name,{file=CLIENTS_FILE,full=false,allowCode=false}={}){const clients=loadClients(file);if(!clients[name])return false;clients[name]={...clients[name],...access({full,allowCode})};saveClients(clients,file);return true;}
export function removeClient(name,{file=CLIENTS_FILE}={}){const clients=loadClients(file);if(!clients[name])return false;delete clients[name];saveClients(clients,file);return true;}
export function authorize(header,clients){
 const key=/^Bearer\s+(\S+)$/i.exec(String(header||'').trim())?.[1];if(!key)return null;const digest=Buffer.from(sha(key));
 for(const [name,c] of Object.entries(clients))if(typeof c.keySha256==='string'&&c.keySha256.length===digest.length&&crypto.timingSafeEqual(Buffer.from(c.keySha256),digest))return {name,...c};
 return null;
}
// What a connected AI may not do through an allowed tool. Returns the refusal, or null.
export function refusal(msg,client){
 if(client.full||msg?.method!=='tools/call')return null;const {name,arguments:a={}}=msg.params||{};
 if(name==='submit_task'){
  if((a.action||'delegate')!=='delegate')return 'Connected AIs can delegate tasks only; plans, reviews and approvals stay with the owner.';
  if(a.mode==='code'&&!client.allowCode)return 'Code jobs are off for this connection; the owner can allow them with add-client --allow-code.';
 }
 return null;
}
const refused=(id,text)=>({jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text}]}});

// Paths a task's output files may come from: its own out/ folder and those of the attempts that ran it.
export function outputDirs(taskId,jobsDir=JOBS_DIR){
 if(!TASK_ID.test(String(taskId)))return [];let job;try{job=JSON.parse(fs.readFileSync(path.join(jobsDir,taskId,'status.json'),'utf8'));}catch{return [];}
 const ids=new Set([taskId,job.resultTaskId,...(job.attempts||[]).map(a=>a.taskId)].filter(id=>TASK_ID.test(String(id))));
 return [...ids].map(id=>path.join(jobsDir,id,'out')).filter(d=>{try{return fs.statSync(d).isDirectory();}catch{return false;}});
}
export function listOutputs(taskId,jobsDir=JOBS_DIR){
 const files=[];for(const dir of outputDirs(taskId,jobsDir))for(const e of fs.readdirSync(dir,{withFileTypes:true}))if(e.isFile()&&!files.some(f=>f.name===e.name))files.push({name:e.name,bytes:fs.statSync(path.join(dir,e.name)).size});
 return files;
}
// The real file behind a requested name, only if it sits directly inside one of the task's out/ folders.
export function resolveOutput(taskId,name,jobsDir=JOBS_DIR){
 if(!name||name!==path.basename(name)||name.startsWith('.'))return null;
 for(const dir of outputDirs(taskId,jobsDir)){try{const real=fs.realpathSync(path.join(dir,name));if(path.dirname(real)===fs.realpathSync(dir)&&fs.statSync(real).isFile())return real;}catch{}}
 return null;
}

export function createRemoteServer({handle,clientsFile=CLIENTS_FILE,jobsDir=JOBS_DIR,log=(...a)=>console.error(new Date().toISOString(),...a)}){
 const clients=clientStore(clientsFile),started=Date.now();
 return http.createServer(async(req,res)=>{
  const base={'Cache-Control':'no-store','X-DeltaRoute':VERSION};
  const send=(status,body,headers={})=>{if(res.headersSent)return;res.writeHead(status,{...base,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers});res.end(body===undefined?undefined:JSON.stringify(body));};
  try{
   const route=new URL(req.url,'http://x').pathname.replace(/\/+$/,'')||'/';
   // Answers without a key and says nothing but that it is up, so a caller can tell a down server from a forwarding fault.
   if(route==='/health'){if(!['GET','HEAD'].includes(req.method))return send(405,{error:'method_not_allowed'},{Allow:'GET, HEAD'});return req.method==='HEAD'?send(200):send(200,{ok:true,service:'DeltaRoute',version:VERSION,uptimeSeconds:Math.round((Date.now()-started)/1000)});}
   const files=/^\/files\/([^/]+)(?:\/([^/]+))?$/.exec(route);
   if(route!=='/mcp'&&!files)return send(404,{error:'not_found',hint:'POST /mcp, GET /health, GET /files/<task id>'});
   const header=req.headers.authorization;const client=authorize(header,clients());
   if(!client){log(`401 ${req.method} ${route}: ${/^Bearer\s+\S+/i.test(String(header||'').trim())?'key not recognised':'no Bearer key'} (DeltaRoute's key check, not the proxy)`);return send(401,{error:'unauthorized'},{'WWW-Authenticate':'Bearer'});}
   if(files){
    if(!['GET','HEAD'].includes(req.method))return send(405,{error:'method_not_allowed'},{Allow:'GET, HEAD'});
    let taskId,name;try{[,taskId,name]=files.map(x=>x&&decodeURIComponent(x));}catch{return send(400,{error:'bad_path'});}
    if(!TASK_ID.test(taskId))return send(400,{error:'bad_task_id'});
    if(!name)return send(200,{taskId,files:listOutputs(taskId,jobsDir).map(f=>({...f,path:`/files/${taskId}/${encodeURIComponent(f.name)}`}))});
    const file=resolveOutput(taskId,name,jobsDir);if(!file)return send(404,{error:'no_such_output'});
    const size=fs.statSync(file).size;res.writeHead(200,{...base,'Content-Type':TYPES[path.extname(file).toLowerCase()]||'application/octet-stream','Content-Length':size,'Content-Disposition':`attachment; filename="${path.basename(file).replace(/["\\\r\n]/g,'_')}"`});
    if(req.method==='HEAD')return res.end();
    return fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
   }
   // Sessions are not kept: any server copy answers any request, so a restart never strands a connected AI.
   if(req.method==='DELETE')return send(204);
   // No server-to-client stream is offered; every reply comes back on its POST.
   if(req.method!=='POST')return send(405,{error:'method_not_allowed'},{Allow:'POST, DELETE'});
   let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>MAX_BODY)return send(413,{error:'too_large'});chunks.push(c);}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});}
   const batch=Array.isArray(body),messages=batch?body:[body];
   const session=messages.some(m=>m?.method==='initialize')?{'Mcp-Session-Id':crypto.randomUUID()}:{};
   // A client that takes only an event stream gets its replies as one; keep-alive comments hold slow tool calls open.
   const accept=String(req.headers.accept||'');const stream=/text\/event-stream/i.test(accept)&&!/application\/json|\*\/\*/i.test(accept);
   let tick;if(stream&&messages.some(m=>m?.id!==undefined)){res.writeHead(200,{...base,...session,'Content-Type':'text/event-stream','Connection':'keep-alive'});tick=setInterval(()=>res.write(': keep-alive\n\n'),15000);}
   const replies=[];try{
    for(const msg of messages){const no=refusal(msg,client);const reply=no?(msg?.id===undefined?null:refused(msg.id,no)):await handle(msg,{allow:client.full?null:client.tools||REMOTE_TOOLS});if(reply)replies.push(reply);}
   }finally{clearInterval(tick);}
   if(tick){for(const r of replies)res.write(`event: message\ndata: ${JSON.stringify(r)}\n\n`);return res.end();}
   if(!replies.length)return send(202,undefined,session);
   return send(200,batch?replies:replies[0],session);
  }catch(e){log(`500 ${req.method} ${req.url}: ${e?.message||e}`);if(!res.headersSent)send(500,{error:'server_error'});else res.end();}
 });
}

// A client for scripts and hand-written connections that survives forwarding blips. It retries only what never reached
// DeltaRoute (no X-DeltaRoute header) and DeltaRoute's own 401 once, so a task is never submitted twice; network errors
// are retried for everything except submit_task, whose request may have arrived.
export async function remoteRequest(baseUrl,{method='GET',route='/mcp',key=process.env.DELTAROUTE_KEY,body,retries=4,delayMs=2000,fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const url=String(baseUrl).replace(/\/+$/,'').replace(/\/mcp$/,'')+route;const submits=JSON.stringify(body||'').includes('"submit_task"');let last,authRetried=false;
 for(let i=0;i<=retries;i++){
  if(i)await sleep(Math.min(30000,delayMs*2**(i-1)));
  let res;try{res=await fetchImpl(url,{method,headers:{Accept:'application/json, text/event-stream',...(body===undefined?{}:{'Content-Type':'application/json'}),...(key?{Authorization:'Bearer '+key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
  catch(e){last=Error(`Network error reaching ${url}: ${e.message}`);if(submits&&method==='POST')throw Error(last.message+' (not retried: the task may have been submitted; check get_task or list jobs first)');continue;}
  const ours=res.headers.get('x-deltaroute')!==null;
  if(res.ok)return res;
  if(!ours){last=Error(`HTTP ${res.status} from the forwarding layer, not DeltaRoute (the codespace or its port forwarding is down or flapping)`);continue;}
  if(res.status===401&&!authRetried){authRetried=true;last=Error('DeltaRoute rejected the key (401)');continue;}
  const text=await res.text().catch(()=>'');throw Error(`DeltaRoute answered HTTP ${res.status}: ${text.slice(0,300)}`);
 }
 throw last;
}
export async function remoteCall(baseUrl,tool,args={},opts={}){
 const res=await remoteRequest(baseUrl,{...opts,method:'POST',body:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:tool,arguments:args}}});
 const reply=await res.json();if(reply.error)throw Error(reply.error.message);const text=reply.result?.content?.[0]?.text||'';
 if(reply.result?.isError)throw Error(text);try{return JSON.parse(text);}catch{return text;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [cmd,arg]=process.argv.slice(2);const flag=n=>{const i=process.argv.indexOf(n);return i>0?process.argv[i+1]:undefined;};
 const opts={full:process.argv.includes('--full'),allowCode:process.argv.includes('--allow-code')};
 if(cmd==='add-client'){const key=addClient(arg,opts);console.log(`Key for ${arg} (shown once; give it to that AI as: Authorization: Bearer <key>):\n${key}`);}
 else if(cmd==='set-client')console.log(setClient(arg,opts)?`${arg} now has ${opts.full?'full access':opts.allowCode?'limited access with code jobs':'limited access'}; its key is unchanged.`:`No client named ${arg}.`);
 else if(cmd==='remove-client')console.log(removeClient(arg)?`Removed ${arg}; its key no longer works.`:`No client named ${arg}.`);
 else if(cmd==='list-clients'){for(const [n,c] of Object.entries(loadClients()))console.log(`${n}  ${c.full?'full access: every tool and action':`tools: ${c.tools.join(', ')}  code jobs: ${c.allowCode?'allowed':'off'}`}  added ${c.createdAt}`);}
 else if(['health','call','download'].includes(cmd)){
  if(!arg){console.error(`Usage: node remote-mcp.mjs ${cmd} <base url> ...`);process.exit(2);}
  const [,,,tool,extra]=process.argv.slice(1);
  try{
   if(cmd==='health')console.log(await (await remoteRequest(arg,{route:'/health',key:null,retries:2})).text());
   else if(cmd==='call')console.log(JSON.stringify(await remoteCall(arg,tool,JSON.parse(extra||'{}')),null,2));
   else{const taskId=tool,dir=path.resolve(extra||'.');const {files}=await (await remoteRequest(arg,{route:`/files/${taskId}`})).json();
    if(!files.length)console.log('That task has no output files.');fs.mkdirSync(dir,{recursive:true});
    for(const f of files){const res=await remoteRequest(arg,{route:f.path});const target=path.join(dir,path.basename(f.name));fs.writeFileSync(target,Buffer.from(await res.arrayBuffer()));console.log(`${target}  ${f.bytes} bytes`);}}
  }catch(e){console.error(e.message);process.exitCode=1;}
 }
 else if(cmd==='serve'){
  if(process.env.MODEL_ROUTER_WORKER)throw Error('Workers cannot serve DeltaRoute');
  const {handleMessage}=await import(pathToFileURL(path.join(ROOT,'server.mjs')).href);
  const port=Number(flag('--port')||process.env.DELTAROUTE_REMOTE_PORT||8787);
  const server=createRemoteServer({handle:handleMessage});
  server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Port ${port} is already in use (is another copy running? tmux attach -t =deltaroute-mcp)`:e.message);process.exit(1);});
  server.listen(port,'127.0.0.1',()=>console.log(`DeltaRoute MCP endpoint on http://127.0.0.1:${port}/mcp, health on /health (${Object.keys(loadClients()).length} connected AI(s))`));
  for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),5000).unref();});
 }
 else{console.log('Usage: node remote-mcp.mjs add-client <name> [--allow-code | --full] | set-client <name> --full | --allow-code | --limited | remove-client <name> | list-clients | serve [--port 8787] | health <url> | call <url> <tool> [json] | download <url> <task id> [dir]');process.exitCode=2;}
}
