/**
 * Capability registry. Every model carries editable 0-100 scores per capability, and each
 * role in the Chief > OP > route lead > agent > sub-agent tree goes to the best available
 * model whose tier allows it. Shipped defaults live in models.json; approved local changes
 * live in routing-memory/model-registry.json so a reinstall cannot wipe them.
 * A weekly benchmark check (benchmark-news.mjs) applies cited score changes on its own, in small capped
 * steps, each logged and undoable. Bigger edits (tiers, new models) still go through propose and an apply
 * that quotes the user's approval.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicWriteJSON} from './state-file.mjs';

export const CAPABILITIES = ['planning', 'coding', 'review', 'research', 'visual', 'large_context', 'speed', 'cost_efficiency'];
const TIERS = ['top', 'mid', 'cheap'];
export const STALE_DAYS = 14;

// Chief must be the host running the conversation; the rest go to whoever scores best.
export const ROLES = Object.freeze({
  chief: {tiers: ['top'], host: 'only', weights: {planning: .4, review: .4, coding: .2}},
  op: {tiers: ['top'], weights: {planning: .7, large_context: .3}},
  route_lead: {tiers: ['top'], weights: {planning: .4, coding: .4, review: .2}},
  review: {tiers: ['top'], weights: {review: .8, planning: .2}},
  simulated_review: {tiers: ['top'], weights: {review: .6, visual: .4}},
  agent: {tiers: ['top', 'mid'], host: 'never', weights: null},
  sub_agent: {tiers: ['cheap'], host: 'never', weights: {speed: .4, cost_efficiency: .4, coding: .2}},
});

// Agents are picked for the job in front of them, and offloading from the host is part of the fit.
const AGENT_WEIGHTS = {
  research: {research: .8, cost_efficiency: .2},
  social_research: {research: .8, cost_efficiency: .2},
  video_analysis: {visual: .8, cost_efficiency: .2},
  frontend: {coding: .5, visual: .3, cost_efficiency: .2},
  large_context: {large_context: .6, coding: .2, cost_efficiency: .2},
  quick_coding: {coding: .5, speed: .3, cost_efficiency: .2},
  iteration: {coding: .5, speed: .3, cost_efficiency: .2},
  review: {review: .8, cost_efficiency: .2},
  summarization: {large_context: .4, speed: .4, cost_efficiency: .2},
};
const DEFAULT_AGENT = {coding: .7, review: .1, cost_efficiency: .2};
const RESEARCH_ONLY = new Set(['perplexity', 'grok', 'muse']);

const localFile = root => path.join(root, 'routing-memory', 'model-registry.json');
const proposalFile = (root, id) => {
  if (!/^[a-f0-9-]{36}$/.test(String(id))) throw Error('Invalid proposal ID');
  return path.join(root, 'routing-memory', 'model-proposals', id + '.json');
};
const readJSON = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

function validModel(m) {
  if (!m || typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,80}$/.test(m.id)) throw Error('Invalid registry model ID');
  if (typeof m.provider !== 'string' || !m.provider) throw Error('Registry model needs a provider: ' + m.id);
  if (!TIERS.includes(m.tier)) throw Error('Invalid tier for ' + m.id);
  for (const c of CAPABILITIES) {
    const v = m.scores?.[c];
    if (!Number.isInteger(v) || v < 0 || v > 100) throw Error('Score ' + c + ' for ' + m.id + ' must be an integer 0-100');
  }
  return m;
}

/** Shipped defaults overlaid with approved local changes. */
export function loadRegistry(root) {
  const base = JSON.parse(fs.readFileSync(path.join(root, 'models.json'), 'utf8'));
  const local = readJSON(localFile(root), {models: [], removed: [], live: {}});
  const byId = new Map(base.models.map(m => [m.id, m]));
  for (const m of local.models || []) byId.set(m.id, {...byId.get(m.id), ...m, scores: {...byId.get(m.id)?.scores, ...m.scores}});
  for (const id of local.removed || []) byId.delete(id);
  const models = [...byId.values()].map(validModel);
  const updatedAt = [base.updatedAt, local.updatedAt, local.refreshedAt].filter(Boolean).sort().at(-1);
  return {models, updatedAt, live: local.live || {}};
}

export function registryAge(registry, now = Date.now()) {
  const days = Math.floor((now - Date.parse(registry.updatedAt)) / 86_400_000);
  return {updatedAt: registry.updatedAt, days, stale: !(days <= STALE_DAYS),
    warning: days <= STALE_DAYS ? null : 'Model registry is ' + days + ' days old. Run model_registry refresh and review the proposal.'};
}

