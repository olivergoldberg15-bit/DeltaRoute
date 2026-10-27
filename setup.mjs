import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const exists=file=>!!file&&fs.existsSync(file)&&fs.statSync(file).isFile();

/** Native executables or Unix shebang entry points only; never execute cmd/ps1 shims. */
export function findProgram(names,{env=process.env,platform=process.platform}={}) {
  const dirs=String(env.PATH||env.Path||'').split(platform==='win32'?';':path.delimiter).filter(Boolean);
  for(const name of names) {
    if(!name)continue;
    if(path.isAbsolute(name)&&exists(name)&&!(/\.(?:cmd|bat|ps1)$/i.test(name))&&(platform!=='win32'||/\.exe$/i.test(name)))return path.resolve(name);
    for(const dir of dirs)for(const suffix of platform==='win32'?['.exe']:['']) {
      const candidate=path.join(dir,name.endsWith('.exe')?name:name+suffix);
      if(exists(candidate)&&!(/\.(?:cmd|bat|ps1)$/i.test(candidate)))return path.resolve(candidate);
    }
  }
  return '';
}
function firstFile(files){return files.find(exists)||'';}
function packageScript(name,bases) {
  for(const base of bases) {
    const dir=path.join(base,...name.split('/')),manifest=path.join(dir,'package.json');
    if(!exists(manifest))continue;
    try{const pkg=JSON.parse(fs.readFileSync(manifest,'utf8')),bin=typeof pkg.bin==='string'?pkg.bin:Object.values(pkg.bin||{})[0];
      if(bin){const script=path.resolve(dir,bin);if(exists(script))return script;}}catch{}
  }
  return '';
}
export function findContextMode({home=os.homedir(),root=ROOT}={}) {
  const direct=firstFile([path.join(root,'node_modules/context-mode/start.mjs'),path.join(root,'node_modules/@mksglu/context-mode/start.mjs')]);
  if(direct)return direct;
  const cache=path.join(home,'.claude/plugins/cache');const candidates=[];
  // Installed marketplace/cache versions vary; inspect only the named package,
  // not arbitrary user directories, and never install or invoke it here.
  try{for(const publisher of fs.readdirSync(cache)){const dir=path.join(cache,publisher,'context-mode');
    if(!fs.existsSync(dir))continue;for(const version of fs.readdirSync(dir)){const start=path.join(dir,version,'start.mjs');if(exists(start))candidates.push(start);}}}catch{}
  candidates.sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));return candidates[0]||'';
}
export function discover({root=ROOT,home=os.homedir(),env=process.env,platform=process.platform}={}) {
  const paths=String(env.PATH||env.Path||'').split(platform==='win32'?';':path.delimiter).filter(Boolean);
  const npmBases=[path.join(root,'node_modules'),...(env.APPDATA?[path.join(env.APPDATA,'npm/node_modules')]:[]),
    path.join(home,'.npm-global/lib/node_modules'),'/usr/local/lib/node_modules','/opt/homebrew/lib/node_modules',
    ...paths.map(dir=>path.resolve(dir,'../lib/node_modules'))];
  const codexTriples=platform==='win32'?[process.arch==='arm64'?'aarch64-pc-windows-msvc':'x86_64-pc-windows-msvc']:[];
  const codexPackages=process.arch==='arm64'?['codex-win32-arm64','codex-win32-x64']:['codex-win32-x64','codex-win32-arm64'];
  const codex=findProgram([env.DELTAROUTE_CODEX_COMMAND||'', 'codex'],{env,platform})||firstFile(platform==='win32'?npmBases.flatMap(base=>
    [path.join(base,'@openai/codex'),...codexPackages.flatMap(pkg=>[path.join(base,'@openai',pkg),path.join(base,'@openai/codex/node_modules/@openai',pkg)])]
      .flatMap(pkg=>codexTriples.flatMap(triple=>[path.join(pkg,'vendor',triple,'bin/codex.exe'),path.join(pkg,'vendor',triple,'codex/codex.exe')]))):[]);
  const claude=findProgram([env.DELTAROUTE_CLAUDE_COMMAND||'','claude'],{env,platform})||firstFile(
    [...npmBases.map(base=>path.join(base,'@anthropic-ai/claude-code/bin/claude.exe')),path.join(home,'.local/bin/claude.exe')]);
  const agy=findProgram(['agy'],{env,platform});
  const gemini=findProgram(['gemini'],{env,platform});
  const geminiScript=gemini?'':packageScript('@google/gemini-cli',npmBases);
  const cursor=findProgram(['cursor-agent','agent'],{env,platform});
  // The npm package wraps a native binary; call it directly when it is there.
  const higgsfield=findProgram([env.DELTAROUTE_HIGGSFIELD_COMMAND||'','higgsfield'],{env,platform})||firstFile(npmBases.map(base=>path.join(base,'@higgsfield/cli/vendor',platform==='win32'?'hf.exe':'hf')));
  const higgsfieldScript=higgsfield?'':packageScript('@higgsfield/cli',npmBases);
  // An unqualified agent program could belong to another product. Only a
  // cursor-branded path is accepted without an explicit user configuration.
  const cursorVerified=cursor&&(/cursor/i.test(cursor)||path.basename(cursor).startsWith('cursor-agent'))?cursor:'';
  const browser=firstFile([env.DELTAROUTE_BROWSER_COMMAND,...['.agents/skills','.claude/skills'].flatMap(base=>[
    path.join(home,base,'gstack/browse/dist/browse.exe'),path.join(home,base,'gstack/browse/dist/browse')])]);
  const watchScript=firstFile([path.join(root,'skill-library/media/watch/scripts/watch.py'),path.join(home,'.codex/skills/watch/scripts/watch.py'),path.join(home,'.agents/skills/watch/scripts/watch.py')]);
  const browsersPath=[env.PLAYWRIGHT_BROWSERS_PATH,env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'ms-playwright'),
    path.join(home,'AppData/Local/ms-playwright'),path.join(home,'.cache/ms-playwright'),path.join(home,'Library/Caches/ms-playwright')].find(value=>value&&fs.existsSync(value))||'';
  return {codex,claude,agy,gemini,geminiScript,cursor:cursorVerified,higgsfield,higgsfieldScript,browser,browsersPath,watchScript,
    python:findProgram(['python3','python'],{env,platform}),ytDlp:findProgram(['yt-dlp'],{env,platform}),ffmpeg:findProgram(['ffmpeg'],{env,platform}),contextStart:findContextMode({home,root})};
}
export function buildConfig(found,{root=ROOT,template=JSON.parse(fs.readFileSync(path.join(ROOT,'config.example.json'),'utf8'))}={}) {
  const config=structuredClone(template),workers=config.workers;
  config.browser={command:found.browser||'',stateFile:path.join(root,'state/browser/browse.json'),browsersPath:found.browsersPath||''};
  workers.codex.command=found.codex||'';workers.codex.enabled=!!found.codex;
  workers.codex.reason=found.codex?'Installed CLI detected; authenticate with codex login before delegation.':'Install the official Codex CLI separately, then rerun setup --force.';
  workers.gemini.command=found.agy||found.gemini||(found.geminiScript?process.execPath:'');
  workers.gemini.enabled=!!workers.gemini.command;
  if(found.agy)workers.gemini.transport='antigravity';else if(found.geminiScript)workers.gemini.script=found.geminiScript;
  workers.gemini.reason='CLI discovery does not verify account login, subscription entitlement, model availability or quota.';
  workers.cursor.command=found.cursor||'';workers.cursor.enabled=!!found.cursor;
  workers.cursor.reason=found.cursor?'Installed Cursor CLI detected; authenticate separately.':'No supported native Cursor Agent executable found. Install it separately or configure its Node entry point explicitly.';
  // Grok runs on the user's own grok.com subscription through the research browser; Cursor is only the fallback transport.
  if(found.browser){workers.grok.transport='browser';workers.grok.command='';workers.grok.enabled=true;workers.grok.reason='gstack detected; sign into your grok.com account with research-login.ps1 grok before use. Native live X access is not verified.';}
  else{workers.grok.command=found.cursor||'';workers.grok.enabled=false;}
  // Higgsfield spends account credits, so setup finds it but never turns it on by itself.
  if(workers.higgsfield){workers.higgsfield.command=found.higgsfield||(found.higgsfieldScript?process.execPath:'');workers.higgsfield.enabled=false;
   if(found.higgsfieldScript)workers.higgsfield.script=found.higgsfieldScript;
   workers.higgsfield.reason=workers.higgsfield.command?'Higgsfield CLI detected. Image jobs spend account credits (priced and capped first); set enabled to true to use Nano Banana Pro.':'Install the Higgsfield CLI and run higgsfield auth login to use Nano Banana Pro for image jobs.';}
  workers.perplexity.enabled=!!found.browser;
  workers.perplexity.reason=found.browser?'gstack detected; sign into your existing account with research-login.ps1 before use.':'Install gstack separately for browser research; no paid research API fallback is configured.';
  config.coordinators={claude:{command:found.claude||''},codex:{command:found.codex||''}};
  config.watch={python:found.python||'',ytDlp:found.ytDlp||'',script:found.watchScript||'',noPaidAPIs:true};
  return config;
}
export function writeConfig(root,config,{force=false}={}) {
  const target=path.join(root,'config.json');if(fs.existsSync(target)&&!force)return {written:false,path:target};
  fs.mkdirSync(path.join(root,'state/browser'),{recursive:true});
  if(fs.existsSync(target))fs.copyFileSync(target,target+'.backup-'+Date.now());
  fs.writeFileSync(target,JSON.stringify(config,null,2)+'\n',{mode:0o600});return {written:true,path:target};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(Number(process.versions.node.split('.')[0])<22)throw Error('DeltaRoute requires Node.js 22 or newer.');
  const args=process.argv.slice(2);if(args.some(arg=>!['--force','--discover','--help'].includes(arg)))throw Error('Unknown option. Use node setup.mjs --help.');
  if(args.includes('--help'))console.log('node setup.mjs [--force]  Discover installed CLIs and create local config.json. Existing config is preserved unless --force (with backup).\nnode setup.mjs --discover  Print detected paths only. No provider/model calls, downloads, account login or global changes.\nOptional dependencies: official provider CLIs, Python 3.11+, gstack, local watch, yt-dlp and FFmpeg. Install them separately.');
  else {const found=discover();if(args.includes('--discover'))console.log(JSON.stringify(found));else {const result=writeConfig(ROOT,buildConfig(found),{force:args.includes('--force')});
    console.log(result.written?'Created local config.json from installed CLI paths.':'Preserved existing config.json; --force rediscovers paths and saves a backup.');
    console.log('Detected: '+Object.entries(found).filter(([,value])=>value).map(([key])=>key).join(', '));
    console.log('No account has been authenticated or tested. Missing providers are disabled. Grok requires an explicit supported Cursor model selection.');}}
}
