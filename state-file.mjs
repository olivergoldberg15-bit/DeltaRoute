import fs from 'node:fs';
const pause=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
export function atomicWriteJSON(file,data,{rename=fs.renameSync,sleep=pause,attempts=12,beforeCommit=x=>x}={}){
 const tmp=file+'.'+process.pid+'.tmp';let error;
 for(let i=0;i<attempts;i++){
  const current=beforeCommit(data);
  try{fs.writeFileSync(tmp,JSON.stringify(current,null,2));rename(tmp,file);return current;}catch(e){error=e;if(!['EPERM','EACCES','EBUSY'].includes(e.code))break;if(i+1<attempts)sleep(Math.min(250,5*2**i));}
 }
 try{fs.unlinkSync(tmp);}catch{}throw error||Error('Atomic state update failed');
}

export function renameWithRetry(from,to){let error;for(let i=0;i<12;i++){try{fs.renameSync(from,to);return;}catch(e){error=e;if(!['EPERM','EACCES','EBUSY'].includes(e.code))throw e;pause(Math.min(250,5*2**i));}}throw error;}