const weighted = (scores, weights) => Object.entries(weights).reduce((sum, [c, w]) => sum + w * scores[c], 0);

function availability(m, {coordinator, workers, live}) {
  if (m.provider === coordinator) return {available: true, execution: 'host'};
  if (m.provider === 'claude-native') return coordinator === 'claude' ? {available: true, execution: 'host_subagent'} : {available: false, reason: 'native subagent needs the Claude host'};
  if (m.provider === 'claude') return coordinator === 'muse' ? {available: true, execution: 'coordinator'} : {available: false, reason: 'Claude is not the host; no Claude worker transport'};
  const w = workers.find(x => x.name === m.provider);
  if (!w?.enabled || w.installed === false) return {available: false, reason: m.provider + ' worker not enabled or installed'};
  if (w.availableNow === false) return {available: false, reason: m.provider + ' cooling down'};
  const listed = live[m.provider]?.models;
  if (m.model && Array.isArray(listed) && !listed.includes(m.model)) return {available: false, reason: m.model + ' missing from the live model list'};
  return {available: true, execution: 'worker'};
}

/** Best available model for one role. Returns the pick plus up to two runners-up. */
export function assignRole(registry, role, {category = 'implementation', coordinator = 'claude', workers = []} = {}) {
  const spec = ROLES[role];
  if (!spec) throw Error('Unknown role ' + role);
  const weights = spec.weights || AGENT_WEIGHTS[category] || DEFAULT_AGENT;
  const research = ['research', 'social_research'].includes(category);
  const ranked = registry.models.map(m => ({m, a: availability(m, {coordinator, workers, live: registry.live})}))
    .filter(({m, a}) => a.available && spec.tiers.includes(m.tier))
    .filter(({a}) => spec.host === 'only' ? a.execution === 'host' : spec.host === 'never' ? a.execution !== 'host' : true)
    .filter(({m}) => role === 'agent' && RESEARCH_ONLY.has(m.provider) ? research : true)
    .map(({m, a}) => ({id: m.id, provider: m.provider, model: m.model, label: m.label, tier: m.tier, execution: a.execution, fit: Math.round(weighted(m.scores, weights))}))
    .sort((x, y) => y.fit - x.fit || TIERS.indexOf(x.tier) - TIERS.indexOf(y.tier));
  return {role, pick: ranked[0] || null, alternatives: ranked.slice(1, 3)};
}

export function assignRoles(registry, options = {}) {
  return Object.fromEntries(Object.keys(ROLES).map(role => [role, assignRole(registry, role, options)]));
}

// Head first: the head keeps the work unless a worker is clearly better at this kind of work (was Claude first, Oliver, 2026-11-01; head is Muse from 2026-11-04 when coordinator='muse').
export const CAPABILITY_FOR = {implementation: 'coding', quick_coding: 'coding', iteration: 'coding', debugging: 'coding', tests: 'coding', frontend: 'visual', creative: 'visual', review: 'review', planning: 'planning', simple: 'planning', large_context: 'large_context', summarization: 'large_context'};

/** keep=true when the host's score for this category is within `margin` of the best available worker's. */
export function delegationVerdict(registry, {category = 'implementation', coordinator = 'claude', workers = [], margin = 5} = {}) {
  const capability = CAPABILITY_FOR[category] || 'coding';
  const host = registry.models.filter(m => m.provider === coordinator).sort((a, b) => b.scores[capability] - a.scores[capability])[0];
  if (!host) return {keep: false, capability, reason: 'The host is not in the registry; use the worker ranking.'};
  const best = registry.models.map(m => ({m, a: availability(m, {coordinator, workers, live: registry.live})}))
    .filter(({m, a}) => a.available && a.execution === 'worker' && !RESEARCH_ONLY.has(m.provider))
    .sort((x, y) => y.m.scores[capability] - x.m.scores[capability])[0]?.m;
  if (!best) return {keep: true, capability, reason: `No worker is available for ${capability}; ${host.label} does it.`};
  const gap = best.scores[capability] - host.scores[capability];
  return gap >= margin
    ? {keep: false, capability, worker: best.id, provider: best.provider, gap, reason: `${best.label} scores ${best.scores[capability]} on ${capability} against ${host.label}'s ${host.scores[capability]}: delegate.`}
    : {keep: true, capability, bestWorker: best.id, gap, reason: `${host.label} scores ${host.scores[capability]} on ${capability}; the best worker (${best.label}) scores ${best.scores[capability]}. ${host.label} keeps it (a worker must lead by ${margin} or more).`};
}

