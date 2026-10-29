import {readFile,appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {runPost} from '../src/pipeline.mjs';
import {MemoryStore} from '../src/store.mjs';
export async function replay(path,{x,provider,env=process.env}={}) {
 const store=new MemoryStore(),entries=[];
 // Replay reads with the fixed X_ACCESS_TOKEN and never renews the bot's token: a renewal here would rotate the refresh token out from under the deployed bot.
 for(const line of (await readFile(path,'utf8')).split(/\r?\n/).filter(Boolean))entries.push(await runPost(JSON.parse(line),{env:{...env,LIVE:'0',DRY_RUN:'1',X_CLIENT_ID:''},store,x,provider}));
 return entries;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const entries=await replay(process.argv[2]);for(const entry of entries)await appendFile(process.argv[3]||'replay.jsonl',JSON.stringify(entry)+'\n');
}
