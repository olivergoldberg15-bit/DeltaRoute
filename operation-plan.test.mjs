import {testTempRoot} from './test-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createWorkflow,approvePlan,readWorkflow,workflowStep,reserveStep,checkpointStep,subagentStep,reserveSubagent,workflowSummary,routeUsage,jobTokens,TOKENS_PER_RUN} from './workflows.mjs';

const SENTINEL='PROMPT_TAIL_SENTINEL_9182';
function setup(t,workflow){const root=fs.mkdtempSync(path.join(testTempRoot,'deltaroute-op-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const jobs=new Map(),read=id=>{if(!jobs.has(id))throw Error('No job');return jobs.get(id);};
 const plan=createWorkflow(root,{task:'Build the requested feature. '+'x'.repeat(2000)+SENTINEL,cwd:root,workflow});return {root,id:plan.id,plan,jobs,read};}
const twoRoutes={routes:[{id:'build',lead:'claude-opus-5-5'},{id:'research',budget:{runs:1}}],steps:[{id:'code',route:'build',task:'Write it',acceptance:['Tests pass']},{id:'facts',route:'research',task:'Find facts',category:'research',acceptance:['Cited']}]};
const usage=(fresh,output)=>({attempts:[{tokenUsage:{available:true,inputTokens:fresh+500000,freshInputTokens:fresh,cacheReadTokens:500000,outputTokens:output}}]});

test('nothing runs until the user approves the Operation Plan',t=>{
 const f=setup(t,twoRoutes);
 assert.equal(f.plan.approval.status,'awaiting_user');
 assert.throws(()=>workflowStep(f.root,f.id,'code',f.read),/waiting for the user's plan check/);
 assert.equal(workflowSummary(f.root,readWorkflow(f.root,f.id),f.read).steps[0].blockedReason,'plan awaits user approval');
 assert.throws(()=>approvePlan(f.root,f.id,{}),/approved_by_user/);
 const s=approvePlan(f.root,f.id,{approvedByUser:'yes, run it'});assert.equal(s.approval.status,'approved');assert.equal(s.approval.approvedByUser,'yes, run it');
 assert.throws(()=>approvePlan(f.root,f.id,{approvedByUser:'again'}),/already approved/);
 assert.equal(workflowStep(f.root,f.id,'code',f.read).task,'Write it');
});

test('routes group steps and get default budgets from their slots',t=>{
 const f=setup(t,twoRoutes);const routes=readWorkflow(f.root,f.id).contract.routes;
 assert.deepEqual(routes.find(r=>r.id==='build').budget,{tokens:3*TOKENS_PER_RUN,runs:3});
 assert.deepEqual(routes.find(r=>r.id==='research').budget,{tokens:3*TOKENS_PER_RUN,runs:1});
 assert.equal(routes.find(r=>r.id==='build').lead,'claude-opus-5-5');
 assert.throws(()=>setup(t,{routes:[{id:'a'}],steps:[{id:'s',route:'b',task:'x',acceptance:['y']}]}),/unknown route b/);
 assert.throws(()=>setup(t,{routes:[{id:'a'},{id:'empty'}],steps:[{id:'s',route:'a',task:'x',acceptance:['y']}]}),/Route empty has no steps/);
});

test('a route stops at its run budget and reports what went wrong',t=>{
 const f=setup(t,twoRoutes);approvePlan(f.root,f.id,{approvedByUser:'go'});
 f.jobs.set('r1',{id:'r1',status:'failed',error:'Primary search browser challenge: robot check'});reserveStep(f.root,f.id,'facts','r1',f.read);
 assert.throws(()=>workflowStep(f.root,f.id,'facts',f.read),/research has used its runs budget.*robot check/s);
 const s=workflowSummary(f.root,readWorkflow(f.root,f.id),f.read);assert.equal(s.routes.find(r=>r.id==='research').exhausted,'runs');assert.equal(s.steps.find(x=>x.id==='facts').blockedReason,'route budget exhausted');
 assert.equal(workflowStep(f.root,f.id,'code',f.read).task,'Write it');
});

test('a route stops at its token budget; tokens are fresh input plus output',t=>{
 const f=setup(t,{routes:[{id:'main',budget:{tokens:100000,runs:9}}],steps:[{id:'code',task:'Write it',acceptance:['Tests pass']}]});approvePlan(f.root,f.id,{approvedByUser:'go'});
 f.jobs.set('j1',{id:'j1',status:'completed',...usage(90000,15000)});reserveStep(f.root,f.id,'code','j1',f.read);
 checkpointStep(f.root,f.id,'code',{accepted:false,note:'Missing the edge case'},f.read);
 const u=routeUsage(readWorkflow(f.root,f.id),'main',f.read);assert.equal(u.used.tokens,105000);assert.equal(u.exhausted,'tokens');
 assert.throws(()=>workflowStep(f.root,f.id,'code',f.read),/tokens budget.*Missing the edge case/s);
});

test('token counting handles Codex and Gemini cache reporting and leaves unknown unknown',()=>{
 assert.deepEqual(jobTokens(usage(60000,5000)),{tokens:65000,measured:true});
 assert.deepEqual(jobTokens({attempts:[{tokenUsage:{available:true,inputTokens:134087,freshInputTokens:0,cacheReadTokens:1331178,outputTokens:50646}}]}),{tokens:184733,measured:true});
 assert.deepEqual(jobTokens({attempts:[{tokenUsage:{available:false}}]}),{tokens:0,measured:false});
});

test('sub-agents run first, cheap and read-only, and their results reach the agent',t=>{
 const f=setup(t,{steps:[{id:'code',task:'Write it',acceptance:['Tests pass'],subagents:[{id:'names',task:'List the exported names'}]}]});approvePlan(f.root,f.id,{approvedByUser:'go'});
 assert.throws(()=>workflowStep(f.root,f.id,'code',f.read),/sub-agents first.*names/s);
 const sub=subagentStep(f.root,f.id,'code','names',f.read);assert.equal(sub.mode,'read-only');assert.equal(sub.workflowRef.subagentId,'names');assert.match(sub.brief,/narrow, read-only piece/);
 assert.throws(()=>subagentStep(f.root,f.id,'code','other',f.read),/Unknown sub-agent/);
 f.jobs.set('s1',{id:'s1',status:'completed',...usage(10000,1000)});reserveSubagent(f.root,f.id,'code','names','s1',f.read);
 const next=workflowStep(f.root,f.id,'code',f.read);assert.match(next.brief,/"subagentResults":\[\{"id":"names","status":"completed"/);
 assert.equal(routeUsage(readWorkflow(f.root,f.id),'main',f.read).used.runs,1);
});

test('the context rail points at the contract instead of pushing the prompt',t=>{
 const f=setup(t,twoRoutes);approvePlan(f.root,f.id,{approvedByUser:'go'});const step=workflowStep(f.root,f.id,'code',f.read);
 assert.equal(step.brief.includes(SENTINEL),false);assert.match(step.brief,/requiredContractArtifact/);assert.ok(step.brief.length<2500);
 assert.equal(readWorkflow(f.root,f.id).contract.originalPrompt.includes(SENTINEL),true);
});

test('rework carries only the reviewer notes back to the branch',t=>{
 const f=setup(t,twoRoutes);approvePlan(f.root,f.id,{approvedByUser:'go'});
 f.jobs.set('c1',{id:'c1',status:'completed'});reserveStep(f.root,f.id,'code','c1',f.read);checkpointStep(f.root,f.id,'code',{accepted:false,note:'Camera clips into the wall at 0:12'},f.read);
 assert.match(workflowStep(f.root,f.id,'code',f.read).brief,/"reviewerNotes":"Camera clips into the wall at 0:12"/);
});

test('plans saved before routes and approval existed still run',t=>{
 const f=setup(t,twoRoutes);const file=path.join(f.root,'workflows',f.id,'plan.json');const plan=JSON.parse(fs.readFileSync(file,'utf8'));
 delete plan.approval;delete plan.contract.routes;for(const s of plan.contract.steps){delete s.route;delete s.subagents;delete s.provider;delete s.model;}
 plan.contractHash=crypto.createHash('sha256').update(JSON.stringify(plan.contract)).digest('hex');fs.writeFileSync(file,JSON.stringify(plan));
 assert.equal(workflowStep(f.root,f.id,'code',f.read).task,'Write it');const s=workflowSummary(f.root,readWorkflow(f.root,f.id),f.read);assert.equal(s.approval.legacy,true);assert.equal(s.routes[0].id,'main');
});
