/** Local coordinator quota ledger. Reset timestamps authorize one probe, never recovery. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicWriteJSON,renameWithRetry} from './state-file.mjs';

const HEADS = ['claude', 'codex'];
const MARKER = /^owner-([1-9]\d*)-([a-f0-9-]+)\.json$/;
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function providerName(provider) {
  if (!HEADS.includes(provider)) throw new TypeError('Coordinator provider must be claude or codex');
  return provider;
}

function clock(now = Date.now()) {
  const value = now instanceof Date ? now.getTime() : typeof now === 'string' ? Date.parse(now) : now;
  if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) throw new TypeError('Invalid coordinator clock');
  return value;
}

/** Only absolute provider timestamps; no Retry-After or guessed timezone conversion. */
function timestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  let milliseconds;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value))) {
    milliseconds = Number(value) * 1000;
  } else if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/i.test(value)) {
    milliseconds = Date.parse(value);
  }
  return Number.isFinite(milliseconds) && Number.isFinite(new Date(milliseconds).getTime())
    ? new Date(milliseconds).toISOString() : null;
}

function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child, visit);
}

function resetIn(value) {
  let found = null;
  walk(value, node => {
    for (const [key, raw] of Object.entries(node)) {
      if (/^(?:resetsAt|resetAt|resets_at|reset_at)$/i.test(key)) {
        const parsed = timestamp(raw);
        // Multiple applicable windows cannot safely resume before the latest one.
        if (parsed && (!found || parsed > found)) found = parsed;
      }
    }
  });
  return found;
}

