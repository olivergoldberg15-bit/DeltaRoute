// DeltaRoute 2.0: wall-clock limits, patches, stills, the team board, monitors, media, Claude-first routing,
// benchmark auto-apply, light plans, secret links and templates. No test here calls a provider.
import {testTempRoot} from './test-fixtures.mjs';
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {watchDeadline, isRuntimePath, deadlineBrief} from './deadline.mjs';
import {exportPatch, applyPatch, patchPaths} from './patches.mjs';
import {renderRequest, detectRenderer, renderPlan, remotionBatch, contactSheetArgs, pendingRequests} from './render-stills.mjs';
import {postMessage, readBoard, boardView, collectOutbox, validMessage, boardFile} from './board.mjs';
import {ruleVerdict, parseVerdict, activityTail, monitorPrompt} from './monitor.mjs';
import {parsePreReview, preReviewArgs} from './pre-review.mjs';
import {resolveMedia, mediaJobSpec, previewArgs} from './media.mjs';
import {imageSpec, isMediaBytes, higgsfieldCreateArgs} from './image-jobs.mjs';
import {coordinatorUsage, projectSlug} from './coordinator-usage.mjs';
import {delegationVerdict, applyBenchmarkChanges, undoBenchmarkChange, loadRegistry} from './registry.mjs';
import {parseNewsChanges, serviceNews, takeUnseenChanges} from './benchmark-news.mjs';
import {createWorkflow, revisePlan, readWorkflow} from './workflows.mjs';
import {addLinkClient, authorizeLink, loadClients, withLinks, publicBase} from './remote-mcp.mjs';
import {loadTemplate, applyTemplate} from './templates.mjs';
import {bannedWords, selectInstalledSkills} from './worker-context.mjs';

