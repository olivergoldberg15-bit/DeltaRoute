import test from 'node:test';
import assert from 'node:assert/strict';
import {accountKey, candidateProviders, classifyFailure, failureCooldownMs} from './fallback-policy.mjs';

const workers = ['codex', 'gemini', 'cursor', 'perplexity', 'grok'].map(name => ({name, enabled: true, installed: true}));

test('expired credentials choose a different account rather than bypassing login', () => {
  const failure = classifyFailure('Cursor Agent requires subscription browser login. Run login-cursor.ps1.');
  assert.equal(failure.kind, 'auth');
  assert.equal(failure.fallbackEligible, true);
  assert.equal(failure.blockAccount, true);
  assert.equal(accountKey('cursor'), accountKey('grok'));
  assert.deepEqual(candidateProviders({requested: 'grok', category: 'social_research', workers, blockedAccounts: ['cursor']}), ['perplexity', 'codex', 'gemini']);
});

test('quota fallback observes a bounded provider retry hint', () => {
  const failure = classifyFailure('HTTP 429 usage quota exhausted; Retry-After: 3600');
  assert.equal(failure.kind, 'quota');
  assert.equal(failure.cooldownMs, 3_600_000);
  assert.equal(failureCooldownMs('quota', 'retry in 2 hours'), 7_200_000);
  assert.equal(failureCooldownMs('quota', 'Retry-After: 999999999'), 86_400_000);
  assert.equal(failureCooldownMs('outage', 'Retry-After: 100', {maxMs: 60_000}), 60_000);
});

test('challenge has no credential or browser-bypass action', () => {
  const failure = classifyFailure('Cloudflare browser challenge: verify you are human');
  assert.deepEqual(failure, {kind: 'challenge', retryable: true, fallbackEligible: true, blockAccount: true, cooldownMs: 1_800_000});
  assert.deepEqual(candidateProviders({requested: 'perplexity', category: 'research', workers, blockedAccounts: ['perplexity']}), ['codex', 'gemini', 'cursor', 'grok']);
});

test('provider outage, timeout, capability, and incomplete source errors are recoverable', () => {
  for (const [error, kind] of [
    ['HTTP 503 service unavailable', 'outage'],
    ['fetch failed: ECONNRESET', 'outage'],
    ['Worker exceeded time limit', 'timeout'],
    ['Model gemini-flash is not available', 'capability'],
    ['model_not_found', 'capability'],
    ['Primary sources missing; no original source URLs', 'source_incomplete'],
  ]) {
    const failure = classifyFailure(error);
    assert.equal(failure.kind, kind, error);
    assert.equal(failure.retryable, true, error);
  }
  assert.equal(classifyFailure('No original sources found').blockAccount, false);
  assert.equal(classifyFailure('Unknown model foo').blockAccount, false);
});

test('user cancellation, safety, file permissions and bad inputs never trigger fallback', () => {
  for (const [error, kind] of [
    ['Task cancelled by user', 'cancelled'],
    ['Refused due to content policy', 'safety'],
    ['Permission denied: private.txt', 'safety'],
    ['Code delegation requires a clean Git checkout. Commit or stash changes first.', 'safety'],
    ['Invalid mode', 'input'],
    ['cwd must be an existing directory', 'input'],
    ['Queue full; wait for existing tasks', 'input'],
    ['Something entirely unexpected happened', 'unknown'],
  ]) {
    const failure = classifyFailure(error);
    assert.equal(failure.kind, kind, error);
    assert.equal(failure.fallbackEligible, false, error);
  }
  assert.equal(classifyFailure('User cancelled after an HTTP 503').kind, 'cancelled');
  assert.equal(classifyFailure('Sandbox permission denied after model not found').kind, 'safety');
});

test('coding routes retain task fit and exclude browser and social models', () => {
  assert.deepEqual(candidateProviders({category: 'quick_coding', mode: 'code', workers}), ['gemini', 'codex', 'cursor']);
  assert.deepEqual(candidateProviders({requested: 'perplexity', category: 'implementation', workers}), ['codex', 'gemini', 'cursor']);
  assert.deepEqual(candidateProviders({requested: 'cursor', category: 'tests', workers}), ['cursor', 'codex', 'gemini']);
  assert.deepEqual(candidateProviders({category: 'research', mode: 'code', workers}), ['codex', 'gemini', 'cursor']);
});

test('research can use read-only CLI analysis after authoritative source collection', () => {
  assert.deepEqual(candidateProviders({category: 'research', workers}), ['perplexity', 'codex', 'gemini', 'cursor', 'grok']);
  assert.deepEqual(candidateProviders({category: 'social_research', workers, attempted: ['grok', 'perplexity']}), ['codex', 'gemini', 'cursor']);
});

test('unavailable workers, attempted names, and shared accounts are all excluded', () => {
  const definitions = workers.map(worker => ({...worker, ...(worker.name === 'gemini' ? {availableNow: false} : {}), ...(worker.name === 'perplexity' ? {installed: false} : {})}));
  assert.deepEqual(candidateProviders({category: 'research', workers: definitions, attempted: [{provider: 'codex'}], blockedAccounts: new Set(['grok'])}), []);
  assert.deepEqual(candidateProviders({workers: {codex: {enabled: true}, gemini: {enabled: false}, cursor: {enabled: true}}}), ['codex', 'cursor']);
});

test('planning stays in Claude unless an independent provider was requested', () => {
  for (const category of ['simple', 'planning', 'creative']) assert.deepEqual(candidateProviders({category, workers}), []);
  assert.deepEqual(candidateProviders({requested: 'codex', category: 'planning', workers}), ['codex', 'gemini', 'cursor']);
  assert.deepEqual(candidateProviders({mode: 'unsafe', workers}), []);
  assert.deepEqual(candidateProviders({requested: 'claude', workers}), []);
});
