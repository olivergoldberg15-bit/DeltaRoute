import {testTempRoot} from './test-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {loadRegistry,assignRole,assignRoles,registryAge,createProposal,applyProposal,recordLiveModels,parseAgyModels} from './registry.mjs';

function root(t){const dir=fs.mkdtempSync(path.join(testTempRoot,'deltaroute-registry-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.copyFileSync(path.join(import.meta.dirname,'models.json'),path.join(dir,'models.json'));return dir;}
const workers=[{name:'codex',enabled:true,installed:true,availableNow:true},{name:'gemini',enabled:true,installed:true,availableNow:true},{name:'perplexity',enabled:true,installed:true,availableNow:true}];

test('shipped registry is valid and Claude currently wins the top roles',t=>{
 const r=loadRegistry(root(t));const roles=assignRoles(r,{coordinator:'claude',workers});
 assert.equal(roles.chief.pick.id,'claude-opus-5-5');assert.equal(roles.chief.pick.execution,'host');
 assert.equal(roles.op.pick.id,'claude-opus-5-5');assert.equal(roles.review.pick.id,'claude-opus-5-5');
});

test('chief is always the host, even when another model scores higher',t=>{
 const r=loadRegistry(root(t));r.models.find(m=>m.id==='codex-default').scores={...r.models.find(m=>m.id==='codex-default').scores,planning:100,review:100,coding:100,large_context:100};
 assert.equal(assignRole(r,'chief',{coordinator:'claude',workers}).pick.id,'claude-opus-5-5');
 assert.equal(assignRole(r,'op',{coordinator:'claude',workers}).pick.id,'codex-default');
});

test('Gemini 4 Argon is agent tier only and never leads a route',t=>{
 const r=loadRegistry(root(t));
 for(const role of ['op','route_lead','review','simulated_review'])assert.notEqual(assignRole(r,role,{coordinator:'claude',workers}).pick?.provider,'gemini');
 const agent=assignRole(r,'agent',{category:'large_context',coordinator:'claude',workers});assert.equal(agent.pick.id,'gemini-4-argon-high');
});

test('agents are never the host, research-only workers only take research',t=>{
 const r=loadRegistry(root(t));
 assert.notEqual(assignRole(r,'agent',{category:'implementation',coordinator:'claude',workers}).pick.execution,'host');
 assert.notEqual(assignRole(r,'agent',{category:'implementation',coordinator:'claude',workers}).pick.provider,'perplexity');
 assert.equal(assignRole(r,'agent',{category:'research',coordinator:'claude',workers}).pick.provider,'perplexity');
});

test('sub-agents come from the cheap tier and respect availability',t=>{
 const r=loadRegistry(root(t));
 assert.equal(assignRole(r,'sub_agent',{coordinator:'claude',workers}).pick.id,'gemini-3.8-flash-low');
 const noGemini=workers.filter(w=>w.name!=='gemini');assert.equal(assignRole(r,'sub_agent',{coordinator:'claude',workers:noGemini}).pick.id,'claude-haiku-native');
 assert.equal(assignRole(r,'sub_agent',{coordinator:'codex',workers:noGemini}).pick,null);
});

test('a model missing from the live CLI list is not assigned',t=>{
 const dir=root(t);recordLiveModels(dir,{gemini:{models:['gemini-3.8-flash-low']}});
 assert.notEqual(assignRole(loadRegistry(dir),'agent',{category:'large_context',coordinator:'claude',workers}).pick.id,'gemini-4-argon-high');
});

test('news cannot change scores without a citation and the user\'s approval',t=>{
 const dir=root(t);
 assert.throws(()=>createProposal(dir,{changes:[{id:'codex-default',set:{scores:{coding:95}}}]}),/source_url and source_date/);
 const p=createProposal(dir,{changes:[{id:'codex-default',set:{scores:{coding:95}},source_url:'https://example.com/post',source_date:'2026-10-10'}]});
 assert.equal(loadRegistry(dir).models.find(m=>m.id==='codex-default').scores.coding,90);
 assert.throws(()=>applyProposal(dir,p.id,{}),/approved_by_user/);
 applyProposal(dir,p.id,{approvedByUser:'yes apply it'});
 const codex=loadRegistry(dir).models.find(m=>m.id==='codex-default');assert.equal(codex.scores.coding,95);assert.match(codex.source,/example\.com/);
 assert.throws(()=>applyProposal(dir,p.id,{approvedByUser:'again'}),/already applied/);
});

test('refresh turns unknown live models into proposal items, and additions must be scored',t=>{
 const dir=root(t);const p=createProposal(dir,{live:{gemini:{models:['gemini-4-argon-high','gemini-4-argon-medium','gemini-3.8-flash-low','gpt-oss-120b-medium']}}});
 assert.deepEqual(p.items.map(i=>i.model),['gpt-oss-120b-medium']);
 assert.throws(()=>applyProposal(dir,p.id,{approvedByUser:'ok',additions:[{id:'other',provider:'gemini',model:'not-listed',tier:'mid',scores:{}}]}),/new_model items/);
 const scores=Object.fromEntries(['planning','coding','review','research','visual','large_context','speed','cost_efficiency'].map(c=>[c,50]));
 applyProposal(dir,p.id,{approvedByUser:'ok add it',additions:[{id:'gpt-oss-120b-medium',provider:'gemini',model:'gpt-oss-120b-medium',label:'GPT-OSS 120B',tier:'mid',scores,source:'agy models'}]});
 assert.ok(loadRegistry(dir).models.some(m=>m.id==='gpt-oss-120b-medium'));
});

test('registry goes stale after 14 days and a no-change refresh freshens it',t=>{
 const dir=root(t);const r=loadRegistry(dir);
 assert.equal(registryAge(r,Date.parse(r.updatedAt)+20*86_400_000).stale,true);
 assert.equal(registryAge(r,Date.parse(r.updatedAt)+3*86_400_000).stale,false);
 recordLiveModels(dir,{gemini:{models:[]}},{nothingToApprove:true});assert.equal(loadRegistry(dir).updatedAt,new Date().toISOString().slice(0,10));
});

test('agy model list parsing keeps only model ids',()=>{
 assert.deepEqual(parseAgyModels('Fetching available models...\ngemini-4-argon-high\tGemini 4 Argon (High)\r\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n'),['gemini-4-argon-high','gemini-3.8-flash-low']);
});
