import {testTempRoot} from './test-fixtures.mjs';
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {imageSpec,isImageBytes,verifyOutputs,deliverOutputs,parseHiggsfieldResult,parseCredits,runHiggsfield,codexImageAssignment,salvageAttempt,higgsfieldCreateArgs} from './image-jobs.mjs';
import {candidateProviders,classifyFailure} from './fallback-policy.mjs';
// Image jobs run on Nano Banana Pro (Higgsfield credits) or Codex's image tool. No test here calls a provider.
const tmp=fs.mkdtempSync(path.join(testTempRoot,'deltaroute-image-'));
after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
const PNG=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.alloc(32)]);
const ref=path.join(tmp,'ref.png');fs.writeFileSync(ref,PNG);

test('image specs are normalized and unsafe requests are refused before anything runs',()=>{
 const spec=imageSpec({style:'clay',outputs:[{file:'u1.png',prompt:'a room',references:['ref.png']}]},{cwd:tmp});
 assert.deepEqual(spec.outputs[0],{file:'u1.png',prompt:'a room',aspect_ratio:'1:1',resolution:'2k',references:[ref]});
 assert.equal(spec.deliverTo,null);assert.equal(spec.maxCredits,null);
 for(const bad of [{outputs:[]},{outputs:[{file:'../x.png',prompt:'p'}]},{outputs:[{file:'a/b.png',prompt:'p'}]},{outputs:[{file:'x.gif',prompt:'p'}]},{outputs:[{file:'x.png',prompt:''}]},{outputs:[{file:'x.png',prompt:'p'},{file:'X.PNG',prompt:'p'}]},{outputs:[{file:'x.png',prompt:'p',aspect_ratio:'7:5'}]},{outputs:[{file:'x.png',prompt:'p',references:['missing.png']}]},{outputs:[{file:'x.png',prompt:'p'}],deliver_to:'relative/dir'}]){
  assert.throws(()=>imageSpec(bad,{cwd:tmp}),err=>{assert.equal(classifyFailure(err.message).fallbackEligible,false,err.message);return true;});
 }
});

test('only real image files count as outputs',()=>{
 assert.equal(isImageBytes(PNG),true);
 assert.equal(isImageBytes(Buffer.concat([Buffer.from([0xff,0xd8,0xff]),Buffer.alloc(20)])),true);
 assert.equal(isImageBytes(Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBP'),Buffer.alloc(8)])),true);
 assert.equal(isImageBytes(Buffer.from('<html>error page</html>')),false);
 const dir=path.join(tmp,'verify');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'a.png'),PNG);fs.writeFileSync(path.join(dir,'b.png'),'not an image');
 const spec=imageSpec({outputs:[{file:'a.png',prompt:'p'},{file:'b.png',prompt:'p'},{file:'c.png',prompt:'p'}]},{cwd:tmp});
 const v=verifyOutputs(dir,spec);assert.equal(v.ok,false);assert.deepEqual(v.missing,['b.png','c.png']);assert.equal(v.files[0].file,'a.png');
 const deliver=path.join(tmp,'delivered');const done=deliverOutputs({files:v.files},deliver);
 assert.equal(done[0].path,path.join(deliver,'a.png'));assert.ok(fs.existsSync(path.join(deliver,'a.png')));
});

test('Higgsfield results and balances are read from the CLI output',()=>{
 const r=parseHiggsfieldResult('Waiting...\n[{"id":"j1","status":"completed","display_name":"Nano Banana Pro","job_type":"nano_banana_pro","result_url":"https://cdn.example/x.png"}]');
 assert.deepEqual(r,{id:'j1',url:'https://cdn.example/x.png',model:'Nano Banana Pro'});
 assert.throws(()=>parseHiggsfieldResult('[{"status":"failed","error":"nsfw"}]'),/did not complete: failed nsfw/);
 assert.throws(()=>parseHiggsfieldResult('[{"status":"completed"}]'),/without a result URL/);
 assert.throws(()=>parseHiggsfieldResult('no json here'),/no JSON/);
 assert.equal(parseCredits('olivergoldberg15@gmail.com — starter plan, 32.75 credits'),32.75);
 assert.equal(parseCredits('2 credits'),2);assert.equal(parseCredits('nothing'),null);
 const args=higgsfieldCreateArgs('nano_banana_2',{style:'clay'},{prompt:'room',aspect_ratio:'2:3',resolution:'2k',references:[ref]});
 assert.deepEqual(args,['generate','create','nano_banana_2','--prompt','clay\n\nroom','--aspect_ratio','2:3','--resolution','2k','--image',ref,'--wait','--json']);
});

function fakeCli({balance=30,price=2,fail=null}={}){
 const calls=[];let left=balance;
 const run=async(command,args)=>{calls.push(args);
  if(args[0]==='account')return fail==='auth'?{code:1,stdout:'',stderr:'Session expired'}:{code:0,stdout:`starter plan, ${left} credits`,stderr:''};
  if(args[1]==='cost')return {code:0,stdout:`${price} credits`,stderr:''};
  left-=price;return {code:0,stdout:JSON.stringify([{id:'job-'+calls.length,status:'completed',display_name:'Nano Banana Pro',result_url:'https://cdn.example/'+calls.length+'.png'}]),stderr:''};};
 return {calls,run,download:async()=>PNG};
}