const tmp = fs.mkdtempSync(path.join(testTempRoot, 'deltaroute-v2-'));
after(() => fs.rmSync(tmp, {recursive: true, force: true}));
const git = (cwd, ...args) => { const r = spawnSync('git', args, {cwd, encoding: 'utf8'}); if (r.status !== 0) throw Error(r.stderr); return r.stdout.trim(); };
function repo(name) {
  const dir = path.join(tmp, name); fs.mkdirSync(dir, {recursive: true});
  git(dir, 'init', '-q'); git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  fs.mkdirSync(path.join(dir, 'src'), {recursive: true}); fs.writeFileSync(path.join(dir, 'src', 'a.txt'), 'one\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  return {dir, base: git(dir, 'rev-parse', 'HEAD')};
}

test('time limits follow the wall clock, warn at 80% and fire once', () => {
  let t = 0, warned = 0, expired = 0, tick = null;
  const w = watchDeadline({startedAt: 0, seconds: 100, now: () => t, onWarn: () => warned++, onExpire: () => expired++, timers: {setInterval: f => (tick = f, 1), clearInterval: () => {}}});
  t = 79_000; tick(); assert.equal(warned, 0);
  t = 80_000; tick(); assert.equal(warned, 1);
  // A laptop that slept wakes far past the limit: the next tick fires at once.
  t = 3_000_000; tick(); tick(); assert.equal(expired, 1); assert.equal(warned, 1);
  assert.equal(w.expireAt, 100_000);
  assert.match(deadlineBrief({warnAt: 80_000, expireAt: 100_000}), /WRAP_UP/);
});

test('coordination files never count as project changes, except a project note', () => {
  for (const p of ['.deltaroute/WRAP_UP', '.deltaroute/render/check-1/sheet.jpg', '.deltaroute/outbox/a.json', '.deltaroute/board.md', '.deltaroute/NUDGE.md']) assert.equal(isRuntimePath(p), true, p);
  for (const p of ['.deltaroute/context.md', 'src/.deltaroute.ts', 'deltaroute/x']) assert.equal(isRuntimePath(p), false, p);
});

test('a worker change leaves as one patch (new files included, coordination files left out) and applies without a commit', () => {
  const work = repo('patch-work');
  fs.writeFileSync(path.join(work.dir, 'src', 'a.txt'), 'two\n');
  fs.writeFileSync(path.join(work.dir, 'src', 'new.txt'), 'new\n');
  fs.mkdirSync(path.join(work.dir, '.deltaroute', 'render'), {recursive: true}); fs.writeFileSync(path.join(work.dir, '.deltaroute', 'render', 'x.json'), '{}');
  const patch = exportPatch(work.dir, work.base, path.join(tmp, 'change.patch'));
  assert.deepEqual(patch.paths.sort(), ['src/a.txt', 'src/new.txt']);
  assert.deepEqual(patchPaths(fs.readFileSync(patch.file, 'utf8')).sort(), ['src/a.txt', 'src/new.txt']);
  // The worktree's own index is untouched: nothing was staged there.
  assert.equal(git(work.dir, 'diff', '--cached', '--name-only'), '');
  const target = repo('patch-target');
  const applied = applyPatch(target.dir, patch.file);
  assert.equal(applied.applied, true);
  assert.equal(fs.readFileSync(path.join(target.dir, 'src', 'a.txt'), 'utf8').replace(/\r/g, ''), 'two\n');
  assert.equal(git(target.dir, 'rev-parse', 'HEAD'), target.base, 'nothing committed');
});

test('render requests are checked, Remotion and HTML projects get the right commands, and one contact sheet tiles them', () => {
  assert.throws(() => renderRequest({}), /frames/);
  assert.throws(() => renderRequest({frames: Array(13).fill(1)}), /at most 12/);
  assert.throws(() => renderRequest({frames: [1], target: 'https://evil.example/'}), /localhost/);
  const remotion = path.join(tmp, 'remotion'); fs.mkdirSync(path.join(remotion, 'src'), {recursive: true});
  fs.writeFileSync(path.join(remotion, 'package.json'), JSON.stringify({dependencies: {remotion: '4'}, scripts: {studio: 'remotion studio src/Root.tsx'}}));
  const req = renderRequest({frames: [0, 45], composition: 'Film'});
  const r = detectRenderer(remotion, req); assert.deepEqual(r, {kind: 'remotion', entry: 'src/Root.tsx'});
  const plan = renderPlan(remotion, req, r, path.join(remotion, 'out'));
  assert.equal(plan.length, 2); assert.ok(plan[1].args.includes('--frame=45')); assert.ok(plan[0].args[0].endsWith(path.join('@remotion', 'cli', 'remotion-cli.js')));
  // The fast path renders every frame in one process (one bundle, one browser) at review scale.
  const batch = remotionBatch(renderRequest({frames: [0], times: [1.5], composition: 'Film'}), r, 'out');
  assert.ok(batch.args[0].endsWith('remotion-stills.mjs')); assert.deepEqual(batch.args.slice(1), ['src/Root.tsx', 'Film', 'out', '0.5', '0', '45']);
  assert.deepEqual(batch.files, [path.join('out', 'frame-0.png'), path.join('out', 'frame-45.png')]);
  assert.throws(() => detectRenderer(remotion, renderRequest({frames: [0]})), /composition/);
  const html = path.join(tmp, 'html'); fs.mkdirSync(html); fs.writeFileSync(path.join(html, 'index.html'), '<p>hi');
  const hplan = renderPlan(html, renderRequest({times: [1.5]}), detectRenderer(html, renderRequest({times: [1.5]})), html, {chrome: 'chrome'});
  assert.ok(hplan[0].args.some(a => a === '--virtual-time-budget=1750'));
  const sheet = contactSheetArgs(['a.png', 'b.png', 'c.png'], 'sheet.jpg', {size: {width: 1920, height: 1080}});
  assert.ok(sheet.join(' ').includes('xstack=inputs=3')); assert.equal(sheet.at(-1), 'sheet.jpg');
  fs.mkdirSync(path.join(html, '.deltaroute', 'render', 'done-1'), {recursive: true});
  fs.writeFileSync(path.join(html, '.deltaroute', 'render', 'done-1.json'), '{}'); fs.writeFileSync(path.join(html, '.deltaroute', 'render', 'done-1', 'done.json'), '{}');
  fs.writeFileSync(path.join(html, '.deltaroute', 'render', 'check-2.json'), '{}');
  assert.deepEqual(pendingRequests(html), ['check-2']);
});

test('the team board carries notes and help requests, and each agent sees what is meant for it', () => {
  const file = boardFile(tmp, {jobId: '11111111-1111-1111-1111-111111111111'});
  const worktree = path.join(tmp, 'board-wt'); fs.mkdirSync(path.join(worktree, '.deltaroute', 'outbox'), {recursive: true});
  fs.writeFileSync(path.join(worktree, '.deltaroute', 'outbox', '1.json'), JSON.stringify({kind: 'note', to: 'all', text: 'Horse lives in src/horse.tsx'}));
  fs.writeFileSync(path.join(worktree, '.deltaroute', 'outbox', '2.json'), JSON.stringify({kind: 'help', ask: 'research', to: 'perplexity', text: 'How do horses gallop?'}));
  fs.writeFileSync(path.join(worktree, '.deltaroute', 'outbox', '3.json'), JSON.stringify({kind: 'monitor', text: 'workers cannot post as monitors'}));
  const {taken, rejected} = collectOutbox(worktree, 'codex:shot_a');
  assert.equal(taken.length, 2); assert.equal(rejected.length, 1); assert.equal(taken[1].ask, 'research');
  for (const m of taken) postMessage(file, m);
  postMessage(file, {kind: 'answer', from: 'perplexity:helper', to: 'codex:shot_a', text: 'Four beats.'}, {worker: false});
  postMessage(file, {kind: 'question', from: 'gemini:shot_b', to: 'gemini:shot_b', text: 'private'}, {worker: false});
  const view = boardView(readBoard(file), ['codex:shot_a', 'shot_a', 'codex']);
  assert.match(view, /Horse lives/); assert.match(view, /Four beats/); assert.doesNotMatch(view, /private/);
  assert.throws(() => validMessage({kind: 'help', ask: 'deploy', text: 'x'}), /ask must be/);
  assert.throws(() => boardFile(tmp, {jobId: '../x'}), /workflow or job id/);
});

test('monitors: a long silence is a stall without any model, and model verdicts are read strictly', () => {
  assert.equal(ruleVerdict({minutesSinceActivity: 12, minutesElapsed: 20}).status, 'stalled');
  assert.equal(ruleVerdict({minutesSinceActivity: 2, minutesElapsed: 20}), null);
  assert.deepEqual(parseVerdict('ok {"status":"looping","confidence":80,"note":"same test 6 times","nudge":"stop rerunning"}'), {status: 'looping', confidence: 80, note: 'same test 6 times', nudge: 'stop rerunning'});
  assert.equal(parseVerdict(JSON.stringify({response: '{"status":"on_track","confidence":70}'})).status, 'on_track');
  assert.equal(parseVerdict('{"status":"great"}'), null);
  assert.match(activityTail('{"type":"item.completed","item":{"type":"command_execution","command":"npm test"}}\nplain'), /npm test/);
  assert.match(monitorPrompt({assignment: 'x'}), /Reply with only JSON/);
});

test('the cheap first review returns advice from agy output and runs read-only on the cheap model', () => {
  assert.deepEqual(parsePreReview(JSON.stringify({response: 'Here: {"score": 64, "misses": ["horse looks like a llama"], "looks_right": ["palette"]}'})), {score: 64, misses: ['horse looks like a llama'], looksRight: ['palette']});
  assert.equal(parsePreReview('no json'), null);
  const args = preReviewArgs({sheet: 'C:/x/sheet.jpg', task: 'Draw a horse', acceptance: ['Horse is recognisable'], model: 'gemini-3.8-flash-low'});
  assert.ok(args.includes('plan') && args.includes('gemini-3.8-flash-low') && args.includes('low'));
});

test('generate_media maps plain model names to platforms and builds a checked job', () => {
  assert.deepEqual(resolveMedia('Nano Banana Pro'), {via: 'higgsfield', model: 'nano_banana_pro', kind: 'image'});
  assert.equal(resolveMedia('chatgpt').via, 'codex'); assert.equal(resolveMedia('grok imagine').via, 'grok');
  assert.equal(resolveMedia(null, 'video').model, 'seedance_2_0');
  assert.throws(() => resolveMedia('chatgpt', 'video'), /makes images/);
  assert.throws(() => resolveMedia('$$$'), /Unknown model/);
  const spec = imageSpec(mediaJobSpec({prompt: 'A neon octopus', count: 2, aspect_ratio: '9:16'}, resolveMedia('nano banana pro')), {cwd: tmp});
  assert.equal(spec.outputs.length, 2); assert.equal(spec.model, 'nano_banana_pro'); assert.equal(spec.outputs[1].file, 'a-neon-octopus-2.png');
  const video = imageSpec(mediaJobSpec({prompt: 'Waves', duration: 8}, resolveMedia('seedance')), {cwd: tmp});
  assert.equal(video.kind, 'video'); assert.equal(video.outputs[0].file, 'waves.mp4'); assert.equal(video.outputs[0].duration, 8);
  const args = higgsfieldCreateArgs('seedance_2_0', video, video.outputs[0], ['aspect_ratio', 'duration', 'prompt']);
  assert.ok(args.includes('--duration') && !args.includes('--resolution') && args.includes('--wait-timeout'));
  const mp4 = Buffer.alloc(16); mp4.write('ftyp', 4); assert.equal(isMediaBytes(mp4), true);
  assert.ok(previewArgs('a.mp4', 'p.jpg').includes('-ss'));
});

test("Claude's own tokens come from Claude Code transcripts, each reply counted once", () => {
  const home = path.join(tmp, 'home'), dir = path.join(home, '.claude', 'projects', projectSlug('C:\\x\\y')); fs.mkdirSync(dir, {recursive: true});
  const row = (id, at, u) => JSON.stringify({type: 'assistant', timestamp: at, sessionId: 's1', message: {id, usage: u}});
  fs.writeFileSync(path.join(dir, 's1.jsonl'), [row('m1', '2026-11-01T10:00:00Z', {input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 5000, output_tokens: 50}), row('m1', '2026-11-01T10:00:01Z', {input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 5000, output_tokens: 50}), row('m2', '2026-10-01T10:00:00Z', {input_tokens: 999, output_tokens: 999}), 'not json'].join('\n'));
  const u = coordinatorUsage({home, since: '2026-10-31T00:00:00Z'});
  assert.equal(u.replies, 1); assert.equal(u.freshTokens, 160); assert.equal(u.cacheReadTokens, 5000);
  assert.equal(projectSlug('C:\\Users\\olive\\DeltaRoute'), 'C--Users-olive-DeltaRoute');
});

test('Claude keeps work it is as good at; a worker that clearly leads gets it', () => {
  const registry = {live: {}, models: [
    {id: 'claude', provider: 'claude', label: 'Claude', tier: 'top', scores: {coding: 90, visual: 75, research: 60}},
    {id: 'codex', provider: 'codex', label: 'Codex', tier: 'top', scores: {coding: 93, visual: 40, research: 35}},
    {id: 'grok', provider: 'grok', label: 'Grok', tier: 'mid', scores: {coding: 15, visual: 10, research: 88}}]};
  const workers = [{name: 'codex', enabled: true, installed: true}, {name: 'grok', enabled: true, installed: true}];
  assert.equal(delegationVerdict(registry, {category: 'implementation', workers}).keep, true);
  registry.models[1].scores.coding = 96;
  const v = delegationVerdict(registry, {category: 'implementation', workers});
  assert.equal(v.keep, false); assert.equal(v.provider, 'codex');
  assert.equal(delegationVerdict(registry, {category: 'creative', workers}).keep, true);
});

test('benchmark changes apply on their own only with a visited source, a recent date and a capped step, and undo cleanly', () => {
  const root = path.join(tmp, 'registry-root'); fs.mkdirSync(root);
  fs.copyFileSync(path.join(import.meta.dirname, 'models.json'), path.join(root, 'models.json'));
  const now = Date.parse('2026-11-01T00:00:00Z');
  const before = loadRegistry(root).models.find(m => m.id === 'codex-default').scores.coding;
  const changes = parseNewsChanges(`Findings...\n{"id":"codex-default","capability":"coding","direction":"up","points":25,"source_url":"https://www.swebench.com/x","source_date":"2026-10-20","note":"new SOTA"}\n{"id":"grok-web","capability":"research","direction":"up","points":3,"source_url":"https://made-up.example/","source_date":"2026-10-20"}\n{"id":"gemini-4-argon-high","capability":"coding","direction":"down","points":4,"source_url":"https://swebench.com/old","source_date":"2025-01-01"}`);
  const r = applyBenchmarkChanges(root, changes, {visitedHosts: ['swebench.com'], now});
  assert.equal(r.applied.length, 1); assert.equal(r.applied[0].to, Math.min(100, before + 10), 'capped at 10 points');
  assert.deepEqual(r.skipped.map(s => s.why).sort(), ['source date missing or older than 60 days', 'source not among the pages the research visited']);
  undoBenchmarkChange(root, r.applied[0].changeId);
  assert.equal(loadRegistry(root).models.find(m => m.id === 'codex-default').scores.coding, before);
  assert.throws(() => undoBenchmarkChange(root, r.applied[0].changeId), /already undone/);
});

test('the weekly check starts a research job when due and applies its answer once', async () => {
  const root = path.join(tmp, 'news-root'); fs.mkdirSync(root);
  fs.copyFileSync(path.join(import.meta.dirname, 'models.json'), path.join(root, 'models.json'));
  const jobs = {}, now = Date.parse('2026-11-01T00:00:00Z');
  const submit = async args => { jobs.j = {id: 'j', status: 'running', task: args.task}; return jobs.j; };
  const readJob = id => jobs[id];
  const first = await serviceNews(root, {registry: loadRegistry(root), submit, readJob, now});
  assert.equal(first.started, 'j'); assert.match(jobs.j.task, /benchmark/);
  assert.equal((await serviceNews(root, {registry: loadRegistry(root), submit, readJob, now})), null, 'nothing new while it runs');
  jobs.j = {id: 'j', status: 'completed', sources: [{url: 'https://lmarena.ai/leaderboard'}], answer: '{"id":"grok-web","capability":"research","direction":"down","points":2,"source_url":"https://lmarena.ai/leaderboard","source_date":"2026-10-25","note":"x"}'};
  const second = await serviceNews(root, {registry: loadRegistry(root), submit, readJob, now});
  assert.equal(second.applied, 1);
  assert.equal(takeUnseenChanges(root).length, 1); assert.equal(takeUnseenChanges(root).length, 0);
});

test('light plans are approved by the go-ahead in one call and revise without losing unchanged steps', () => {
  const root = path.join(tmp, 'light-root'), cwd = path.join(tmp, 'light-cwd'); fs.mkdirSync(root); fs.mkdirSync(cwd);
  const steps = [{id: 'a', task: 'A', acceptance: ['a ok']}, {id: 'b', task: 'B', acceptance: ['b ok'], depends_on: ['a']}, {id: 'c', task: 'C', acceptance: ['c ok']}];
  assert.throws(() => createWorkflow(root, {task: 'x', cwd, workflow: {steps}, approvedByUser: 'go'}), /Only light-mode/);
  const plan = createWorkflow(root, {task: 'Make the episode', cwd, workflow: {mode: 'light', steps}, approvedByUser: 'yes go'});
  assert.equal(plan.approval.status, 'approved'); assert.equal(plan.phase === 'awaiting_plan_approval', false);
  const saved = readWorkflow(root, plan.id); saved.progress.c.jobs.push('kept-job'); fs.writeFileSync(path.join(root, 'workflows', plan.id, 'plan.json'), JSON.stringify(saved));
  const revised = revisePlan(root, plan.id, {workflow: {steps: [{...steps[0], task: 'A, but blue'}, steps[1], steps[2]]}, approvedByUser: 'make A blue'});
  assert.deepEqual(revised.restarted.sort(), ['a', 'b'], 'changed step and what builds on it');
  const after = readWorkflow(root, plan.id);
  assert.deepEqual(after.progress.c.jobs, ['kept-job']); assert.equal(after.contract.mode, 'light'); assert.equal(after.revisions.length, 1);
});

test('a secret connector link authorises like a key, is stored only as a hash, and results get phone-openable links', () => {
  const file = path.join(tmp, 'clients.json');
  const link = addLinkClient('phone', {file});
  assert.match(link, /^\/c\/l[A-Za-z0-9_-]{40,}\/mcp$/);
  assert.equal(JSON.stringify(loadClients(file)).includes(link.split('/')[2]), false);
  assert.equal(authorizeLink(link.split('/')[2], loadClients(file)).name, 'phone');
  assert.equal(authorizeLink('l' + 'x'.repeat(43), loadClients(file)), null);
  const reply = {result: {content: [{type: 'text', text: JSON.stringify({id: '11111111-1111-1111-1111-111111111111', files: [{file: 'octopus.png', path: 'C:/x/octopus.png'}]})}]}};
  const linked = JSON.parse(withLinks(reply, 'https://pc.ts.net/c/secret').result.content[0].text);
  assert.deepEqual(linked.links, ['https://pc.ts.net/c/secret/files/11111111-1111-1111-1111-111111111111/octopus.png']);
  assert.equal(publicBase({headers: {host: 'pc.ts.net'}}, '/c/s'), 'https://pc.ts.net/c/s');
});

test('templates fill mode, checks and constraints, and the plan still wins', () => {
  const t = loadTemplate(import.meta.dirname, 'animated_explainer');
  const w = applyTemplate(t, {constraints: ['Mine'], steps: [{id: 'a', task: 'Shot A'}, {id: 'b', task: 'Shot B', acceptance: ['custom'], profile: 'standard'}]});
  assert.equal(w.mode, 'light'); assert.equal(w.visual, true); assert.equal(w.constraints.at(-1), 'Mine');
  assert.equal(w.steps[0].acceptance.length, 3); assert.deepEqual(w.steps[1].acceptance, ['custom']); assert.equal(w.steps[1].profile, 'standard');
  assert.throws(() => loadTemplate(import.meta.dirname, 'nope'), /No template/);
});

test('skills banned by the user\'s rules, deploy skills and weak matches never reach a worker', () => {
  const skills = [{name: 'higgsfield-game-generation', description: 'card game generation'}, {name: 'land-and-deploy', description: 'deploy the card game'}, {name: 'remotion-best-practices', description: 'remotion video react composition'}];
  assert.ok(bannedWords('- No Higgsfield, no AI-generated images.').has('higgsfield'));
  assert.deepEqual(selectInstalledSkills('Animate the card game shot in Remotion with React', skills, 2, {bannedText: '- No Higgsfield.'}).map(s => s.name), ['remotion-best-practices']);
  assert.deepEqual(selectInstalledSkills('Use higgsfield-game-generation', skills, 2, {bannedText: '- No Higgsfield.'}).map(s => s.name), ['higgsfield-game-generation'], 'asked for by name');
  assert.deepEqual(selectInstalledSkills('card game', skills, 2, {blocked: ['higgsfield-*']}).map(s => s.name), []);
});

test('Muse replies keep only the first answer, without meta.ai page labels', async () => {
  const {museReply} = await import('./browser.mjs');
  assert.equal(museReply('Today\nWhich response do you prefer?\nSkip\nResponse 1\n\nFirst answer\n\nI prefer this response\nResponse 2\n\nSecond answer\n\nI prefer this response\nAsk Meta AI...\nInstant'), 'First answer');
  assert.equal(museReply('A long answer.\nWith two lines.\nAsk Meta AI...\nInstant'), 'A long answer.\nWith two lines.');
});

test('Grok Imagine results are read from embedded images, and the public example feed never counts', async () => {
  const {decodeDataImage, GROK_IMAGE_SCAN} = await import('./media.mjs');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(decodeDataImage('data:image/jpeg;base64,' + jpeg.toString('base64')), jpeg);
  assert.equal(decodeDataImage('https://assets.grok.com/x.jpg'), null);
  assert.doesNotMatch(GROK_IMAGE_SCAN, /imagine-public/);
  assert.match(GROK_IMAGE_SCAN, /naturalWidth>=512/);
});
