import {testTempRoot} from './test-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';
import {recordHeadLimit, selectHead, recordHeadSuccess, parseHeadLimit} from './coordinator-state.mjs';

const NOW = Date.parse('2026-10-17T19:00:00Z');
const RESET = '2026-10-17T20:00:00.000Z';
const WORK = testTempRoot;
const MODULE = new URL('./coordinator-state.mjs', import.meta.url).href;
fs.mkdirSync(WORK, {recursive: true});
function fixture(t) {
  const root = fs.mkdtempSync(path.join(WORK, 'head-state-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}
const limit = (root, provider, resetAt = RESET, now = NOW) => recordHeadLimit(root, {provider, error: 'Usage limit reached for your subscription', resetAt, now});
const ledger = root => JSON.parse(fs.readFileSync(path.join(root, 'coordinator-health.json'), 'utf8'));
function child(source) {
  return new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, ['--input-type=module', '-e', source], {windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '';
    process.stdout.on('data', value => stdout += value);
    process.stderr.on('data', value => stderr += value);
    process.once('error', reject);
    process.once('exit', code => code === 0 ? resolve(stdout) : reject(new Error(`Child exit ${code}: ${stderr}`)));
  });
}

test('prefers current healthy head; switches Claude to Codex and Codex to Claude', t => {
  const first = fixture(t), second = fixture(t);
  assert.deepEqual(selectHead(first, {preferred: 'claude', now: NOW}), {action: 'run', provider: 'claude'});
  limit(first, 'claude');
  assert.deepEqual(selectHead(first, {preferred: 'claude', now: NOW}), {action: 'run', provider: 'codex'});
  limit(second, 'codex');
  assert.deepEqual(selectHead(second, {preferred: 'codex', now: NOW}), {action: 'run', provider: 'claude'});
});

test('both blocked waits for earliest reported reset without early probes', t => {
  const root = fixture(t);
  limit(root, 'claude', RESET);
  limit(root, 'codex', '2026-10-17T21:00:00Z');
  const result = selectHead(root, {preferred: 'claude', now: NOW});
  assert.equal(result.action, 'wait');
  assert.equal(result.resumeAt, RESET);
  assert.equal(selectHead(root, {preferred: 'codex', now: Date.parse(RESET) - 1}).action, 'wait');
  assert.equal(ledger(root).history.filter(value => value.event === 'reset_probe_claimed').length, 0);
});

test('unknown resets stay blocked without repeated model probes', t => {
  const root = fixture(t);
  limit(root, 'claude', null);
  limit(root, 'codex', null);
  for (let index = 0; index < 12; index++) {
    const result = selectHead(root, {preferred: index % 2 ? 'codex' : 'claude', now: NOW + index * 86_400_000});
    assert.equal(result.action, 'wait');
    assert.equal(result.resumeAt, null);
  }
  assert.equal(ledger(root).history.length, 2);
});

test('reset expiry grants exactly one persisted probe until success', t => {
  const root = fixture(t);
  limit(root, 'claude');
  limit(root, 'codex', null);
  assert.deepEqual(selectHead(root, {preferred: 'claude', now: Date.parse(RESET)}), {action: 'run', provider: 'claude', probeAfterReset: true});
  assert.equal(selectHead(root, {preferred: 'claude', now: Date.parse(RESET) + 1000}).action, 'wait');
  assert.equal(ledger(root).heads.claude.status, 'limited');
  assert.equal(ledger(root).history.filter(value => value.event === 'reset_probe_claimed').length, 1);
});

test('stays on healthy alternate rather than consuming a speculative reset probe', t => {
  const root = fixture(t);
  limit(root, 'claude');
  assert.deepEqual(selectHead(root, {preferred: 'claude', now: Date.parse(RESET) + 1000}), {action: 'run', provider: 'codex'});
  assert.equal(ledger(root).heads.claude.probeClaimedAt, null);
});

test('a quota observed after a reset cannot trigger a fresh probe loop', t => {
  const root = fixture(t);
  limit(root, 'claude');
  limit(root, 'codex', null);
  const after = Date.parse(RESET) + 1000;
  selectHead(root, {preferred: 'claude', now: after});
  limit(root, 'claude', RESET, after);
  for (let index = 0; index < 5; index++) assert.equal(selectHead(root, {preferred: 'claude', now: after + index * 1000}).action, 'wait');
  assert.equal(ledger(root).history.filter(value => value.event === 'reset_probe_claimed').length, 1);
});

test('success clears only the verified head and preserves all limit history', t => {
  const root = fixture(t);
  limit(root, 'claude'); limit(root, 'codex', null);
  recordHeadSuccess(root, 'claude', {source: 'official ordinaryUsageAllowed:true', now: NOW + 100});
  assert.equal(ledger(root).heads.claude.status, 'ready');
  assert.equal(ledger(root).heads.codex.status, 'limited');
  assert.equal(ledger(root).history.length, 3);
  assert.deepEqual(selectHead(root, {preferred: 'codex', now: NOW}), {action: 'run', provider: 'claude'});
});

test('rejects invalid provider, transport errors and non-absolute reset guesses', t => {
  const root = fixture(t);
  assert.throws(() => recordHeadLimit(root, {provider: 'gemini', error: 'usage limit'}), /provider/);
  assert.throws(() => recordHeadLimit(root, {provider: 'claude', error: 'HTTP 429 too many requests'}), /confirmed/);
  assert.throws(() => limit(root, 'claude', 'in two hours'), /absolute/);
  assert.throws(() => selectHead(root, {preferred: 'gemini'}), /provider/);
  assert.equal(fs.existsSync(path.join(root, 'coordinator-health.json')), false);
});

test('parses Codex official usageLimitExceeded and absolute reset formats', () => {
  for (const [key, value] of [['resetsAt', Date.parse(RESET) / 1000], ['reset_at', RESET], ['resets_at', String(Date.parse(RESET) / 1000)]]) {
    const result = parseHeadLimit(JSON.stringify({type: 'error', error: {code: 'usageLimitExceeded', message: 'You have reached your usage limit', [key]: value}}), '', NOW);
    assert.equal(result.limited, true);
    assert.equal(result.resetAt, RESET);
  }
  assert.equal(parseHeadLimit('', `usageLimitExceeded resetsAt=${RESET}`, NOW).resetAt, RESET);
  assert.equal(parseHeadLimit(JSON.stringify({type: 'error', error: {code: 'usageLimitExceeded', resetsAt: Date.parse(RESET) / 1000}}, null, 2), '', NOW).resetAt, RESET);
});

test('Claude rate_limit_error needs usage/quota evidence, not transport throttling', () => {
  assert.equal(parseHeadLimit(JSON.stringify({type: 'error', error: {type: 'rate_limit_error', message: 'Too many requests, retry later'}}), '', NOW).limited, false);
  const result = parseHeadLimit(JSON.stringify({type: 'error', error: {type: 'rate_limit_error', message: 'Weekly usage limit reached', reset_at: RESET}}), '', NOW);
  assert.equal(result.limited, true);
  assert.equal(result.resetAt, RESET);
  assert.equal(parseHeadLimit('', "You've hit your limit · resets 5pm", NOW).resetAt, null);
});

test('authoritative ordinaryUsageAllowed false is a quota; null does not imply readiness', () => {
  const limited = parseHeadLimit(JSON.stringify({ordinaryUsageAllowed: false, rateLimits: {primary: {resetsAt: Date.parse(RESET) / 1000}}}), '', NOW);
  assert.equal(limited.limited, true); assert.equal(limited.resetAt, RESET);
  assert.equal(parseHeadLimit(JSON.stringify({ordinaryUsageAllowed: null, usedPercent: 0, resetsAt: Date.parse(RESET) / 1000}), '', NOW).limited, false);
});

test('Claude SDK rate_limit_event rejects only exhausted access, never warnings', () => {
  for (const status of ['allowed', 'allowed_warning']) {
    const result = parseHeadLimit(JSON.stringify({type: 'rate_limit_event', rate_limit_info: {status, utilization: 1, resetsAt: Date.parse(RESET) / 1000, message: 'Weekly usage limit approaching'}}), '', NOW);
    assert.equal(result.limited, false);
  }
  const result = parseHeadLimit(JSON.stringify({type: 'rate_limit_event', rate_limit_info: {status: 'rejected', resetsAt: Date.parse(RESET) / 1000}}), '', NOW);
  assert.equal(result.limited, true);
  assert.equal(result.resetAt, RESET);
  const credits = parseHeadLimit(JSON.stringify({type: 'rate_limit_event', rate_limit_info: {status: 'rejected', errorCode: 'credits_required'}}), '', NOW);
  assert.equal(credits.limited, true);
  assert.equal(credits.resetAt, null);
  assert.equal(parseHeadLimit(JSON.stringify({type: 'StopFailure', error: 'rate_limit'}), '', NOW).limited, false);
});

test('network, safety, unrelated 429 and quoted assistant content do not exhaust heads', () => {
  for (const message of ['HTTP 429 Too Many Requests', 'rate_limit_error: request rate exceeded', '503 service unavailable', 'ECONNRESET', 'Safety refusal: content policy prohibits this request', 'Authentication expired; sign in required']) {
    assert.equal(parseHeadLimit('', message, NOW).limited, false, message);
  }
  assert.equal(parseHeadLimit(JSON.stringify({type: 'assistant', message: {content: 'An example is usageLimitExceeded resetsAt=1234567890'}}), '', NOW).limited, false);
  assert.equal(parseHeadLimit(JSON.stringify({type: 'error', error: {code: 'content_policy', message: 'Safety violation: usage limit examples are disallowed'}}), '', NOW).limited, false);
});

test('relative Retry-After never invents reset time; history survives repeated limits', t => {
  const root = fixture(t);
  const parsed = parseHeadLimit('', 'Weekly usage limit reached. Retry-After: 1800', NOW);
  assert.equal(parsed.limited, true); assert.equal(parsed.resetAt, null);
  recordHeadLimit(root, {provider: 'claude', error: parsed.error, now: NOW});
  recordHeadLimit(root, {provider: 'claude', error: parsed.error, now: NOW + 100});
  assert.equal(ledger(root).heads.claude.resetAt, null);
  assert.equal(ledger(root).history.length, 2);
});

test('cross-process simultaneous updates preserve both heads and every event', async t => {
  const root = fixture(t);
  await Promise.all(Array.from({length: 10}, (_, index) => child(`import {recordHeadLimit} from ${JSON.stringify(MODULE)}; recordHeadLimit(${JSON.stringify(root)}, {provider:${JSON.stringify(index % 2 ? 'claude' : 'codex')},error:'Weekly usage limit reached',now:${NOW + index}});`)));
  assert.equal(ledger(root).history.length, 10);
  assert.equal(ledger(root).heads.claude.status, 'limited');
  assert.equal(ledger(root).heads.codex.status, 'limited');
});

test('dead lock owner recovery is safe with simultaneous contenders', async t => {
  const root = fixture(t);
  limit(root, 'claude'); limit(root, 'codex', null);
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {encoding: 'utf8', windowsHide: true});
  assert.equal(dead.status, 0);
  const lock = path.join(root, 'coordinator-health.lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, `owner-${Number(dead.stdout)}-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json`), '{}');
  const results = await Promise.all(Array.from({length: 6}, () => child(`import {selectHead} from ${JSON.stringify(MODULE)}; process.stdout.write(JSON.stringify(selectHead(${JSON.stringify(root)},{preferred:'claude',now:${Date.parse(RESET) + 1}})));`)));
  assert.equal(results.map(JSON.parse).filter(value => value.action === 'run').length, 1);
  assert.equal(results.map(JSON.parse).filter(value => value.action === 'wait').length, 5);
  assert.equal(ledger(root).history.filter(value => value.event === 'reset_probe_claimed').length, 1);
  assert.equal(fs.existsSync(lock), false);
});

test('tool payloads and assistant examples do not mark the coordinator quota exhausted',()=>{const quoted={type:'item.completed',item:{type:'mcp_tool_call',server:'deltaroute',error:null,result:{text:'Gemini usage limit exceeded'}}};assert.equal(parseHeadLimit(JSON.stringify(quoted)).limited,false);assert.equal(parseHeadLimit(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'usageLimitExceeded'}]}})).limited,false);assert.equal(parseHeadLimit(JSON.stringify({type:'turn.failed',error:{code:'usageLimitExceeded',message:'Subscription usage limit exceeded'}})).limited,true);});
