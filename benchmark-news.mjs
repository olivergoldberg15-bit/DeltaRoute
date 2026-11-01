// The weekly benchmark check. Once a week (or on model_registry news) DeltaRoute sends a research job to the live-web
// workers (Perplexity, Grok, Muse) asking what recent benchmarks and release news say about each registry model,
// then applies the cited changes itself through applyBenchmarkChanges: small steps, sources the research really
// visited, logged and undoable. The next list_workers or recommend_route shows what changed.
import fs from 'node:fs';
import path from 'node:path';
import {atomicWriteJSON} from './state-file.mjs';
import {CAPABILITIES, applyBenchmarkChanges} from './registry.mjs';

const stateFile = root => path.join(root, 'routing-memory', 'benchmark-news.json');
const readState = root => { try { return JSON.parse(fs.readFileSync(stateFile(root), 'utf8')); } catch { return {}; } };
const writeState = (root, state) => { fs.mkdirSync(path.dirname(stateFile(root)), {recursive: true}); atomicWriteJSON(stateFile(root), state); };

export function newsDue(root, {everyDays = 7, now = Date.now()} = {}) {
  const s = readState(root);
  if (s.pendingTaskId) return false;
  return !s.checkedAt || now - Date.parse(s.checkedAt) >= everyDays * 86_400_000;
}

export function newsPrompt(registry, {now = new Date()} = {}) {
  const models = registry.models.map(m => `${m.id}: ${m.label} (${CAPABILITIES.map(c => c + ' ' + m.scores[c]).join(', ')})`).join('\n');
  return [`Today is ${now.toISOString().slice(0, 10)}. Find benchmark results, leaderboards and release news from the last 60 days about how these AI models compare at each capability. Prefer independent leaderboards (LMArena, SWE-bench, Aider, Artificial Analysis, Terminal-Bench, Vellum) and official release posts.`,
    'Models and their current 0-100 scores:\n' + models,
    'Capabilities: ' + CAPABILITIES.join(', ') + '. coding means agentic software engineering; research means finding current facts on the live web; visual means judging and making visual output.',
    'Then list only changes the evidence clearly supports, one JSON object per line and nothing else after the list:',
    '{"id":"<model id from the list>","capability":"<capability>","direction":"up|down","points":1-10,"source_url":"<page you read>","source_date":"YYYY-MM-DD","note":"what the source shows, in one sentence"}',
    'No change without a source you actually read. Do not invent URLs or dates.'].join('\n\n');
}

/**
 * The change objects in a research answer (one JSON object per line, anywhere in the text). Perplexity renders a URL
 * inside the JSON as a link on its own line ("source_url":"\nhttps://...\n"), which is invalid JSON as written
 * (2026-11-01: 0 of its changes parsed), so whitespace next to quotes and line breaks are removed first.
 */
export function parseNewsChanges(text) {
  const changes = [];
  for (const m of String(text || '').matchAll(/\{[^{}]*"capability"[^{}]*\}/g)) {
    try { changes.push(JSON.parse(m[0].replace(/"\s+/g, '"').replace(/\s+"/g, '"').replace(/[\r\n]+/g, ' '))); } catch {}
  }
  return changes;
}

/**
 * Called on list_workers, recommend_route and model_registry roles. Applies a finished check once, starts a new one
 * when due, and returns any changes not yet shown. submit(args) launches a DeltaRoute research job; readJob reads one.
 */
export async function serviceNews(root, {registry, cfg = {}, submit, readJob, now = Date.now(), force = false}) {
  const opts = cfg.benchmarks || {};
  if (opts.autoApply === false && !force) return null;
  const state = readState(root);
  let result = null;
  if (state.pendingTaskId) {
    let job = null;
    try { job = readJob(state.pendingTaskId); } catch {}
    if (job && !['queued', 'running'].includes(job.status)) {
      const hosts = [...new Set([...(job.sources || []), ...(job.researchPacket?.sources || [])].map(s => { try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch { return null; } }).filter(Boolean))];
      const outcome = job.status === 'completed' ? applyBenchmarkChanges(root, parseNewsChanges(job.answer), {taskId: job.id, visitedHosts: hosts, maxStep: opts.maxStep ?? 10, maxAgeDays: opts.maxSourceAgeDays ?? 60, now}) : {applied: [], skipped: []};
      writeState(root, {checkedAt: new Date(now).toISOString(), lastTaskId: job.id, lastStatus: job.status, unseen: [...(state.unseen || []), ...outcome.applied], skipped: outcome.skipped.slice(0, 20)});
      result = {checked: true, status: job.status, applied: outcome.applied.length, skipped: outcome.skipped.length};
    } else if (!job) writeState(root, {...state, pendingTaskId: null});
  }
  if (force || newsDue(root, {everyDays: opts.everyDays ?? 7, now})) {
    try {
      const job = await submit({task: newsPrompt(registry, {now: new Date(now)}), category: 'research', mode: 'read-only', provider: 'auto', context: 'DeltaRoute weekly benchmark check; the answer updates routing scores.'});
      writeState(root, {...readState(root), pendingTaskId: job.id, startedAt: new Date(now).toISOString()});
      result = {...(result || {}), started: job.id};
    } catch (e) {
      // No research worker right now: try again next week rather than every call.
      writeState(root, {...readState(root), checkedAt: new Date(now).toISOString(), lastStatus: 'not_started', lastError: e.message.slice(0, 300)});
      result = {...(result || {}), notStarted: e.message.slice(0, 300)};
    }
  }
  return result;
}

/** Changes applied since the user last saw them; showing them marks them seen. */
export function takeUnseenChanges(root) {
  const state = readState(root);
  if (!state.unseen?.length) return [];
  writeState(root, {...state, unseen: []});
  return state.unseen.map(c => ({changeId: c.changeId, model: c.id, capability: c.capability, from: c.from, to: c.to, source: c.source_url, date: c.source_date, note: c.note}));
}
