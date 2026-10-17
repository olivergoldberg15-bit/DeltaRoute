// A local, deterministic hook: no provider requests and no prompt logging.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {selectSpecialists} from './specialists.mjs';
import {selectOptimizationSkills} from './skill-routing.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
let input='';for await(const chunk of process.stdin)input+=chunk;
try{
 const request=JSON.parse(input||'{}');
 if(process.env.MODEL_ROUTER_WORKER!=='1'){
  const policy='Apply DeltaRoute (Δ) global routing policy to this prompt. Claude: planning/review/creative control. Codex: feedback/coding/subagents. Gemini: quick iteration. Perplexity: research via gstack. Grok: source-packet analysis through Cursor. Cursor: integration. Haiku: repetitive work. Keep tiny self-contained tasks in Claude unless independent review is requested. Delegate bounded work, collect compact results; no paid API fallback or permission bypass. Provider failures: broker tries eligible subscription fallbacks. On needs_coordinator continue the saved assignment in this Claude conversation without resubmitting exhausted workers. All browsing: gstack.';
  const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));
  const status=Object.entries(cfg.workers).filter(([,w])=>w.enabled).map(([n])=>n).join(', ');
  const hints=selectOptimizationSkills(request.prompt||'');if(/heavy|long.{0,15}(cod|task)|multi.?(step|agent)|animat|large.{0,15}video/i.test(request.prompt||''))hints.push({name:'heavy-workflows',action:'Read '+path.join(root,'deltaroute-skill/references/heavy-workflows.md')+'; save original scope and dependency/evidence checkpoints.'});for(const s of selectSpecialists(request.prompt||'',{limit:2}))hints.push({name:s.id,action:'Read only if needed: '+s.path});
  console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:policy+' Enabled: '+status+'.'+(hints.length?'\nRelevant skill guidance (load full instructions only when needed):\n'+hints.map(s=>s.name+': '+s.action).join('\n'):'')}}));
 }
}catch(e){console.error(`subscription-router hook: ${e.message}`);process.exitCode=1;}
