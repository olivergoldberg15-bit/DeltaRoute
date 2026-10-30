import {testTempRoot} from './test-fixtures.mjs';
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {install,mergeRoutingBlock,mergeHook,ROUTER_TOOLS} from './install-claude.mjs';
// Cloud and Linux support: no install, sign-in, network or provider call. The installer runs only in --dry-run.
const tmp=fs.mkdtempSync(path.join(testTempRoot,'deltaroute-cloud-'));
after(()=>fs.rmSync(tmp,{recursive:true,force:true}));

test('outside Windows a timed-out worker is stopped with its whole process group',async()=>{
 const runtime=path.join(tmp,'runtime');fs.mkdirSync(runtime);
 for(const file of fs.readdirSync(import.meta.dirname))if(file.endsWith('.mjs'))fs.copyFileSync(path.join(import.meta.dirname,file),path.join(runtime,file));
 fs.writeFileSync(path.join(runtime,'config.json'),JSON.stringify({maxConcurrent:1,timeoutSeconds:1,workers:{}}));
 const {killTree}=await import(pathToFileURL(path.join(runtime,'server.mjs')).href);
 const signals=[];const gone=Object.assign(Error('gone'),{code:'ESRCH'});
 assert.equal(killTree(42,{platform:'linux',kill:(p,s)=>{signals.push([p,s]);if(p===42)throw gone;},isAlive:()=>false}),true);
 assert.deepEqual(signals,[[-42,'SIGKILL'],[42,'SIGKILL']]);
 const ran=[];assert.equal(killTree(42,{platform:'win32',run:(c,a)=>{ran.push([c,...a]);return {status:0};},kill:()=>assert.fail('taskkill already stopped it')}),true);
 assert.deepEqual(ran,[['taskkill','/PID','42','/T','/F']]);
});

