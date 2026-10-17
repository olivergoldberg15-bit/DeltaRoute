import {renameWithRetry} from './state-file.mjs';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const pattern=/^owner-([1-9]\d*)-[a-f0-9-]+\.json$/;
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;return true;}};
function dispose(dir){for(const name of fs.readdirSync(dir)){if(!pattern.test(name))throw Error('Unknown lease entry; refusing deletion');fs.unlinkSync(path.join(dir,name));}fs.rmdirSync(dir);}
export function acquireProcessLease(lock){const parent=path.dirname(lock),token=crypto.randomUUID(),marker=`owner-${process.pid}-${token}.json`,staging=path.join(parent,'.lease-'+token);fs.mkdirSync(parent,{recursive:true});fs.mkdirSync(staging);fs.writeFileSync(path.join(staging,marker),'');let acquired=false;const deadline=Date.now()+5000,pause=()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);
 try{while(Date.now()<deadline){try{fs.renameSync(staging,lock);acquired=true;break;}catch(e){if(!fs.existsSync(lock)){if(['EPERM','EACCES','EBUSY'].includes(e.code)){pause();continue;}throw e;}}
  let names;try{names=fs.readdirSync(lock);}catch(e){if(e.code==='ENOENT')continue;throw e;}if(names.length!==1)throw Error('Lease ownership unconfirmed');const name=names[0];let pid;if(pattern.test(name))pid=Number(name.match(pattern)[1]);else if(name==='pid')pid=Number(fs.readFileSync(path.join(lock,name),'utf8'));if(!pid||alive(pid))throw Error('Coordinator/workflow is busy or still active');
  const claim=`owner-${process.pid}-${crypto.randomUUID()}.json`;try{fs.renameSync(path.join(lock,name),path.join(lock,claim));}catch(e){if(['ENOENT','EACCES','EPERM'].includes(e.code))continue;throw e;}const grave=path.join(parent,'.lease-reaped-'+crypto.randomUUID());renameWithRetry(lock,grave);dispose(grave);
 }if(!acquired)throw Error('Lease acquisition contention; no process launched');return ()=>{if(fs.existsSync(path.join(lock,marker))){const grave=path.join(parent,'.lease-released-'+token);renameWithRetry(lock,grave);dispose(grave);}};
 }finally{if(!acquired&&fs.existsSync(staging))dispose(staging);}}
