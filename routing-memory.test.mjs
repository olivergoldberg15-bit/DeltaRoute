import {testTempRoot} from './test-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {recordRoutingReview, rankCandidates} from './routing-memory.mjs';

const fixtures = path.join(testTempRoot, 'deltaroute-routing-memory-fixtures');
function root(t) { fs.mkdirSync(fixtures, {recursive: true}); const dir = fs.mkdtempSync(path.join(fixtures, 'case-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true})); return dir; }
const workers = {codex: {model: 'codex-current'}, gemini: {model: 'gemini-current', models: {large_context: 'gemini-large'}}, cursor: {model: 'cursor-current'}};
const task = (id, provider = 'gemini', extra = {}) => ({id, provider, category: 'implementation', modelUsed: workers[provider].model, task: 'PRIVATE RAW ORIGINAL PROMPT', answer: 'PRIVATE ANSWER', ...extra});
const rank = (dir, extra = {}) => rankCandidates(dir, {category: 'implementation', candidates: ['codex', 'gemini', 'cursor'], workers, ...extra});
function reviews(dir, provider, accepted, count = 3, extra = {}) { for (let i = 0; i < count; i++) recordRoutingReview(dir, task(provider + '-' + (extra.category || 'implementation') + '-' + i, provider, extra), {accepted}); }

test('unreviewed runs and fewer than three explicit reviews preserve configured specialties', t => {
  const dir = root(t);
  assert.deepEqual(rank(dir).providers, ['codex', 'gemini', 'cursor']);
  reviews(dir, 'gemini', true, 2);
  const result = rank(dir);
  assert.equal(result.mode, 'configured_specialties');
  assert.deepEqual(result.providers, ['codex', 'gemini', 'cursor']);
  assert.equal(result.evidence[1].reviewed, 2);
  assert.equal(result.evidence[1].scoreAdjustment, 0);
});
test('sufficient positive reviewed outcomes can favor a configured second choice', t => {
  const dir = root(t); reviews(dir, 'gemini', true);
  const result = rank(dir);
  assert.equal(result.mode, 'reviewed_outcomes');
  assert.deepEqual(result.providers, ['gemini', 'codex', 'cursor']);
  assert.equal(result.evidence[1].source, 'coordinator checkpoint');
  assert.equal(result.evidence[1].accepted, 3);
  assert.ok(result.evidence[1].scoreAdjustment <= 0.18);
});
test('reviewed rework moves a repeatedly rejected first choice behind an unreviewed alternative', t => {
  const dir = root(t); reviews(dir, 'codex', false);
  const result = rank(dir);
  assert.equal(result.providers[0], 'gemini');
  assert.equal(result.evidence[0].rejected, 3);
  assert.ok(result.evidence[0].scoreAdjustment < 0);
});
test('new configured model and category-specific model overrides never inherit old evidence', t => {
  const dir = root(t); reviews(dir, 'gemini', true);
  assert.equal(rank(dir, {workers: {...workers, gemini: {model: 'gemini-new'}}}).mode, 'configured_specialties');
  assert.equal(rank(dir, {category: 'large_context'}).evidence[1].reviewed, 0);
  reviews(dir, 'gemini', true, 3, {category: 'large_context', modelUsed: 'gemini-large'});
  assert.equal(rank(dir, {category: 'large_context'}).evidence[1].reviewed, 3);
  assert.equal(rank(dir).evidence[1].reviewed, 3);
});
test('current candidates are the entire authority for availability; memory adds no providers', t => {
  const dir = root(t); reviews(dir, 'gemini', true);
  assert.deepEqual(rank(dir, {candidates: ['codex', 'cursor']}).providers, ['codex', 'cursor']);
  assert.deepEqual(rank(dir, {candidates: []}).providers, []);
});
test('independent event files persist and can be ranked after reloading the module', async t => {
  const dir = root(t); reviews(dir, 'gemini', true);
  const module = await import('./routing-memory.mjs?reload=' + Date.now());
  const result = module.rankCandidates(dir, {category: 'implementation', candidates: ['codex', 'gemini'], workers});
  assert.equal(result.providers[0], 'gemini');
  assert.equal(fs.readdirSync(path.join(dir, 'routing-memory', 'events')).length, 3);
});
test('latest review per job supersedes acceptance without double-counting and retains scope drift', t => {
  const dir = root(t);
  recordRoutingReview(dir, task('same-job'), {accepted: false, scopeViolation: true});
  recordRoutingReview(dir, task('same-job', 'gemini', {scopeAudit: {passed: true}}), {accepted: true});
  recordRoutingReview(dir, task('another-job'), {accepted: true});
  const result = rank(dir);
  assert.equal(result.mode, 'configured_specialties');
  assert.equal(result.evidence[1].reviewed, 2);
  assert.equal(result.evidence[1].accepted, 2);
  assert.equal(result.evidence[1].rejected, 0);
  assert.equal(result.evidence[1].scopeViolations, 1);
});
test('scope violations penalize reviewed acceptance and file audit persists', t => {
  const dir = root(t);
  for (let i = 0; i < 3; i++) recordRoutingReview(dir, task('drift-' + i, 'gemini', {scopeAudit: {passed: false, changedPaths: ['outside.txt'], outside: ['outside.txt']}}), {accepted: false});
  const result = rank(dir);
  assert.equal(result.evidence[1].scopeViolations, 3);
  assert.ok(result.evidence[1].scoreAdjustment < -0.107);
  const events = fs.readdirSync(path.join(dir, 'routing-memory', 'events')).map(file => JSON.parse(fs.readFileSync(path.join(dir, 'routing-memory', 'events', file))));
  assert.deepEqual(events[0].scopeAudit.outside, ['outside.txt']);
});
test('scope history from another model is not attributed to a revised job on the current model', t => {
  const dir = root(t);
  recordRoutingReview(dir, task('changed-model', 'gemini', {modelUsed: 'gemini-old'}), {accepted: false, scopeViolation: true});
  recordRoutingReview(dir, task('changed-model'), {accepted: true});
  const result = rank(dir);
  assert.equal(result.evidence[1].reviewed, 1);
  assert.equal(result.evidence[1].scopeViolations, 0);
  assert.equal(fs.readdirSync(path.join(dir, 'routing-memory', 'events')).length, 2);
});
test('only compact explicit review data and native token counters are retained', t => {
  const dir = root(t);
  const event = recordRoutingReview(dir, task('privacy', 'gemini', {tokenUsage: {available: true, source: 'native CLI', inputTokens: 123, outputTokens: 9, raw: {prompt: 'PRIVATE RAW USAGE'}, apiEquivalentUSD: 123}, secret: 'PRIVATE SECRET'}), {accepted: true, note: 'Inspected the artifact'});
  const stored = fs.readFileSync(event.artifact, 'utf8');
  assert.doesNotMatch(stored, /PRIVATE|apiEquivalentUSD/);
  assert.equal(event.note, 'Inspected the artifact');
  assert.equal(rank(dir).evidence[1].nativeCounters.inputTokens, 123);
  assert.equal(rank(dir).evidence[1].nativeCounters.cacheReadTokens, null);
});
test('account-default model isolation works with array-form worker definitions', t => {
  const dir = root(t);
  for (let i = 0; i < 3; i++) recordRoutingReview(dir, task('default-' + i, 'gemini', {modelUsed: undefined}), {accepted: true});
  assert.equal(rank(dir).evidence[1].reviewed, 0);
  assert.equal(rank(dir, {workers: [{name: 'codex', model: 'codex-current'}, {name: 'gemini'}]}).evidence[1].reviewed, 3);
});
test('invalid reviews cannot create accidental process-success evidence', t => {
  const dir = root(t);
  assert.throws(() => recordRoutingReview(dir, task('bad'), {}), /explicit accepted/);
  assert.throws(() => recordRoutingReview(dir, task('bad'), {accepted: true, scopeViolation: 'false'}), /boolean/);
  assert.throws(() => rank(dir, {minReviews: 1}), /at least three/);
  assert.equal(rank(dir).evidence[1].reviewed, 0);
});
test('partial or malformed independent event files are ignored', t => {
  const dir = root(t); reviews(dir, 'gemini', true);
  fs.writeFileSync(path.join(dir, 'routing-memory', 'events', 'ffffffff-ffff-ffff-ffff-ffffffffffff.json'), '{');
  fs.writeFileSync(path.join(dir, 'routing-memory', 'events', 'unfinished.tmp'), 'partial');
  assert.equal(rank(dir).evidence[1].reviewed, 3);
});
