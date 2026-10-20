import {testTempRoot} from './test-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createWorkflow,approvePlan,reserveStep,reserveSubagent,checkpointStep,simulatedReview,finalReview} from './workflows.mjs';
import {readEvents} from './events.mjs';
import {renderDashboard} from './dashboard.mjs';

function setup(t){const root=fs.mkdtempSync(path.join(testTempRoot,'deltaroute-dash-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const jobs=new Map(),read=id=>{if(!jobs.has(id))throw Error('No job');return jobs.get(id);};
 const plan=createWorkflow(root,{task:'Ship the <script>alert(1)</script> page',cwd:root,workflow:{routes:[{id:'build'},{id:'research'}],steps:[{id:'page',route:'build',task:'Build',acceptance:['Works'],subagents:[{id:'copy',task:'Draft copy'}]},{id:'facts',route:'research',task:'Facts',category:'research',acceptance:['Works']}]}});return {root,id:plan.id,jobs,read};}
const pass={accepted:true,score:91,note:'Checked',checks:[{criterion:'Works',passed:true,evidence:'Ran it'}]};

test('every workflow change is logged in order',t=>{
 const f=setup(t);approvePlan(f.root,f.id,{approvedByUser:'go ahead'});
 f.jobs.set('s1',{id:'s1',status:'completed'});reserveSubagent(f.root,f.id,'page','copy','s1',f.read);
 f.jobs.set('p1',{id:'p1',status:'completed'});reserveStep(f.root,f.id,'page','p1',f.read);checkpointStep(f.root,f.id,'page',{score:70,note:'Header overlaps'},f.read);
 assert.deepEqual(readEvents(f.root,f.id).map(e=>e.type),['plan_created','plan_approved','subagent_launched','step_launched','sent_back']);
 assert.equal(readEvents(f.root,f.id).at(-1).score,70);
});

test('the dashboard draws the tree, escapes text and refreshes until done',t=>{
 const f=setup(t);let file=renderDashboard(f.root,f.id,f.read);let html=fs.readFileSync(file,'utf8');
 assert.equal(file,path.join(f.root,'workflows',f.id,'dashboard.html'));
 assert.match(html,/Waiting for your plan check/);assert.match(html,/http-equiv="refresh"/);
 assert.equal(html.includes('<script>alert(1)</script>'),false);assert.match(html,/&lt;script&gt;/);
 for(const label of ['Chief','OP · Operation Plan','Route lead','Log self-check','Review','Simulated review','Human approves','build','research','copy'])assert.ok(html.includes(label),label);
 approvePlan(f.root,f.id,{approvedByUser:'go'});
 f.jobs.set('s1',{id:'s1',status:'completed'});reserveSubagent(f.root,f.id,'page','copy','s1',f.read);
 f.jobs.set('p1',{id:'p1',status:'completed',provider:'codex',modelUsed:'gpt-5',selfCheck:{passed:true,findings:[{severity:'warning',kind:'traceback'}]},attempts:[{tokenUsage:{available:true,freshInputTokens:40000,inputTokens:400000,cacheReadTokens:360000,outputTokens:5000}}]});reserveStep(f.root,f.id,'page','p1',f.read);checkpointStep(f.root,f.id,'page',pass,f.read);
 f.jobs.set('r1',{id:'r1',status:'completed'});reserveStep(f.root,f.id,'facts','r1',f.read);checkpointStep(f.root,f.id,'facts',pass,f.read);
 html=fs.readFileSync(renderDashboard(f.root,f.id,f.read),'utf8');
 assert.match(html,/codex · gpt-5/);assert.match(html,/45K tok/);assert.match(html,/0 blocking · 1 warning/);assert.match(html,/page 91 ✓/);assert.match(html,/Ready for simulated review/);
 simulatedReview(f.root,f.id,{score:88,note:'Opened it',evidence:['clicked through'],visual_evidence:[]},f.read);finalReview(f.root,f.id,{chiefNote:'Good'},f.read);finalReview(f.root,f.id,{approvedByUser:'ship it'},f.read);
 html=fs.readFileSync(renderDashboard(f.root,f.id,f.read),'utf8');
 assert.match(html,/Done, approved by you/);assert.equal(/http-equiv="refresh"/.test(html),false);assert.match(html,/You approved the result: &quot;ship it&quot;/);
});
