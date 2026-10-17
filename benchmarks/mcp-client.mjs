/** Small stdio MCP client for explicitly configured local benchmark fixtures. */
import {spawn} from 'node:child_process';
import readline from 'node:readline';

export class LocalMcp {
 constructor(command,args,{requestTimeoutMs=60000,...options}={}) {
  this.next=1;this.pending=new Map();this.stderr='';this.closed=false;this.requestTimeoutMs=requestTimeoutMs;
  this.p=spawn(command,args,{windowsHide:true,...options,stdio:['pipe','pipe','pipe']});
  this.p.stderr.on('data',data=>this.stderr=(this.stderr+data).slice(-20000));
  this.p.on('error',error=>{this.closed=true;this.failAll(error);});
  this.p.on('close',()=>{this.closed=true;this.failAll(Error('MCP process closed'));});
  this.p.stdin.on('error',error=>this.failAll(error));
  this.lines=readline.createInterface({input:this.p.stdout});
  this.lines.on('line',line=>{
   let response;try{response=JSON.parse(line);}catch{return;}
   const pending=this.pending.get(response.id);if(!pending)return;
   clearTimeout(pending.timer);this.pending.delete(response.id);
   response.error?pending.reject(Error(response.error.message||'MCP request failed')):pending.resolve(response.result);
  });
 }
 failAll(error){for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}this.pending.clear();}
 request(method,params={}) {
  if(this.closed)return Promise.reject(Error('MCP client is closed'));
  return new Promise((resolve,reject)=>{
   const id=this.next++,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('MCP timeout: '+method));},this.requestTimeoutMs);
   this.pending.set(id,{resolve,reject,timer});
   this.p.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n',error=>{
    if(!error)return;const pending=this.pending.get(id);if(!pending)return;
    clearTimeout(pending.timer);this.pending.delete(id);pending.reject(error);
   });
  });
 }
 async init(){await this.request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'deltaroute-benchmark',version:'1.0'}});this.p.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');return this;}
 async call(name,args={}){return this.request('tools/call',{name,arguments:args});}
 close(){if(this.closed)return;this.closed=true;this.failAll(Error('MCP closed'));this.p.stdin.end();this.lines.close();this.p.kill();}
}
