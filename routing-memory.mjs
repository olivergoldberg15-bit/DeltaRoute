import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';

const SOURCE = 'coordinator checkpoint';
const counters = ['inputTokens', 'freshInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'thinkingTokens', 'legacyReportedTokens'];
const clip = (value, length) => typeof value === 'string' ? value.slice(0, length) : null;
const finiteCount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
let lastClock = 0;

function eventDirectory(root) { return path.join(root, 'routing-memory', 'events'); }
function reportedCounters(usage) {
  if (!usage || typeof usage !== 'object') return null;
  return {
    available: usage.available === true,
    source: clip(usage.source, 160),
    ...Object.fromEntries(counters.map(key => [key, finiteCount(usage[key])])),
    interpretation: 'Provider-reported native counters; no cross-provider dollar comparison',
  };
}
function scopeSnapshot(audit, violated) {
  if (!audit && !violated) return null;
  const paths = value => Array.isArray(value) ? value.filter(x => typeof x === 'string').slice(0, 64).map(x => x.slice(0, 500)) : [];
  return {
    passed: violated ? false : typeof audit?.passed === 'boolean' ? audit.passed : null,
    changedPaths: paths(audit?.changedPaths),
    outside: paths(audit?.outside),
    scope: 'Reported file-scope audit; does not establish semantic correctness',
  };
}

/** Save only explicitly reviewed outcomes. Process success alone is not quality evidence. */
export function recordRoutingReview(root, job, {accepted, note, scopeViolation = false} = {}) {
  if (typeof accepted !== 'boolean') throw Error('Routing review requires an explicit accepted boolean');
  if (!job || typeof job.id !== 'string' || !job.id.trim() || job.id.length > 200) throw Error('Routing review requires a job ID');
  if (typeof job.provider !== 'string' || !job.provider.trim() || typeof job.category !== 'string' || !job.category.trim()) throw Error('Routing review requires provider and category');
  if (typeof scopeViolation !== 'boolean') throw Error('scopeViolation must be boolean');
  const violated = scopeViolation || job.scopeAudit?.passed === false;
  // Higher-resolution wall clock distinguishes rapid revisions without a shared mutable index.
  lastClock = Math.max(performance.timeOrigin + performance.now(), lastClock + 0.001);
  const event = {
    schemaVersion: 1,
    eventId: crypto.randomUUID(),
    jobId: job.id,
    provider: job.provider.slice(0, 100),
    model: typeof job.modelUsed === 'string' && job.modelUsed ? job.modelUsed.slice(0, 200) : 'account default',
    category: job.category.slice(0, 100),
    source: SOURCE,
    reviewedAt: new Date().toISOString(),
    reviewClock: lastClock,
    createdAt: clip(job.createdAt, 50),
    startedAt: clip(job.startedAt, 50),
    finishedAt: clip(job.finishedAt, 50),
    accepted,
    note: clip(note, 1000),
    scopeViolation: violated,
    scopeAudit: scopeSnapshot(job.scopeAudit, violated),
    tokenUsage: reportedCounters(job.tokenUsage),
  };
  const dir = eventDirectory(root);
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, event.eventId + '.json');
  const temporary = file + '.tmp';
  // A unique file per event avoids an append/overwrite race across independent jobs.
  try {
    fs.writeFileSync(temporary, JSON.stringify(event, null, 2), {flag: 'wx'});
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
  return {...event, artifact: file};
}

function reviewedJobs(root) {
  const dir = eventDirectory(root);
  let files;
  try { files = fs.readdirSync(dir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const jobs = new Map();
  const scopeHistory = new Set();
  const identity = event => JSON.stringify([event.jobId, event.provider, event.model, event.category]);
  for (const file of files) {
    if (!/^[a-f0-9-]{36}\.json$/.test(file)) continue;
    let event;
    try { event = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch { continue; }
    if (event.schemaVersion !== 1 || event.source !== SOURCE || typeof event.jobId !== 'string' || typeof event.provider !== 'string' || typeof event.model !== 'string' || typeof event.category !== 'string' || typeof event.accepted !== 'boolean' || !Number.isFinite(event.reviewClock)) continue;
    if (event.scopeViolation === true) scopeHistory.add(identity(event));
    const existing = jobs.get(event.jobId);
    if (!existing || event.reviewClock > existing.reviewClock || event.reviewClock === existing.reviewClock && event.eventId > existing.eventId) jobs.set(event.jobId, event);
  }
  return [...jobs.values()].map(event => ({...event, historicalScopeViolation: scopeHistory.has(identity(event))}));
}

/**
 * providers contains only caller-supplied candidates in recommended order.
 * evidence is per current configured model/category, deduplicated by reviewed job.
 * posteriorAcceptance uses a Beta(2,2) prior; scoreAdjustment is capped to +/-0.18.
 * This is coordinator feedback, not an independent model benchmark or cost estimate.
 */
export function rankCandidates(root, {category, candidates = [], workers = {}, minReviews = 3} = {}) {
  if (!Array.isArray(candidates) || candidates.some(x => typeof x !== 'string')) throw Error('Routing candidates must be provider names');
  if (!Number.isInteger(minReviews) || minReviews < 3) throw Error('Routing evidence requires at least three reviews');
  const definitions = Array.isArray(workers) ? Object.fromEntries(workers.map(worker => [worker.name, worker])) : workers || {};
  const events = reviewedJobs(root);
  const evidence = candidates.map((provider, configuredRank) => {
    const worker = definitions[provider] || {};
    const model = worker.models?.[category] || worker.model || 'account default';
    const matching = events.filter(event => event.provider === provider && event.model === model && event.category === category);
    const reviewed = matching.length;
    const accepted = matching.filter(event => event.accepted).length;
    const rejected = reviewed - accepted;
    const scopeViolations = matching.filter(event => event.historicalScopeViolation).length;
    const posteriorAcceptance = (accepted + 2) / (reviewed + 4);
    const eligible = reviewed >= minReviews;
    const adjustment = eligible ? Math.max(-0.18, Math.min(0.18, 0.5 * (posteriorAcceptance - 0.5) - 0.12 * scopeViolations / (reviewed + 4))) : 0;
    const nativeCounters = {};
    for (const key of counters) {
      const known = matching.map(event => finiteCount(event.tokenUsage?.[key])).filter(value => value !== null);
      nativeCounters[key] = known.length ? known.reduce((sum, value) => sum + value, 0) : null;
    }
    return {
      provider, model, category, reviewed, accepted, rejected, scopeViolations,
      configuredRank, eligible, posteriorAcceptance, scoreAdjustment: adjustment,
      score: -0.06 * configuredRank + adjustment,
      source: SOURCE,
      interpretation: 'Reviewed acceptance and rework for this configured model and category; not an independent benchmark',
      nativeCounters,
      lastReviewedAt: matching.length ? matching.reduce((latest, event) => event.reviewClock > latest.reviewClock ? event : latest).reviewedAt : null,
    };
  });
  const learned = evidence.some(item => item.eligible);
  return {
    providers: learned ? [...evidence].sort((a, b) => b.score - a.score || a.configuredRank - b.configuredRank).map(item => item.provider) : [...candidates],
    evidence,
    mode: learned ? 'reviewed_outcomes' : 'configured_specialties',
  };
}