const changesFile = root => path.join(root, 'routing-memory', 'registry-changes.jsonl');

/**
 * Applies cited benchmark changes on their own (Oliver chose auto-apply, 2026-11-01). Each change moves one score by
 * at most maxStep points, needs a source URL and a date no older than maxAgeDays, and is logged with an id for undo.
 * A source must be on a site the research job actually visited, so an invented link cannot move a score.
 */
export function applyBenchmarkChanges(root, changes, {taskId = null, visitedHosts = null, maxStep = 10, maxAgeDays = 60, now = Date.now()} = {}) {
  const local = readJSON(localFile(root), {models: [], removed: [], live: {}});
  const current = new Map(loadRegistry(root).models.map(m => [m.id, m]));
  const applied = [], skipped = [], touched = new Set();
  for (const c of Array.isArray(changes) ? changes : []) {
    const why = (() => {
      if (!current.has(c?.id)) return 'unknown model';
      if (!CAPABILITIES.includes(c.capability)) return 'unknown capability';
      if (touched.has(c.id + '|' + c.capability)) return 'one change per score per check';
      let host;
      try { host = new URL(c.source_url).hostname.replace(/^www\./, ''); } catch { return 'no valid source_url'; }
      if (!/^https?:/.test(c.source_url)) return 'no valid source_url';
      if (visitedHosts && !visitedHosts.some(h => host === h || host.endsWith('.' + h) || h.endsWith('.' + host))) return 'source not among the pages the research visited';
      const age = (now - Date.parse(c.source_date)) / 86_400_000;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(c.source_date || '') || !(age >= -1 && age <= maxAgeDays)) return `source date missing or older than ${maxAgeDays} days`;
      const points = Math.round(Number(c.points));
      if (!(points >= 1) || !['up', 'down'].includes(c.direction)) return 'direction up/down and points 1+ needed';
      return null;
    })();
    if (why) { skipped.push({id: c?.id, capability: c?.capability, why}); continue; }
    const model = current.get(c.id), from = model.scores[c.capability];
    const step = Math.min(maxStep, Math.round(Number(c.points)));
    const to = Math.max(0, Math.min(100, from + (c.direction === 'up' ? step : -step)));
    if (to === from) { skipped.push({id: c.id, capability: c.capability, why: 'already at the limit'}); continue; }
    const next = {...model, scores: {...model.scores, [c.capability]: to}};
    local.models = [...(local.models || []).filter(x => x.id !== c.id), next];
    current.set(c.id, next); touched.add(c.id + '|' + c.capability);
    const change = {changeId: crypto.randomUUID().slice(0, 8), at: new Date(now).toISOString(), id: c.id, capability: c.capability, from, to, source_url: c.source_url, source_date: c.source_date, note: String(c.note || '').slice(0, 300), taskId};
    applied.push(change);
  }
  if (applied.length) {
    local.updatedAt = new Date(now).toISOString().slice(0, 10);
    fs.mkdirSync(path.dirname(localFile(root)), {recursive: true});
    atomicWriteJSON(localFile(root), local);
    fs.appendFileSync(changesFile(root), applied.map(c => JSON.stringify(c)).join('\n') + '\n');
  }
  return {applied, skipped};
}

