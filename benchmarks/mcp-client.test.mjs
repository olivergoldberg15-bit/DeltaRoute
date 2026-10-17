import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalMcp} from './mcp-client.mjs';

test('local stdio MCP helper initializes and correlates fixture requests',async t=>{
 const fixture=`const readline=require('node:readline');readline.createInterface({input:process.stdin}).on('line',line=>{const request=JSON.parse(line);if(request.id)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{method:request.method,params:request.params}})+'\\n');});`;
 const client=new LocalMcp(process.execPath,['-e',fixture],{requestTimeoutMs:2000});t.after(()=>client.close());
 await client.init();const response=await client.call('fixture',{value:42});assert.equal(response.method,'tools/call');assert.equal(response.params.arguments.value,42);
});
test('local MCP helper rejects pending requests when its process exits',async t=>{
 const client=new LocalMcp(process.execPath,['-e',`process.stdin.once('data',()=>process.exit(0));`],{requestTimeoutMs:2000});t.after(()=>client.close());
 await assert.rejects(client.request('fixture'),/closed/);assert.equal(client.pending.size,0);
 await assert.rejects(client.request('fixture'),/closed/);
});
test('local MCP helper close clears timers and is idempotent',async()=>{
 const client=new LocalMcp(process.execPath,['-e',`process.stdin.resume();`],{requestTimeoutMs:2000});
 const response=client.request('fixture');client.close();client.close();await assert.rejects(response,/closed/);assert.equal(client.pending.size,0);
});
