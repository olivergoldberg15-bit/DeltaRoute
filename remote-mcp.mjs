// DeltaRoute over HTTP (MCP Streamable HTTP, JSON responses), so any MCP-capable AI the owner connects (Meta Muse
// custom connectors, ChatGPT or Claude connectors, other agents) can use DeltaRoute's tools. Every connected AI has its
// own key: only its SHA-256 is stored, in state/remote-clients.json (owner-only, never in Git), and removing the
// client revokes it. A connected AI acts for the owner but never in the owner's name: it cannot approve plans or
// reviews, change the model registry, or start code jobs unless that client was added with --allow-code.
// It listens on 127.0.0.1; a host's port forwarding (GitHub Codespaces) publishes it. No dependencies.
//   node remote-mcp.mjs add-client <name> [--allow-code]   prints that client's key once
//   node remote-mcp.mjs list-clients | remove-client <name>
//   node remote-mcp.mjs serve [--port 8787]                 endpoint: POST /mcp with Authorization: Bearer <key>
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
export const CLIENTS_FILE=path.join(ROOT,'state','remote-clients.json');
export const REMOTE_TOOLS=['list_workers','recommend_route','submit_task','get_task','cancel_task'];
const MAX_BODY=1024*1024;
const sha=key=>crypto.createHash('sha256').update(String(key)).digest('hex');

export function loadClients(file=CLIENTS_FILE){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return {};}}
function saveClients(clients,file){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(clients,null,1)+'\n',{mode:0o600});}
export function addClient(name,{file=CLIENTS_FILE,allowCode=false}={}){
 if(!/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(String(name)))throw Error('Client name: 1-40 letters, digits, - or _');
 const clients=loadClients(file);if(clients[name])throw Error('A client with that name exists; remove it first to issue a new key');
 const key='dr_'+crypto.randomBytes(32).toString('base64url');
 clients[name]={keySha256:sha(key),tools:REMOTE_TOOLS,allowCode:Boolean(allowCode),createdAt:new Date().toISOString()};saveClients(clients,file);return key;
}
export function removeClient(name,{file=CLIENTS_FILE}={}){const clients=loadClients(file);if(!clients[name])return false;delete clients[name];saveClients(clients,file);return true;}
export function authorize(header,clients){
 const key=/^Bearer\s+(\S+)$/i.exec(String(header||''))?.[1];if(!key)return null;const digest=Buffer.from(sha(key));
 for(const [name,c] of Object.entries(clients))if(typeof c.keySha256==='string'&&c.keySha256.length===digest.length&&crypto.timingSafeEqual(Buffer.from(c.keySha256),digest))return {name,...c};
 return null;
}
// What a connected AI may not do through an allowed tool. Returns the refusal, or null.
export function refusal(msg,client){
 if(msg?.method!=='tools/call')return null;const {name,arguments:a={}}=msg.params||{};
 if(name==='submit_task'){
  if((a.action||'delegate')!=='delegate')return 'Connected AIs can delegate tasks only; plans, reviews and approvals stay with the owner.';
  if(a.mode==='code'&&!client.allowCode)return 'Code jobs are off for this connection; the owner can allow them with add-client --allow-code.';
 }
 return null;
}
const refused=(id,text)=>({jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text}]}});

export function createRemoteServer({handle,clientsFile=CLIENTS_FILE}){
 return http.createServer(async(req,res)=>{
  const send=(status,body,headers={})=>{res.writeHead(status,{'Cache-Control':'no-store',...(body===undefined?{}:{'Content-Type':'application/json'}),...headers});res.end(body===undefined?undefined:JSON.stringify(body));};
  try{
   if(new URL(req.url,'http://x').pathname!=='/mcp')return send(404,{error:'not_found'});
   const client=authorize(req.headers.authorization,loadClients(clientsFile));
   if(!client)return send(401,{error:'unauthorized'},{'WWW-Authenticate':'Bearer'});
   // No server-to-client stream is offered; every reply comes back on its POST.
   if(req.method!=='POST')return send(405,{error:'method_not_allowed'},{Allow:'POST'});
   let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>MAX_BODY)return send(413,{error:'too_large'});chunks.push(c);}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});}
   const replies=[];
   for(const msg of Array.isArray(body)?body:[body]){const no=refusal(msg,client);const reply=no?(msg?.id===undefined?null:refused(msg.id,no)):await handle(msg,{allow:client.tools||REMOTE_TOOLS});if(reply)replies.push(reply);}
   if(!replies.length)return send(202);
   return send(200,Array.isArray(body)?replies:replies[0]);
  }catch{if(!res.headersSent)send(500,{error:'server_error'});}
 });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [cmd,arg]=process.argv.slice(2);const flag=n=>{const i=process.argv.indexOf(n);return i>0?process.argv[i+1]:undefined;};
 if(cmd==='add-client'){const key=addClient(arg,{allowCode:process.argv.includes('--allow-code')});console.log(`Key for ${arg} (shown once; give it to that AI as: Authorization: Bearer <key>):\n${key}`);}
 else if(cmd==='remove-client')console.log(removeClient(arg)?`Removed ${arg}; its key no longer works.`:`No client named ${arg}.`);
 else if(cmd==='list-clients'){for(const [n,c] of Object.entries(loadClients()))console.log(`${n}  tools: ${c.tools.join(', ')}  code jobs: ${c.allowCode?'allowed':'off'}  added ${c.createdAt}`);}
 else if(cmd==='serve'){
  if(process.env.MODEL_ROUTER_WORKER)throw Error('Workers cannot serve DeltaRoute');
  const {handleMessage}=await import(pathToFileURL(path.join(ROOT,'server.mjs')).href);
  const port=Number(flag('--port')||process.env.DELTAROUTE_REMOTE_PORT||8787);
  createRemoteServer({handle:handleMessage}).listen(port,'127.0.0.1',()=>console.log(`DeltaRoute MCP endpoint on http://127.0.0.1:${port}/mcp (${Object.keys(loadClients()).length} connected AI(s))`));
 }
 else{console.log('Usage: node remote-mcp.mjs add-client <name> [--allow-code] | remove-client <name> | list-clients | serve [--port 8787]');process.exitCode=2;}
}
