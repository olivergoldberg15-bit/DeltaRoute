// Cross-platform twin of install.ps1 for Linux and macOS (and cloud servers): writes the DeltaRoute block into
// CLAUDE.md, registers the subscription-router MCP server, adds the prompt hook, installs the deltaroute skill and the
// repetitive-worker agent. Same refusals as install.ps1: another checkout's server or hook is never replaced silently,
// and every file it changes gets a timestamped backup first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const BEGIN='<!-- subscription-worker-router:start -->',END='<!-- subscription-worker-router:end -->';
export const ROUTER_TOOLS=['list_workers','recommend_route','submit_task','get_task','cancel_task','model_registry'].map(t=>'mcp__subscription-router__'+t);
const render=(text,root,skillPath)=>text.split('__DELTAROUTE_ROOT__').join(root).split('{{DELTAROUTE_ROOT}}').join(root).split('{{DELTAROUTE_SKILL_PATH}}').join(skillPath);
const readJSON=file=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
export function mergeRoutingBlock(existing,block){
 if(existing.includes(BEGIN)){if(!existing.includes(END))throw Error('Existing router instructions have an incomplete marker; preserving them.');return existing.replace(new RegExp(BEGIN+'[\\s\\S]*?'+END),()=>block.trimEnd());}
 return (existing.trimEnd()?existing.trimEnd()+'\n\n':'')+block;
}
export function mergeHook(settings,hookCommand){
 const entries=(settings.hooks?.UserPromptSubmit||[]).filter(Boolean);
 if(entries.flatMap(e=>e.hooks||[]).some(h=>/prompt-hook\.mjs/.test(h.command||'')&&h.command!==hookCommand))throw Error('A different DeltaRoute prompt hook is installed; migrate it explicitly before replacing it.');
 // Replace only this checkout's hook; another installation is the owner's to remove.
 const prior=entries.map(e=>({...e,hooks:(e.hooks||[]).filter(h=>h.command!==hookCommand)})).filter(e=>e.hooks.length);
 return {...settings,hooks:{...settings.hooks,UserPromptSubmit:[...prior,{hooks:[{type:'command',command:hookCommand,timeout:5}]}]}};
}
export function install({root=ROOT,node=process.execPath,env=process.env,home=os.homedir(),allowRouterTools=false,run=spawnSync,stamp=new Date().toISOString().replace(/[:.]/g,'-')}={}){
 const configPath=path.join(root,'config.json');
 if(!fs.existsSync(configPath)){const r=run(node,[path.join(root,'setup.mjs')],{stdio:'inherit'});if(r.status!==0)throw Error('Run node setup.mjs first.');}
 const claudeCommand=readJSON(configPath).coordinators?.claude?.command;
 if(!claudeCommand||!fs.existsSync(claudeCommand))throw Error('Install the official Claude Code CLI, then rerun node setup.mjs --force or configure coordinators.claude.command.');
 const claudeHome=env.CLAUDE_CONFIG_DIR||path.join(home,'.claude'),claudePath=path.join(claudeHome,'CLAUDE.md'),skillPath=path.join(claudeHome,'skills/deltaroute/SKILL.md');
 const slash=p=>p.split(path.sep).join('/');
 const updated=mergeRoutingBlock(fs.existsSync(claudePath)?fs.readFileSync(claudePath,'utf8'):'',render(fs.readFileSync(path.join(root,'ROUTING.md'),'utf8'),slash(root),slash(skillPath)));
 const userConfigPath=env.CLAUDE_CONFIG_DIR?path.join(claudeHome,'.claude.json'):path.join(home,'.claude.json'),settingsPath=path.join(claudeHome,'settings.json');
 const hookCommand=`"${node}" "${path.join(root,'prompt-hook.mjs')}"`,server=path.join(root,'server.mjs');
 let settings=mergeHook(readJSON(settingsPath),hookCommand);
 const registered=readJSON(userConfigPath).mcpServers?.['subscription-router'];
 if(registered){if(registered.command!==node||registered.args?.[0]!==server)throw Error('A different subscription-router server is registered. Remove or migrate it explicitly before installing this checkout.');}
 else{const r=run(claudeCommand,['mcp','add','--scope','user','--transport','stdio','subscription-router','--',node,server],{stdio:'inherit',env});if(r.status!==0)throw Error('MCP registration failed. Existing global instructions were not modified.');}
 const backup=file=>{if(fs.existsSync(file))fs.copyFileSync(file,`${file}.deltaroute-backup-${stamp}`);};
 fs.mkdirSync(claudeHome,{recursive:true});
 backup(claudePath);fs.writeFileSync(claudePath,updated);
 if(allowRouterTools)settings={...settings,permissions:{...settings.permissions,allow:[...new Set([...(settings.permissions?.allow||[]).filter(Boolean),...ROUTER_TOOLS])]}};
 backup(settingsPath);fs.writeFileSync(settingsPath,JSON.stringify(settings,null,2));
 const agentPath=path.join(claudeHome,'agents/repetitive-worker.md');fs.mkdirSync(path.dirname(agentPath),{recursive:true});backup(agentPath);fs.copyFileSync(path.join(root,'repetitive-worker.md'),agentPath);
 const dest=path.dirname(skillPath);fs.mkdirSync(dest,{recursive:true});backup(skillPath);
 fs.cpSync(path.join(root,'deltaroute-skill'),dest,{recursive:true,force:true});
 for(const file of fs.readdirSync(dest,{recursive:true}).map(f=>path.join(dest,f)).filter(f=>f.endsWith('.md')&&!/\.backup-|deltaroute-backup-/.test(f)))fs.writeFileSync(file,render(fs.readFileSync(file,'utf8'),slash(root),slash(skillPath)));
 return {claudePath,settingsPath,skillPath,mcpRegistered:!registered};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.some(a=>!['--allow-router-tools','--help'].includes(a)))throw Error('Unknown option. Use node install-claude.mjs --help.');
 if(args.includes('--help'))console.log('node install-claude.mjs [--allow-router-tools]  Register DeltaRoute with Claude Code on Linux, macOS or a cloud server (install.ps1 does this on Windows).');
 else{install({allowRouterTools:args.includes('--allow-router-tools')});console.log('DeltaRoute installed for Claude Code with a routing hook and native skill. Restart Claude Code. Existing deny rules remain in force.');}
}
