import test from 'node:test';
import {testTempRoot} from './test-fixtures.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {findProgram,findContextMode,discover,buildConfig,writeConfig} from './setup.mjs';

function temporary(t){const dir=fs.mkdtempSync(path.join(testTempRoot,'deltaroute-setup-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function file(name,content='fixture'){fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,content);return name;}

test('fresh configuration disables missing providers and writes no machine paths to the template',t=>{
  const root=temporary(t),config=buildConfig({},{root});
  for(const worker of Object.values(config.workers))assert.equal(worker.enabled,false);
  assert.equal(config.coordinators.claude.command,'');assert.equal(config.workers.grok.enabled,false);
  const result=writeConfig(root,config);assert.equal(result.written,true);assert.ok(fs.existsSync(path.join(root,'state/browser')));
  const template=JSON.parse(fs.readFileSync(new URL('./config.example.json',import.meta.url),'utf8'));
  assert.equal(template.workers.codex.command,'');assert.equal(template.watch.python,'');
});

test('setup preserves custom config unless force explicitly requests a backed-up refresh',t=>{
  const root=temporary(t);file(path.join(root,'config.json'),'{"custom":"keep"}\n');
  assert.equal(writeConfig(root,{workers:{} }).written,false);assert.match(fs.readFileSync(path.join(root,'config.json'),'utf8'),/keep/);
  assert.equal(writeConfig(root,{workers:{}},{force:true}).written,true);
  const backups=fs.readdirSync(root).filter(name=>name.startsWith('config.json.backup-'));assert.equal(backups.length,1);
  assert.match(fs.readFileSync(path.join(root,backups[0]),'utf8'),/keep/);
});

test('Windows discovery ignores shell shims and selects an existing native executable',t=>{
  const root=temporary(t);file(path.join(root,'codex.cmd'));file(path.join(root,'codex.ps1'));
  assert.equal(findProgram(['codex'],{env:{PATH:root},platform:'win32'}),'');
  const executable=file(path.join(root,'codex.exe'));assert.equal(findProgram(['codex'],{env:{PATH:root},platform:'win32'}),executable);
});

test('Node-backed Gemini packages discover their declared entry point without running it',t=>{
  const root=temporary(t),modules=path.join(root,'node_modules/@google/gemini-cli');
  file(path.join(modules,'package.json'),JSON.stringify({bin:{gemini:'dist/cli.js'}}));const script=file(path.join(modules,'dist/cli.js'));
  const found=discover({root,home:root,env:{PATH:''}}),config=buildConfig(found,{root});
  assert.equal(found.geminiScript,script);assert.equal(config.workers.gemini.command,process.execPath);
  assert.equal(config.workers.gemini.script,script);assert.equal(config.workers.gemini.enabled,true);
});

test('npm Codex on Windows resolves its native optional dependency instead of a cmd shim',t=>{
  const root=temporary(t),bin=path.join(root,'bin');file(path.join(bin,'codex.cmd'));
  const triple=process.arch==='arm64'?'aarch64-pc-windows-msvc':'x86_64-pc-windows-msvc';
  const pkg=process.arch==='arm64'?'codex-win32-arm64':'codex-win32-x64';
  const native=file(path.join(root,'node_modules/@openai/codex/node_modules/@openai',pkg,'vendor',triple,'bin/codex.exe'));
  assert.equal(discover({root,home:root,env:{PATH:bin},platform:'win32'}).codex,native);
});

test('context-mode discovery selects installed versions without a pinned version or download',t=>{
  const root=temporary(t),home=path.join(root,'home');
  file(path.join(home,'.claude/plugins/cache/context-mode/context-mode/1.0.9/start.mjs'));
  const recent=file(path.join(home,'.claude/plugins/cache/context-mode/context-mode/1.0.100/start.mjs'));
  assert.equal(findContextMode({home,root}),recent);
});

const python=findProgram(['python3','python']);
const pythonReady=python&&spawnSync(python,['-c','import tomllib'],{stdio:'ignore',windowsHide:true}).status===0;
function helper(configPath,...args){return spawnSync(python,[fileURLToPath(new URL('./install-codex-config.py',import.meta.url)),process.execPath,'--config-path',configPath,...args],{encoding:'utf8',windowsHide:true});}
const quote=value=>JSON.stringify(value.replaceAll('\\','/'));
const serverScript=fileURLToPath(new URL('./server.mjs',import.meta.url));
function registration(extra=''){return '[mcp_servers.deltaroute]\ncommand = '+quote(process.execPath)+'\nargs = ['+quote(serverScript)+']\n'+extra;}

test('Codex guard accepts a missing initial config without creating it',{skip:!pythonReady},t=>{
  const cfg=path.join(temporary(t),'new/config.toml'),result=helper(cfg,'--check');assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).deltaroute,false);assert.equal(fs.existsSync(cfg),false);
});

test('Codex installer preserves server deny, disabled tools and unrelated TOML',{skip:!pythonReady},t=>{
  const root=temporary(t),cfg=file(path.join(root,'config.toml'),'model = "custom"\n'+registration('default_tools_approval_mode = "deny"\ndisabled_tools = ["submit_task"]\n')+'\n[mcp_servers.unrelated]\ncommand = "leave-alone"\n');
  const result=helper(cfg,'--managed-heads');assert.equal(result.status,0,result.stderr);
  const text=fs.readFileSync(cfg,'utf8');assert.match(text,/model = "custom"/);assert.match(text,/leave-alone/);
  assert.match(text,/default_tools_approval_mode = "deny"/);assert.doesNotMatch(text,/approval_mode = "approve"/);
});

test('Codex tool scope narrows while existing per-tool denies remain intact',{skip:!pythonReady},t=>{
  const cfg=file(path.join(temporary(t),'config.toml'),registration('enabled_tools = ["list_workers", "submit_task", "forbidden_extra"]\n')+'\n[mcp_servers.deltaroute.tools.submit_task]\napproval_mode = "deny"\n');
  const result=helper(cfg,'--managed-heads');assert.equal(result.status,0,result.stderr);
  const text=fs.readFileSync(cfg,'utf8');assert.doesNotMatch(text,/forbidden_extra/);assert.match(text,/approval_mode = "deny"/);
  assert.doesNotMatch(text,/tools\.recommend_route/);assert.doesNotMatch(text,/tools\.cancel_task/);
});

test('Codex refuses to replace a differently registered server and preserves original bytes',{skip:!pythonReady},t=>{
  const cfg=file(path.join(temporary(t),'config.toml'),'[mcp_servers.deltaroute]\ncommand = "other"\nargs = ["other.mjs"]\n');
  const before=fs.readFileSync(cfg),result=helper(cfg);assert.notEqual(result.status,0);assert.deepEqual(fs.readFileSync(cfg),before);
});

test('Grok uses the user\'s own grok.com account through the research browser when gstack exists',t=>{
  const root=temporary(t),browser=file(path.join(root,'browse.exe'));
  const config=buildConfig({browser},{root});
  assert.equal(config.workers.grok.transport,'browser');assert.equal(config.workers.grok.enabled,true);assert.equal(config.workers.grok.command,'');
});
