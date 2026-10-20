import {testTempRoot} from './test-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {selfCheckLogs,PASS_SCORE} from './review.mjs';
import {createWorkflow,approvePlan,readWorkflow,workflowStep,reserveStep,checkpointStep,simulatedReview,finalReview,workflowSummary,workflowPhase} from './workflows.mjs';

const steps=[{id:'build',task:'Build it',acceptance:['Works']},{id:'polish',task:'Polish it',depends_on:['build'],acceptance:['Works']}];
function setup(t,workflow={steps}){const root=fs.mkdtempSync(path.join(testTempRoot,'deltaroute-review-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const jobs=new Map(),read=id=>{if(!jobs.has(id))throw Error('No job');return jobs.get(id);};
 const plan=createWorkflow(root,{task:'Make the thing',cwd:root,workflow});approvePlan(root,plan.id,{approvedByUser:'go'});return {root,id:plan.id,jobs,read};}
const pass=(score=90,extra={})=>({accepted:true,score,note:'Checked against the plan',checks:[{criterion:'Works',passed:true,evidence:'Ran it'}],...extra});
function run(f,step,jobId,job={}){f.jobs.set(jobId,{id:jobId,status:'completed',...job});reserveStep(f.root,f.id,step,jobId,f.read);}
function acceptAll(f){run(f,'build','b1');checkpointStep(f.root,f.id,'build',pass(),f.read);run(f,'polish','p1');checkpointStep(f.root,f.id,'polish',pass(),f.read);}
const phase=f=>workflowPhase(readWorkflow(f.root,f.id));

test('log self-check blocks admitted failures and warns on log errors',()=>{
 assert.equal(selfCheckLogs({answer:''}).findings[0].kind,'empty_answer');
 const admitted=selfCheckLogs({answer:'I wrote the module but could not run the Blender tests here.'});assert.equal(admitted.passed,false);assert.equal(admitted.findings[0].kind,'admitted_incomplete');
 const clean=selfCheckLogs({answer:'Implemented shots.py; 12 tests pass.',stdout:'ok 1\nok 2'});assert.equal(clean.passed,true);assert.deepEqual(clean.findings,[]);
 const logged=selfCheckLogs({answer:'Done.',stderr:'Traceback (most recent call last):\n  x\nTraceback (most recent call last):\n  y'});assert.equal(logged.passed,true);assert.equal(logged.findings[0].kind,'traceback');assert.equal(logged.findings[0].count,2);
 assert.equal(selfCheckLogs({answer:'Added a TODO for the camera.'}).findings[0].kind,'placeholder');
});

test('Review must score; below 80 goes back to the branch with its notes',t=>{
 const f=setup(t);run(f,'build','b1');
 assert.throws(()=>checkpointStep(f.root,f.id,'build',{...pass(),score:undefined},f.read),/must score the result 0-100/);
 assert.throws(()=>checkpointStep(f.root,f.id,'build',pass(79),f.read),/below 80 cannot be accepted/);
 assert.throws(()=>checkpointStep(f.root,f.id,'build',pass(101),f.read),/integer 0-100/);
 checkpointStep(f.root,f.id,'build',{score:72,note:'Floating bishop at 0:40'},f.read);
 const p=readWorkflow(f.root,f.id).progress.build;assert.equal(p.checkpoint,null);assert.equal(p.lastRejection.score,72);
 const brief=workflowStep(f.root,f.id,'build',f.read).brief;assert.match(brief,/"reviewerNotes":"Floating bishop at 0:40","reviewScore":72/);
 run(f,'build','b2');checkpointStep(f.root,f.id,'build',pass(PASS_SCORE),f.read);
 assert.equal(workflowSummary(f.root,readWorkflow(f.root,f.id),f.read).steps[0].checkpoint.score,80);
});

test('blocking self-check findings must be addressed before acceptance',t=>{
 const f=setup(t);run(f,'build','b1',{selfCheck:selfCheckLogs({answer:'Could not run the tests.'})});
 assert.throws(()=>checkpointStep(f.root,f.id,'build',pass(),f.read),/self_check_addressed.*admitted_incomplete/s);
 checkpointStep(f.root,f.id,'build',pass(88,{self_check_addressed:'I ran the tests myself: 14 pass'}),f.read);
 assert.equal(readWorkflow(f.root,f.id).progress.build.checkpoint.selfCheckAddressed,'I ran the tests myself: 14 pass');
});

test('simulated review, Chief review and the user approval close the run in order',t=>{
 const f=setup(t);assert.equal(phase(f),'running');
 assert.throws(()=>simulatedReview(f.root,f.id,{score:90,note:'x',evidence:['ran']},f.read),/every step accepted first: build, polish/);
 acceptAll(f);assert.equal(phase(f),'awaiting_simulated_review');
 assert.throws(()=>finalReview(f.root,f.id,{chiefNote:'ok'},f.read),/passing simulated review/);
 assert.throws(()=>simulatedReview(f.root,f.id,{score:90,note:'Looks right'},f.read),/evidence of what was actually run/);
 simulatedReview(f.root,f.id,{score:90,note:'Ran the whole app end to end',evidence:['npm start, clicked through every screen']},f.read);assert.equal(phase(f),'awaiting_chief_review');
 assert.throws(()=>finalReview(f.root,f.id,{approvedByUser:'ship it'},f.read),/chief_note/);
 finalReview(f.root,f.id,{chiefNote:'Matches the prompt; two known limits listed'},f.read);assert.equal(phase(f),'awaiting_user_approval');
 const done=finalReview(f.root,f.id,{approvedByUser:'approved, ship it'},f.read);assert.equal(done.phase,'done');assert.equal(done.final.approvedByUser,'approved, ship it');
 assert.throws(()=>finalReview(f.root,f.id,{approvedByUser:'again'},f.read),/already approved/);
});

test('visual work needs real frames on disk to pass the simulated review',t=>{
 const f=setup(t,{steps:[{id:'build',task:'Build the page',category:'frontend',acceptance:['Works']},{id:'polish',task:'Polish',depends_on:['build'],acceptance:['Works']}]});acceptAll(f);
 assert.throws(()=>simulatedReview(f.root,f.id,{score:92,note:'Code looks right',evidence:['read the diff']},f.read),/real frames or screenshots/);
 assert.throws(()=>simulatedReview(f.root,f.id,{score:92,note:'x',evidence:['opened it'],visual_evidence:['shots/missing.png']},f.read),/not found: shots\/missing.png/);
 fs.mkdirSync(path.join(f.root,'shots'));fs.writeFileSync(path.join(f.root,'shots','home.png'),'png');
 simulatedReview(f.root,f.id,{score:92,note:'Viewed the page',evidence:['opened it in the browser'],visual_evidence:['shots/home.png']},f.read);assert.equal(phase(f),'awaiting_chief_review');
});

test('a failing simulated review reopens the named step and everything built on it',t=>{
 const f=setup(t);acceptAll(f);
 assert.throws(()=>simulatedReview(f.root,f.id,{score:60,note:'Camera inside a building',evidence:['rendered frame 120']},f.read),/send_back/);
 const s=simulatedReview(f.root,f.id,{score:60,note:'Camera inside a building',evidence:['rendered frame 120'],send_back:['build']},f.read);
 assert.deepEqual(s.simulatedReview.sentBack.sort(),['build','polish']);assert.equal(phase(f),'reworking_after_simulated_review');
 const p=readWorkflow(f.root,f.id).progress;assert.equal(p.build.checkpoint,null);assert.equal(p.build.checkpointHistory.length,1);assert.match(p.polish.lastRejection.note,/Reopened because build/);
 assert.match(workflowStep(f.root,f.id,'build',f.read).brief,/Simulated review: Camera inside a building/);
 assert.throws(()=>workflowStep(f.root,f.id,'polish',f.read),/accepted checkpoints/);
});

test('plans from before scoring existed can still be accepted without a score',t=>{
 const f=setup(t);const file=path.join(f.root,'workflows',f.id,'plan.json');const plan=JSON.parse(fs.readFileSync(file,'utf8'));delete plan.approval;fs.writeFileSync(file,JSON.stringify(plan));
 run(f,'build','b1');checkpointStep(f.root,f.id,'build',{...pass(),score:undefined},f.read);assert.ok(readWorkflow(f.root,f.id).progress.build.checkpoint);
});