test('Nano Banana Pro jobs are priced first, capped, and report the credits they used',async()=>{
 const spec=imageSpec({style:'clay',outputs:[{file:'a.png',prompt:'p',aspect_ratio:'2:3'},{file:'b.png',prompt:'q',aspect_ratio:'2:3'}]},{cwd:tmp});
 const cli=fakeCli({balance:30,price:2}),out=path.join(tmp,'nb-out');
 const result=await runHiggsfield({spec,worker:{command:'higgsfield',model:'nano_banana_2',maxCreditsPerJob:24},outDir:out,run:cli.run,download:cli.download});
 assert.equal(cli.calls.filter(a=>a[1]==='cost').length,1,'one price check per aspect and resolution');
 assert.deepEqual(result.credits,{estimated:4,before:30,after:26,used:4,cap:24});
 assert.equal(result.model,'Nano Banana Pro');assert.ok(verifyOutputs(out,spec).ok);
 // Over the cap or over the balance: refused before generating, and classified so Codex can take it.
 for(const [opts,cap] of [[{balance:30,price:20},undefined],[{balance:3,price:2},24]]){
  const c=fakeCli(opts);
  await assert.rejects(runHiggsfield({spec:{...spec,maxCredits:cap??null},worker:{command:'h',maxCreditsPerJob:24},outDir:path.join(tmp,'nb-refused'),run:c.run,download:c.download}),err=>{assert.equal(classifyFailure(err.message).kind,'quota',err.message);return true;});
  assert.equal(c.calls.some(a=>a[1]==='create'),false,'nothing generated');
 }
 const expired=fakeCli({fail:'auth'});
 await assert.rejects(runHiggsfield({spec,worker:{command:'h'},outDir:path.join(tmp,'nb-auth'),run:expired.run,download:expired.download}),err=>{assert.equal(classifyFailure(err.message).kind,'auth');return true;});
});

test('the Codex backup gets every file name, the shared style and its references',()=>{
 const spec=imageSpec({style:'Soft clay',outputs:[{file:'u1.png',prompt:'kitchen lab',aspect_ratio:'2:3',references:['ref.png']},{file:'sun.png',prompt:'happy sun'}]},{cwd:tmp});
 const text=codexImageAssignment(spec);
 assert.match(text,/image_generation/);assert.match(text,/u1\.png \(aspect 2:3\): Soft clay kitchen lab/);assert.match(text,/sun\.png/);assert.match(text,/attached reference/);
});

test('a cut-off run is judged by what it left, not by its exit status',()=>{
 const outputs={ok:true,files:[{file:'a.png'},{file:'b.png'}]};
 const kept=salvageAttempt({status:'timed_out',error:'Worker exceeded time limit'},{category:'image',outputs});
 assert.equal(kept.status,'completed');assert.equal(kept.recoveredFrom.status,'timed_out');assert.match(kept.warning,/all 2 expected image files exist/);
 assert.equal(salvageAttempt({status:'timed_out'},{category:'image',outputs:{ok:false,files:[],missing:['a.png']}}),null);
 const handoff=salvageAttempt({status:'timed_out'},{mode:'code',changed:['src/a.js','src/b.js'],failureKind:'timeout'});
 assert.equal(handoff.handoffRequired,true);assert.match(handoff.error,/after changing 2 file\(s\)/);
 assert.equal(salvageAttempt({status:'failed',error:'stream disconnected'},{mode:'code',changed:['a'],failureKind:'outage'}).handoffRequired,true);
 assert.equal(salvageAttempt({status:'failed',error:'wrong sandbox'},{mode:'code',changed:['a'],failureKind:'capability'}),null,'real failures still fall back');
 assert.equal(salvageAttempt({status:'timed_out'},{mode:'code',changed:[]}),null);
 assert.equal(salvageAttempt({status:'completed'},{category:'image',outputs}),null);
});

test('image jobs route to Nano Banana Pro then Codex, and credits are never a fallback for other work',()=>{
 const workers=[{name:'higgsfield',enabled:true,installed:true},{name:'codex',enabled:true,installed:true},{name:'gemini',enabled:true,installed:true},{name:'perplexity',enabled:true,installed:true}];
 assert.deepEqual(candidateProviders({category:'image',mode:'artifacts',workers}),['higgsfield','codex']);
 assert.deepEqual(candidateProviders({category:'image',mode:'artifacts',workers:[{...workers[0],enabled:false},workers[1]]}),['codex']);
 assert.deepEqual(candidateProviders({category:'image',mode:'artifacts',workers:[workers[0],{...workers[1],capabilities:{image:false}}]}),['higgsfield']);
 assert.deepEqual(candidateProviders({category:'image',mode:'read-only',workers}),[]);
 assert.deepEqual(candidateProviders({category:'implementation',mode:'artifacts',workers}),[]);
 for(const category of ['implementation','research','summarization'])assert.equal(candidateProviders({requested:'higgsfield',category,workers}).includes('higgsfield'),false,category);
});

test('dropped connections and missing image files are classified so the right fallback runs',()=>{
 assert.equal(classifyFailure('Reconnecting... 5/5 (stream disconnected before completion: No such host is known. (os error 11001))').kind,'outage');
 assert.equal(classifyFailure('Image job finished but expected files are missing or invalid: u1.png').kind,'capability');
});