function fakeRoot(name,claude){
 const root=path.join(tmp,name);fs.mkdirSync(root);
 for(const f of ['ROUTING.md','repetitive-worker.md'])fs.copyFileSync(path.join(import.meta.dirname,f),path.join(root,f));
 fs.cpSync(path.join(import.meta.dirname,'deltaroute-skill'),path.join(root,'deltaroute-skill'),{recursive:true});
 fs.writeFileSync(claude,'');fs.writeFileSync(path.join(root,'config.json'),JSON.stringify({coordinators:{claude:{command:claude}}}));
 return root;
}
test('install-claude registers DeltaRoute like install.ps1, keeps other hooks and is safe to rerun',()=>{
 const home=path.join(tmp,'home'),claudeHome=path.join(home,'.claude');fs.mkdirSync(claudeHome,{recursive:true});
 const root=fakeRoot('router',path.join(tmp,'claude-bin'));
 fs.writeFileSync(path.join(claudeHome,'CLAUDE.md'),'# Mine\n');
 fs.writeFileSync(path.join(claudeHome,'settings.json'),JSON.stringify({hooks:{UserPromptSubmit:[{hooks:[{type:'command',command:'other-hook'}]}]},permissions:{allow:['Bash(ls)']}}));
 const calls=[];const run=(cmd,args)=>{calls.push([cmd,...args]);return {status:0};};
 const env={CLAUDE_CONFIG_DIR:claudeHome};
 install({root,node:'/usr/bin/node',env,home,allowRouterTools:true,run,stamp:'a'});
 assert.deepEqual(calls,[[path.join(tmp,'claude-bin'),'mcp','add','--scope','user','--transport','stdio','subscription-router','--','/usr/bin/node',path.join(root,'server.mjs')]]);
 const md=fs.readFileSync(path.join(claudeHome,'CLAUDE.md'),'utf8');assert.match(md,/^# Mine\n\n<!-- subscription-worker-router:start -->/);assert.doesNotMatch(md,/__DELTAROUTE_ROOT__|\{\{DELTAROUTE_/);
 const settings=JSON.parse(fs.readFileSync(path.join(claudeHome,'settings.json'),'utf8'));
 assert.deepEqual(settings.hooks.UserPromptSubmit.map(e=>e.hooks[0].command),['other-hook',`"/usr/bin/node" "${path.join(root,'prompt-hook.mjs')}"`]);
 assert.deepEqual(settings.permissions.allow,['Bash(ls)',...ROUTER_TOOLS]);
 const skill=fs.readFileSync(path.join(claudeHome,'skills/deltaroute/SKILL.md'),'utf8');assert.doesNotMatch(skill,/__DELTAROUTE_ROOT__|\{\{DELTAROUTE_/);
 assert.ok(fs.existsSync(path.join(claudeHome,'agents/repetitive-worker.md')));assert.ok(fs.existsSync(path.join(claudeHome,'CLAUDE.md.deltaroute-backup-a')));
 // Rerun once registered: no second registration, one block, one hook.
 fs.writeFileSync(path.join(claudeHome,'.claude.json'),JSON.stringify({mcpServers:{'subscription-router':{command:'/usr/bin/node',args:[path.join(root,'server.mjs')]}}}));
 install({root,node:'/usr/bin/node',env,home,run,stamp:'b'});assert.equal(calls.length,1);
 assert.equal(fs.readFileSync(path.join(claudeHome,'CLAUDE.md'),'utf8').split('subscription-worker-router:start').length,2);
 assert.equal(JSON.parse(fs.readFileSync(path.join(claudeHome,'settings.json'),'utf8')).hooks.UserPromptSubmit.length,2);
});
test('install-claude refuses to replace another checkout or a broken marker',()=>{
 const home=path.join(tmp,'home2'),claudeHome=path.join(home,'.claude');fs.mkdirSync(claudeHome,{recursive:true});
 const root=fakeRoot('router2',path.join(tmp,'claude-bin2'));const env={CLAUDE_CONFIG_DIR:claudeHome};
 fs.writeFileSync(path.join(claudeHome,'.claude.json'),JSON.stringify({mcpServers:{'subscription-router':{command:'/usr/bin/node',args:['/elsewhere/server.mjs']}}}));
 assert.throws(()=>install({root,node:'/usr/bin/node',env,home,run:()=>({status:0})}),/different subscription-router/);
 assert.equal(fs.existsSync(path.join(claudeHome,'CLAUDE.md')),false,'nothing written after a refusal');
 assert.throws(()=>mergeHook({hooks:{UserPromptSubmit:[{hooks:[{command:'node /other/prompt-hook.mjs'}]}]}},'node /mine/prompt-hook.mjs'),/different DeltaRoute prompt hook/);
 assert.throws(()=>mergeRoutingBlock('<!-- subscription-worker-router:start --> half','x'),/incomplete marker/);
});

// Git for Windows' bash, never the WSL launcher in System32 (it fails without a Linux install).
const bash=process.platform==='win32'?['C:/Program Files/Git/bin/bash.exe','C:/Program Files (x86)/Git/bin/bash.exe'].find(p=>fs.existsSync(p)):'bash';
const sh=args=>spawnSync(bash,args,{cwd:import.meta.dirname,encoding:'utf8',windowsHide:true,env:{...process.env,HOME:path.join(tmp,'shhome')}});
test('the cloud scripts parse and the installer dry run shows every step',{skip:!bash&&'no bash on this machine'},()=>{
 for(const f of ['cloud/install.sh','cloud/login.sh','cloud/remote.sh','cloud/serve-remote.sh','cloud/wake.sh']){const r=sh(['-n',f]);assert.equal(r.status,0,f+': '+r.stderr);}
 const plain=sh(['cloud/install.sh','--dry-run','--source','/tmp/deltaroute.bundle']);assert.equal(plain.status,0,plain.stderr);
 for(const want of ['npm install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli','checkout --quiet --detach a861c00cfac6e2376d26c7d3ba5207cdc5aefc49','./setup --quiet','git clone --branch main /tmp/deltaroute.bundle','node setup.mjs','install-claude.mjs --allow-router-tools','apt-get install -y git curl ca-certificates unzip tmux','/etc/systemd/system/deltaroute-remote.service','systemctl enable deltaroute-remote.service','/etc/systemd/system/deltaroute-mcp.service','systemctl enable --now deltaroute-mcp.service','npm test'])assert.ok(plain.stdout.includes(want),want);
 assert.doesNotMatch(plain.stdout,/wireguard/);
 const vpn=sh(['cloud/install.sh','--dry-run','--source','/tmp/b','--vpn','/tmp/proton.conf','--browser-session','/tmp/s.json']);assert.equal(vpn.status,0,vpn.stderr);
 for(const want of ['apt-get install -y wireguard-tools','/etc/wireguard/deltaroute.conf','table main priority 100','enable --now wg-quick@deltaroute','state/browser/session-state.json'])assert.ok(vpn.stdout.includes(want),want);
 assert.equal(sh(['cloud/install.sh','--bogus']).status,2);
 // A server first filled by a plain file copy becomes a git copy and keeps its config, sign-ins and jobs.
 const old=path.join(tmp,'shhome','Copied');fs.mkdirSync(path.join(old,'state'),{recursive:true});fs.writeFileSync(path.join(old,'config.json'),'{}');
 const convert=sh(['cloud/install.sh','--dry-run','--source','/tmp/b','--dir',old.split(path.sep).join('/')]);assert.equal(convert.status,0,convert.stderr);
 assert.match(convert.stdout,/\+ mv \S*Copied \S*Copied\.before-\d{14}/);assert.match(convert.stdout,/\+ cp -a \S*config\.json/);assert.match(convert.stdout,/\+ cp -a \S*state/);
});