/** Reverses one auto-applied change, if that score has not moved since. */
export function undoBenchmarkChange(root, changeId) {
  let log = [];
  try { log = fs.readFileSync(changesFile(root), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch {}
  const change = log.find(c => c.changeId === changeId && !c.undone);
  if (!change || log.some(c => c.changeId === changeId && c.undone)) throw Error('No auto-applied change with that id (or it was already undone)');
  const local = readJSON(localFile(root), {models: [], removed: [], live: {}});
  const model = loadRegistry(root).models.find(m => m.id === change.id);
  if (!model || model.scores[change.capability] !== change.to) throw Error('That score has changed since; edit it with propose/apply instead');
  local.models = [...(local.models || []).filter(x => x.id !== change.id), {...model, scores: {...model.scores, [change.capability]: change.from}}];
  atomicWriteJSON(localFile(root), local);
  fs.appendFileSync(changesFile(root), JSON.stringify({changeId, undone: true, at: new Date().toISOString()}) + '\n');
  return {undone: change};
}

/** Auto-applied changes, newest last, with undone ones marked. */
export function benchmarkChanges(root, {limit = 20} = {}) {
  let rows = [];
  try { rows = fs.readFileSync(changesFile(root), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch {}
  const undone = new Set(rows.filter(r => r.undone).map(r => r.changeId));
  return rows.filter(r => !r.undone).map(r => ({...r, undone: undone.has(r.changeId)})).slice(-limit);
}

/**
 * Compare the registry with live CLI model lists and turn the gaps into a proposal.
 * Cited news changes are added by the coordinator (propose) and still wait for approval.
 */
export function createProposal(root, {live = {}, changes = [], rationale = ''} = {}) {
  const registry = loadRegistry(root);
  const items = [];
  for (const [provider, info] of Object.entries(live)) {
    if (!Array.isArray(info?.models)) continue;
    const known = new Set(registry.models.filter(m => m.provider === provider).map(m => m.model));
    for (const model of info.models) if (!known.has(model)) items.push({kind: 'new_model', provider, model, note: 'Listed by the ' + provider + ' CLI but not in the registry. Needs scores and a tier before it can be assigned.'});
    for (const m of registry.models.filter(x => x.provider === provider && x.model && !info.models.includes(x.model))) items.push({kind: 'missing_model', id: m.id, note: m.model + ' no longer appears in the live list.'});
  }
  for (const change of changes) {
    if (!change || typeof change.id !== 'string') throw Error('Each change needs a registry model id');
    const cited = /^https?:\/\//.test(change.source_url || '') && /^\d{4}-\d{2}-\d{2}$/.test(change.source_date || '');
    if (!cited) throw Error('Score or tier changes need source_url and source_date (YYYY-MM-DD): ' + change.id);
    items.push({kind: 'change', id: change.id, set: change.set || {}, source_url: change.source_url, source_date: change.source_date, note: String(change.note || '').slice(0, 500)});
  }
  const id = crypto.randomUUID();
  const proposal = {id, createdAt: new Date().toISOString(), status: 'awaiting_user_approval', rationale: String(rationale).slice(0, 2000), live, items};
  fs.mkdirSync(path.dirname(proposalFile(root, id)), {recursive: true});
  atomicWriteJSON(proposalFile(root, id), proposal);
  return proposal;
}

/** Apply a proposal only with the user's own approval quoted. Unscored new models stay out. */
export function applyProposal(root, id, {approvedByUser, additions = []} = {}) {
  if (typeof approvedByUser !== 'string' || approvedByUser.trim().length < 2) throw Error('Quote the user\'s approval in approved_by_user; the registry never changes on news alone');
  const file = proposalFile(root, id);
  const proposal = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (proposal.status !== 'awaiting_user_approval') throw Error('Proposal is already ' + proposal.status);
  const local = readJSON(localFile(root), {models: [], removed: [], live: {}});
  const upsert = m => { local.models = [...(local.models || []).filter(x => x.id !== m.id), m]; };
  const current = new Map(loadRegistry(root).models.map(m => [m.id, m]));
  for (const item of proposal.items) {
    if (item.kind === 'change') {
      const base = current.get(item.id);
      if (!base) throw Error('Unknown registry model ' + item.id);
      const next = validModel({...base, ...item.set, scores: {...base.scores, ...item.set.scores}, source: (item.note ? item.note + ' ' : '') + item.source_url + ' (' + item.source_date + ')'});
      upsert(next); current.set(next.id, next);
    }
  }
  for (const m of additions) {
    const listed = proposal.items.some(i => i.kind === 'new_model' && i.provider === m.provider && i.model === m.model);
    if (!listed) throw Error('Additions must come from this proposal\'s new_model items');
    upsert(validModel(m));
  }
  local.live = {...local.live, ...proposal.live};
  local.updatedAt = new Date().toISOString().slice(0, 10);
  atomicWriteJSON(localFile(root), local);
  atomicWriteJSON(file, {...proposal, status: 'applied', appliedAt: new Date().toISOString(), approvedByUser: approvedByUser.trim().slice(0, 500)});
  return {changed: proposal.items.filter(i => i.kind === 'change').length, added: additions.map(m => m.id), registry: registryAge(loadRegistry(root))};
}

/** Record live model lists without touching scores. Only a refresh with nothing to approve clears the stale warning. */
export function recordLiveModels(root, live, {nothingToApprove = false} = {}) {
  const local = readJSON(localFile(root), {models: [], removed: [], live: {}});
  local.live = {...local.live, ...live};
  if (nothingToApprove) local.refreshedAt = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(path.dirname(localFile(root)), {recursive: true});
  atomicWriteJSON(localFile(root), local);
}

/** Parse `agy models` output: "<id>\t<label>" per line. */
export function parseAgyModels(text) {
  return String(text || '').split(/\r?\n/).map(l => l.split('\t')[0].trim()).filter(id => /^[a-z0-9][a-z0-9._-]+$/.test(id));
}
