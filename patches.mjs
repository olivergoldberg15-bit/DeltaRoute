// Commit-free integration. A worker's change leaves its worktree as one binary patch, made by DeltaRoute
// outside the worker's sandbox (Codex's sandbox cannot write Git metadata), and the scope audit reads only
// that patch, so other steps' and the coordinator's own changes never count against it.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {isRuntimePath} from './deadline.mjs';

// DeltaRoute's coordination files (board, outbox, renders, signals) and gstack's runtime folder.
const EXCLUDE = [':(exclude).deltaroute', ':(exclude).gstack'];

function git(cwd, args, {env = process.env, trim = true} = {}) {
  const r = spawnSync('git', args, {cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 512 * 1024 * 1024});
  if (r.status !== 0) throw Error((r.stderr || r.error?.message || 'Git command failed').trim());
  return trim ? r.stdout.trim() : r.stdout;
}

/**
 * Writes everything changed in worktree since baseRef (untracked files included) to file.
 * A throwaway index keeps the worktree's own index untouched. Returns {file, paths, bytes}.
 */
export function exportPatch(worktree, baseRef, file) {
  const index = path.resolve(file + '.index');
  const env = {...process.env, GIT_INDEX_FILE: index};
  fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true});
  try {
    git(worktree, ['read-tree', baseRef], {env});
    git(worktree, ['add', '-A', '--', '.', ...EXCLUDE], {env});
    const patch = git(worktree, ['diff', '--cached', '--binary', '--no-renames', '--full-index', baseRef, '--'], {env, trim: false});
    const paths = git(worktree, ['diff', '--cached', '--no-renames', '--name-only', '-z', baseRef, '--'], {env}).split('\0').filter(p => p && !isRuntimePath(p));
    fs.writeFileSync(file, patch);
    return {file: path.resolve(file), paths, bytes: Buffer.byteLength(patch)};
  } finally {
    fs.rmSync(index, {force: true});
  }
}

/** File paths a saved patch touches, read from its diff headers. */
export function patchPaths(patchText) {
  const found = new Set();
  const decode=s=>s.startsWith('"')?Buffer.from(s.slice(1,-1).replace(/\\([0-7]{3}|[abtnvfr"\\])/g,(_,c)=>c.length===3?String.fromCharCode(parseInt(c,8)):({a:'\x07',b:'\b',t:'\t',n:'\n',v:'\v',f:'\f',r:'\r','"':'"','\\':'\\'}[c])), 'latin1').toString('utf8'):s;
  for (const m of String(patchText).matchAll(/^diff --git ("a\/(?:\\.|[^"\\])*"|a\/.+?) ("b\/(?:\\.|[^"\\])*"|b\/.+)$/gm)) { found.add(decode(m[1]).slice(2)); found.add(decode(m[2]).slice(2)); }
  return [...found].filter(p => !isRuntimePath(p));
}

/**
 * Applies a saved patch to the working tree of cwd (nothing is committed). Falls back to a three-way
 * apply when the plain one does not fit. Returns {applied, method, paths} or throws with Git's reason.
 */
export function applyPatch(cwd, file) {
  cwd=path.resolve(cwd);file=path.resolve(file);
  const text = fs.readFileSync(file, 'utf8');
  const paths = patchPaths(text);
  if (!text.trim()) return {applied: false, method: null, paths, note: 'The patch is empty; there is nothing to apply.'};
  // Keep Git's real index untouched until a successful three-way apply. Hold its lock against other Git writers.
  const index=git(cwd,['rev-parse','--path-format=absolute','--git-path','index']),lock=index+'.lock',scratch=fs.mkdtempSync(path.join(os.tmpdir(),'deltaroute-apply-')),env={...process.env,GIT_INDEX_FILE:path.join(scratch,'index')},saved=[],missing=new Set();let locked=false,changed=false;
  const restore=()=>{for(const s of saved){fs.rmSync(s.target,{recursive:true,force:true});if(s.exists){fs.mkdirSync(path.dirname(s.target),{recursive:true});fs.cpSync(s.backup,s.target,{recursive:true,preserveTimestamps:true,dereference:false,verbatimSymlinks:true});}}for(const dir of [...missing].sort((a,b)=>b.length-a.length))try{fs.rmdirSync(dir);}catch{}};
  try{
    fs.closeSync(fs.openSync(lock,'wx'));locked=true;if(fs.existsSync(index))fs.copyFileSync(index,env.GIT_INDEX_FILE);else git(cwd,['read-tree','--empty'],{env});
    // numstat also covers patches without diff --git headers. Reject unsafe paths before taking backups.
    const listed=git(cwd,['apply','--numstat','-z',file],{trim:false}).split('\0').filter(Boolean).map(s=>s.slice(s.indexOf('\t',s.indexOf('\t')+1)+1));for(const p of listed)if(!paths.includes(p)&&!isRuntimePath(p))paths.push(p);const targets=[...new Set([...paths,...listed].flatMap(p=>[p,p+'.rej']))].map(p=>path.resolve(cwd,p)).sort((a,b)=>a.length-b.length);
    for(const target of targets){const rel=path.relative(cwd,target);if(!rel||rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel)||rel.split(path.sep).some(p=>p.toLowerCase()==='.git'))throw Error('Unsafe patch path: '+rel);for(let dir=path.dirname(target);dir!==cwd;dir=path.dirname(dir)){if(fs.existsSync(dir)){if(fs.lstatSync(dir).isSymbolicLink())throw Error('Unsafe patch path: '+rel);}else missing.add(dir);}if(saved.some(s=>target.startsWith(s.target+path.sep)))continue;const backup=path.join(scratch,String(saved.length)),exists=fs.existsSync(target)||(()=>{try{return fs.lstatSync(target).isSymbolicLink();}catch{return false;}})();if(exists)fs.cpSync(target,backup,{recursive:true,preserveTimestamps:true,dereference:false,verbatimSymlinks:true});saved.push({target,backup,exists});}
    changed=true;let method='apply';try{git(cwd,['apply','--check','--whitespace=nowarn',file],{env});}catch{method='3way';git(cwd,['apply','--3way','--check','--whitespace=nowarn',file],{env});}
    git(cwd,['apply',...(method==='3way'?['--3way']:[]),'--whitespace=nowarn',file],{env});
    if(method==='3way'){fs.writeFileSync(lock,fs.readFileSync(env.GIT_INDEX_FILE));fs.renameSync(lock,index);locked=false;}
    return {applied:true,method,paths,...(method==='3way'?{note:'Applied with a three-way merge; the files are staged. Check for conflict markers.'}:{})};
  }catch(error){if(changed)restore();const lines=error.message.split('\n').filter(s=>/^(?:error:|U\s)|with conflicts/.test(s)),conflicts=paths.filter(p=>lines.some(s=>s.includes(p)));throw Object.assign(Error('The patch does not apply to this checkout: '+error.message.slice(0,1500)+' Conflicting files: '+(conflicts.length?conflicts:paths).join(', ')),{conflicts:conflicts.length?conflicts:paths});
  }finally{if(locked)fs.rmSync(lock,{force:true});fs.rmSync(scratch,{recursive:true,force:true});}
}
