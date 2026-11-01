import {testTempRoot} from './test-fixtures.mjs';
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildWorkerContext, discoverSkills, formatWorkerContext, saveWorkerContext, selectInstalledSkills} from './worker-context.mjs';

const tmp = fs.mkdtempSync(path.join(testTempRoot, 'deltaroute-context-'));
after(() => fs.rmSync(tmp, {recursive: true, force: true}));
function write(file, text) { fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, text); return file; }
function fixture(name) {
  const root = path.join(tmp, name), cwd = path.join(root, 'project'), home = path.join(root, 'home'), routerRoot = path.join(root, 'router');
  for (const dir of [cwd, home, routerRoot]) fs.mkdirSync(dir, {recursive: true});
  return {root, cwd, home, routerRoot};
}
const skill = (root, name, description, body = 'Use real evidence.') => write(path.join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: >\n  ${description}\n---\n${body}`);

test('retrieves applicable instructions, project state and relevant user skills with provenance', () => {
  const f = fixture('sources'), skills = path.join(f.home, '.agents', 'skills');
  fs.mkdirSync(path.join(f.cwd, '.git'));
  write(path.join(f.cwd, 'AGENTS.md'), 'PROJECT_RULE_481');
  write(path.join(f.home, '.codex', 'AGENTS.md'), 'USER_RULE_923');
  write(path.join(f.cwd, 'BRIEF.md'), 'Duration: two minutes.');
  skill(skills, 'hyperframes', 'Create videos and animation.', 'VIDEO_SKILL_772');
  skill(skills, 'postgres', 'Optimize database indexes.', 'UNRELATED_SKILL_367');
  write(path.join(f.cwd, '.env'), 'CREDENTIAL_SENTINEL');
  write(path.join(f.cwd, 'outputs', 'existing.mp4'), 'fake');
  const p = buildWorkerContext({...f, task: 'Create an animated video', skillRoots: [skills]});
  const brief = formatWorkerContext(p);
  for (const value of ['PROJECT_RULE_481', 'USER_RULE_923', 'VIDEO_SKILL_772', 'two minutes', 'existing.mp4']) assert.ok(brief.includes(value), value);
  for (const value of ['UNRELATED_SKILL_367', 'CREDENTIAL_SENTINEL']) assert.ok(!brief.includes(value), value);
  assert.equal(p.skills[0].name, 'hyperframes');
  assert.match(p.skills[0].includedContentSha256, /^[a-f0-9]{64}$/);
});

test('finds project ancestor rules, system skills and nested plugin skills without reading ancestor scratch files', () => {
  const f = fixture('ancestors');
  fs.mkdirSync(path.join(f.cwd, '.git'));
  const nested = path.join(f.cwd, 'src', 'feature'); fs.mkdirSync(nested, {recursive: true});
  write(path.join(f.cwd, 'AGENTS.md'), 'ROOT_RULE'); write(path.join(nested, 'AGENTS.md'), 'NESTED_RULE');
  skill(path.join(f.cwd, '.agents', 'skills'), 'custom', 'Custom guidance', 'ANCESTOR_SKILL');
  skill(path.join(nested, '.agents', 'skills'), 'custom', 'Custom guidance', 'NEAREST_SKILL');
  const skills = path.join(f.home, '.codex', 'skills'); skill(path.join(skills, '.system'), 'imagegen', 'Generate an image.');
  const cache = path.join(f.home, '.codex', 'plugins', 'cache'); skill(path.join(cache, 'publisher', 'plugin', '1.0', 'skills'), 'drawing', 'Generate an image.');
  const p = buildWorkerContext({...f, cwd: nested, task: 'Use $imagegen to generate an image'});
  assert.match(formatWorkerContext(p), /ROOT_RULE/); assert.match(formatWorkerContext(p), /NESTED_RULE/);
  assert.equal(p.skills[0].name, 'imagegen');
  // The nested plugin skill is found, but two shared description words are too weak a match to send it to a worker.
  assert.ok(discoverSkills([path.join(f.home, '.codex', 'plugins', 'cache')]).skills.some(s => s.name === 'drawing'));
  assert.ok(!p.skills.some(s => s.name === 'drawing'));
  const nearest = buildWorkerContext({...f, cwd: nested, task: 'Use $custom'});
  assert.match(nearest.skills[0].content, /NEAREST_SKILL/);
  const scratch = path.join(f.root, 'scratch'); fs.mkdirSync(scratch); fs.mkdirSync(path.join(scratch, '.git'));
  write(path.join(f.root, 'AGENTS.md'), 'OUTSIDE_SCRATCH');
  assert.ok(!formatWorkerContext(buildWorkerContext({...f, cwd: scratch, task: 'hello', skillRoots: []})).includes('OUTSIDE_SCRATCH'));
});

test('only same-project jobs are retrieved; live process status has no environment, prompts or answers', () => {
  const f = fixture('jobs');
  const current = '11111111-1111-1111-1111-111111111111', related = '22222222-2222-2222-2222-222222222222';
  for (const [id, cwd] of [[current, f.cwd], [related, f.cwd], ['33333333-3333-3333-3333-333333333333', f.home]]) write(path.join(f.routerRoot, 'jobs', id, 'status.json'), JSON.stringify({id, cwd, status: 'running', category: 'implementation', workerPid: process.pid, answer: 'PRIVATE_ANSWER', task: 'PRIVATE_PROMPT'}));
  const p = buildWorkerContext({...f, jobId: current, task: 'hello', skillRoots: []});
  assert.deepEqual(p.relatedJobs.map(j => j.id), [related]);
  assert.equal(p.relatedJobs[0].processes[0].alive, true);
  assert.ok(!formatWorkerContext(p).includes('PRIVATE_'));
  const activeAttempt = '66666666-6666-6666-6666-666666666666';
  write(path.join(f.routerRoot, 'jobs', related, 'status.json'), JSON.stringify({id: related, cwd: f.cwd, status: 'running', activeAttempt}));
  write(path.join(f.routerRoot, 'jobs', activeAttempt, 'status.json'), JSON.stringify({id: activeAttempt, parentId: related, cwd: f.cwd, status: 'running', childPid: process.pid}));
  const active = buildWorkerContext({...f, jobId: current, task: 'hello', skillRoots: []});
  assert.deepEqual(active.relatedJobs[0].processes, [{role: 'provider', pid: process.pid, alive: true}]);
});

test('pinned execution instructions and original-project history/artifacts remain distinct', () => {
  const f = fixture('pinned'), execution = path.join(f.root, 'pinned-worktree'); fs.mkdirSync(execution); fs.mkdirSync(path.join(execution, '.git'));
  write(path.join(f.cwd, 'AGENTS.md'), 'WRONG_SOURCE_REVISION');
  write(path.join(execution, 'AGENTS.md'), 'PINNED_REVISION_RULE');
  write(path.join(f.cwd, 'outputs', 'previous.mp4'), 'fake');
  write(path.join(f.routerRoot, 'jobs', '77777777-7777-7777-7777-777777777777', 'status.json'), JSON.stringify({id: 'prior', cwd: f.cwd, status: 'completed'}));
  const p = buildWorkerContext({...f, cwd: execution, projectCwd: f.cwd, task: 'hello', skillRoots: []});
  assert.match(formatWorkerContext(p), /PINNED_REVISION_RULE/); assert.ok(!formatWorkerContext(p).includes('WRONG_SOURCE_REVISION'));
  assert.equal(p.relatedJobs.length, 1); assert.equal(p.artifacts.length, 1);
});

test('large sources and skill scans are bounded and missing or malformed inputs are harmless', () => {
  const f = fixture('bounds'), skills = path.join(f.home, 'skills');
  write(path.join(f.cwd, 'AGENTS.md'), 'rule '.repeat(20000));
  write(path.join(f.cwd, 'BRIEF.md'), 'brief '.repeat(20000));
  for (let i = 0; i < 10; i++) skill(skills, 'skill' + i, 'video animation', 'body '.repeat(20000));
  const catalog = discoverSkills([skills], {maxEntries: 5, maxSkills: 2});
  assert.ok(catalog.skills.length <= 2); assert.equal(catalog.limited, true);
  const p = buildWorkerContext({...f, task: 'video animation', skillRoots: [skills, path.join(f.root, 'missing')]});
  assert.equal(p.instructions[0].truncated, true);
  assert.ok(p.skills.length <= 3); assert.ok(formatWorkerContext(p).length <= 24000);
  assert.doesNotThrow(() => buildWorkerContext({...f, task: '', skillRoots: []}));
});

test('explicit skills rank first and duplicate installs do not crowd out relevant skills', () => {
  const list = [{name: 'hyperframes', description: 'Create video animation'}, {name: 'hyperframes', description: 'Create video animation'}, {name: 'shader', description: 'Write shader animation'}, {name: 'database', description: 'SQL indexes'}];
  const selected = selectInstalledSkills('Use $shader for video animation', list);
  assert.equal(selected[0].name, 'shader');
  assert.equal(selected.filter(s => s.name === 'hyperframes').length, 1);
  assert.ok(!selected.some(s => s.name === 'database'));
});

test('symlink escapes and traversal through credentials are excluded', t => {
  const f = fixture('links'), skills = path.join(f.home, 'skills'); fs.mkdirSync(skills);
  const outside = path.join(f.root, 'outside'); skill(outside, 'private', 'video animation', 'ESCAPED_CONTENT');
  try { fs.symlinkSync(outside, path.join(skills, 'escape'), process.platform === 'win32' ? 'junction' : 'dir'); } catch { t.skip('symlinks unavailable'); return; }
  const p = buildWorkerContext({...f, task: 'video animation', skillRoots: [skills]});
  assert.equal(p.skills.length, 0); assert.ok(!formatWorkerContext(p).includes('ESCAPED_CONTENT'));
  const persisted = path.join(f.root, 'persisted-claude'); fs.mkdirSync(persisted);
  write(path.join(persisted, 'CLAUDE.md'), 'PERSISTED_CLOUD_RULE');
  fs.symlinkSync(persisted, path.join(f.home, '.claude'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.match(formatWorkerContext(buildWorkerContext({...f, task: 'hello', skillRoots: []})), /PERSISTED_CLOUD_RULE/);
});

test('saved prompt and source manifest match the context actually supplied', () => {
  const f = fixture('save'); write(path.join(f.cwd, 'AGENTS.md'), 'SAVED_CONTEXT');
  const output = path.join(f.root, 'output'); fs.mkdirSync(output);
  const saved = saveWorkerContext({...f, task: 'hello', skillRoots: []}, output);
  assert.equal(fs.readFileSync(saved.summary.promptArtifact, 'utf8'), saved.brief);
  assert.equal(JSON.parse(fs.readFileSync(saved.summary.artifact)).instructions[0].content, 'SAVED_CONTEXT');
  assert.equal(saved.summary.characters, saved.brief.length);
});

test('a real worker subprocess receives retrieved context; disabling retrieval preserves the old behavior', () => {
  const f = fixture('process'), runtime = path.join(f.root, 'runtime'); fs.mkdirSync(runtime);
  for (const file of fs.readdirSync(import.meta.dirname)) if (file.endsWith('.mjs')) fs.copyFileSync(path.join(import.meta.dirname, file), path.join(runtime, file));
  write(path.join(f.cwd, 'AGENTS.md'), 'PROCESS_CONTEXT_918');
  skill(path.join(f.home, '.agents', 'skills'), 'special', 'Specific task guidance', 'PROCESS_SKILL_615');
  const fake = write(path.join(runtime, 'fake.cjs'), "const a=process.argv.slice(2);if(a.includes('status'))console.log('signed in');else {const p=a[a.indexOf('-p')+1];console.log(JSON.stringify({result:'RULE='+p.includes('PROCESS_CONTEXT_918')+' SKILL='+p.includes('PROCESS_SKILL_615')+' MANUAL='+p.includes('MANUAL_CONTEXT_783')}));}");
  for (const enabled of [true, false]) {
    write(path.join(runtime, 'config.json'), JSON.stringify({maxConcurrent: 1, timeoutSeconds: 15, contextRetrieval: {enabled}, workers: {cursor: {enabled: true, command: process.execPath, script: fake, transport: 'cursor'}}}));
    const id = enabled ? '44444444-4444-4444-4444-444444444444' : '55555555-5555-5555-5555-555555555555';
    const dir = path.join(runtime, 'jobs', id);
    write(path.join(dir, 'status.json'), JSON.stringify({id, cwd: f.cwd, task: 'Use $special for this task', context: 'MANUAL_CONTEXT_783', mode: 'read-only', provider: 'cursor', category: 'implementation', status: 'queued'}));
    const run = spawnSync(process.execPath, ['server.mjs', '--attempt', id], {cwd: runtime, encoding: 'utf8', timeout: 20000, windowsHide: true, env: {...process.env, HOME: f.home, USERPROFILE: f.home, MODEL_ROUTER_WORKER: ''}});
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(fs.readFileSync(path.join(dir, 'status.json')));
    assert.equal(result.status, 'completed', result.error);
    assert.equal(result.answer, `RULE=${enabled} SKILL=${enabled} MANUAL=true`);
    assert.equal(Boolean(result.retrievedContext), enabled);
  }
});