const HARD_USAGE = /\busage[ _-]?(?:limit|quota)(?:[ _-]?(?:exceeded|reached))?\b|\b(?:weekly|daily|monthly|subscription|five[- ]hour|5[- ]hour)\s+(?:usage\s+)?(?:limit|quota|allowance)\b|\bquota\s+(?:exceeded|exhausted|reached)\b|\b(?:exceeded|exhausted|reached)\s+(?:your\s+|the\s+)?(?:usage\s+)?quota\b|you(?:'|’)ve hit your (?:usage )?limit|\b(?:subscription|usage) allowance (?:exhausted|reached)\b/i;
const NOT_QUOTA = /\bcontent[_ -]policy\b|\bsafety[_ -](?:error|violation|refusal)\b|\bpermission denied\b|\bauthentication (?:failed|required|expired)\b/i;

function inspectError(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let officialUsage = false, claudeRate = false, deniedUsage = false, rejectedRateEvent = false;
  if (value && typeof value === 'object') walk(value, node => {
    if (node.type === 'rate_limit_event' && node.rate_limit_info?.status === 'rejected') rejectedRateEvent = true;
    for (const [key, raw] of Object.entries(node)) {
      if (/^(?:code|error_code|errorType|type)$/i.test(key) && typeof raw === 'string') {
        if (/^usage[_-]?limit[_-]?(?:exceeded|reached)$/i.test(raw)) officialUsage = true;
        if (raw === 'rate_limit_error') claudeRate = true;
      }
      if (key === 'ordinaryUsageAllowed' && raw === false) deniedUsage = true;
    }
  });
  if (value?.type === 'rate_limit_event' && value.rate_limit_info?.status !== 'rejected') return null;
  // Raw native errors sometimes contain the official code outside JSON.
  if (typeof value === 'string' && /\busageLimitExceeded\b|\busage_limit_exceeded\b/.test(text)) officialUsage = true;
  const hardUsage = HARD_USAGE.test(text);
  const limited = !NOT_QUOTA.test(text) && (officialUsage || deniedUsage || rejectedRateEvent || hardUsage);
  if (!limited || (claudeRate && !hardUsage && !deniedUsage && !rejectedRateEvent)) return null;
  let resetAt = typeof value === 'object' ? resetIn(value) : null;
  if (!resetAt) {
    // Explicit key/value timestamps in human-readable native errors remain absolute.
    const expression = /\b(?:resetsAt|resetAt|resets_at|reset_at)\s*[=:]\s*["']?(\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)|[0-9]+(?:\.[0-9]+)?)/ig;
    for (const match of text.matchAll(expression)) {
      const candidate = timestamp(match[1]);
      if (candidate && (!resetAt || candidate > resetAt)) resetAt = candidate;
    }
  }
  return {limited: true, resetAt, error: text.slice(0, 8000)};
}

/** Parse native errors, not transport throttling or model recollections of quotas. */
export function parseHeadLimit(stdout = '', stderr = '', now = Date.now()) {
  clock(now);
  const matches = [];
  const inspectParsed = parsed => {
    if (typeof parsed === 'string') {
      const result = inspectError(parsed); if (result) matches.push(result);
    } else {
      // Only native top-level errors are coordinator evidence. Tool/source/assistant
      // payloads may quote another provider's quota and must not disable this head.
      const type=String(parsed?.type||parsed?.code||parsed?.errorType||'');
      const native=/^(?:error|turn\.failed|usage[_-]?limit(?:exceeded|reached)?|rate_limit_error|rate_limit_event)$/i.test(type)||parsed?.is_error===true||parsed?.ordinaryUsageAllowed===false||!type&&parsed?.error;
      if(native){const result=inspectError(parsed);if(result)matches.push(result);}

    }
  };
  for (const stream of [stdout, stderr]) {
    const supplied = typeof stream === 'string' ? stream : JSON.stringify(stream ?? '');
    try { inspectParsed(JSON.parse(supplied)); continue; } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    for (const line of supplied.split(/\r?\n/).filter(Boolean)) {
      let parsed;
      try { parsed = JSON.parse(line); } catch {
        const result = inspectError(line); if (result) matches.push(result);
        continue;
      }
      inspectParsed(parsed);
    }
  }
  if (!matches.length) return {limited: false, resetAt: null, error: ''};
  const resetAt = matches.map(value => value.resetAt).filter(Boolean).sort().at(-1) || null;
  return {...matches[0], resetAt};
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

/**
 * Acquire a ready, nonempty directory atomically. A reaper first renames the unique
 * dead-owner marker, so simultaneous reapers cannot delete a successor's lock.
 * No time-based stale eviction: an alive owner is never stolen after a timeout.
 */
function locked(root, operation) {
  const directory = path.resolve(root);
  fs.mkdirSync(directory, {recursive: true});
  const lock = path.join(directory, 'coordinator-health.lock');
  const token = crypto.randomUUID();
  const marker = `owner-${process.pid}-${token}.json`;
  const staging = path.join(directory, `.coordinator-lock-${token}`);
  fs.mkdirSync(staging);
  fs.writeFileSync(path.join(staging, marker), JSON.stringify({pid: process.pid, token, createdAt: new Date().toISOString()}));
  let acquired = false;
  const deadline = Date.now() + 10_000;
  const dispose = target => fs.rmSync(target, {recursive: true, force: true});
  try {
    while (!acquired) {
      try { fs.renameSync(staging, lock); acquired = true; break; } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
        if (!fs.existsSync(lock)) { if (Date.now() >= deadline) throw error; sleep(20); continue; }
      }
      let files;
      try { files = fs.readdirSync(lock); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      // Windows can finish enumeration on a directory just released and removed
      // by its owner. Retry that observation; never evict an unconfirmed owner.
      if (files.length === 0 && Date.now() < deadline) { sleep(20); continue; }
      if (files.length !== 1 || !MARKER.test(files[0])) throw new Error('Coordinator lock ownership is unreadable; refusing unsafe recovery');
      const owner = files[0].match(MARKER);
      if (!processAlive(Number(owner[1]))) {
        const claim = `owner-${process.pid}-${crypto.randomUUID()}.json`;
        try { fs.renameSync(path.join(lock, files[0]), path.join(lock, claim)); } catch (error) {
          if (['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) continue;
          throw error;
        }
        const grave = path.join(directory, `.coordinator-reaped-${crypto.randomUUID()}`);
        // Already gone: another contender moved it away. Nothing of ours is left in it, so try again.
        try { renameWithRetry(lock, grave); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
        dispose(grave);
        continue;
      }
      if (Date.now() >= deadline) throw new Error('Coordinator health ledger is busy; no model was launched');
      sleep(20);
    }
    return operation(path.join(directory, 'coordinator-health.json'));
  } finally {
    if (acquired && fs.existsSync(path.join(lock, marker))) {
      const released = path.join(directory, `.coordinator-released-${token}`);
      renameWithRetry(lock, released);
      dispose(released);
    }
    if (!acquired && fs.existsSync(staging)) dispose(staging);
  }
}

function read(file) {
  if (!fs.existsSync(file)) return {version: 1, heads: {claude: {status: 'ready'}, codex: {status: 'ready'}}, history: []};
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (state.version !== 1 || !state.heads || !HEADS.every(name => state.heads[name]) || !Array.isArray(state.history)) throw new Error('Invalid coordinator health ledger; refusing to infer readiness');
  for (const name of HEADS) if (!['ready', 'limited'].includes(state.heads[name].status)) throw new Error('Invalid coordinator health status');
  return state;
}

/** Store only confirmed usage exhaustion. Unknown reset times stay unknown. */
export function recordHeadLimit(root, {provider, error, resetAt, now = Date.now()} = {}) {
  providerName(provider);
  const instant = clock(now), at = new Date(instant).toISOString();
  const parsed = parseHeadLimit(error, '', instant);
  if (!parsed.limited) throw new TypeError('Only a confirmed hard usage or quota error can block a coordinator');
  const reset = resetAt === undefined ? parsed.resetAt : timestamp(resetAt);
  if (resetAt !== undefined && resetAt !== null && !reset) throw new TypeError('resetAt must be an absolute ISO timestamp or Unix seconds');
  return locked(root, file => {
    const state = read(file);
    const previous = state.heads[provider];
    const sameReset = previous.status === 'limited' && previous.resetAt === reset;
    state.heads[provider] = {
      status: 'limited', limitedAt: at, resetAt: reset, error: parsed.error,
      probeClaimedAt: sameReset ? previous.probeClaimedAt || null : null,
      // A quota error observed at/after a reset proves that timestamp did not restore access.
      observedAfterReset: reset ? instant >= Date.parse(reset) : false,
    };
    state.history.push({event: 'limit', provider, at, resetAt: reset, error: parsed.error});
    atomicWriteJSON(file, state);
    return state.heads[provider];
  });
}

/** Known reset expiry grants at most one persisted probe, not a healthy state. */
export function selectHead(root, {preferred = 'claude', now = Date.now()} = {}) {
  providerName(preferred);
  const instant = clock(now), order = [preferred, ...HEADS.filter(value => value !== preferred)];
  return locked(root, file => {
    const state = read(file);
    const ready = order.find(name => state.heads[name].status === 'ready');
    if (ready) return {action: 'run', provider: ready};
    const probe = order.find(name => {
      const head = state.heads[name];
      return head.resetAt && Date.parse(head.resetAt) <= instant && !head.probeClaimedAt && !head.observedAfterReset;
    });
    if (probe) {
      const at = new Date(instant).toISOString();
      state.heads[probe].probeClaimedAt = at;
      state.history.push({event: 'reset_probe_claimed', provider: probe, at, resetAt: state.heads[probe].resetAt});
      atomicWriteJSON(file, state);
      return {action: 'run', provider: probe, probeAfterReset: true};
    }
    const future = HEADS.map(name => state.heads[name].resetAt).filter(value => value && Date.parse(value) > instant).sort();
    const probeUsed = HEADS.some(name => state.heads[name].probeClaimedAt);
    return {
      action: 'wait', resumeAt: future[0] || null,
      reason: probeUsed
        ? 'Both coordinators remain quota-blocked. A reset probe has already been claimed; wait for observed success or authoritative usage readiness.'
        : 'Both coordinators are quota-blocked. Wait for a reported reset, observed success, or authoritative usage readiness; unknown reset times are not guessed.',
    };
  });
}

/** Call only after observed success or authoritative ordinaryUsageAllowed:true. */
export function recordHeadSuccess(root, provider, {source = 'observed_success', now = Date.now()} = {}) {
  providerName(provider);
  const at = new Date(clock(now)).toISOString();
  return locked(root, file => {
    const state = read(file);
    state.heads[provider] = {status: 'ready', verifiedAt: at, source: String(source).slice(0, 300)};
    state.history.push({event: 'success', provider, at, source: String(source).slice(0, 300)});
    atomicWriteJSON(file, state);
    return state.heads[provider];
  });
}
