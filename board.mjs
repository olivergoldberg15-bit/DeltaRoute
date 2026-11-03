// The agent board: one shared channel per team (a workflow, or one job and the helpers it asks), so agents talk
// to each other directly instead of everything passing through Chief. Workers cannot write outside their own
// folder (Codex's sandbox), so each one drops messages in .deltaroute/outbox/; DeltaRoute moves them onto the
// board within seconds and mirrors the board back into every worker's .deltaroute/board.md. A "help" message
// asks another AI, which DeltaRoute launches at once; its answer comes back on the board.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {RUNTIME_DIR} from './deadline.mjs';
import {acquireProcessLease} from './process-lease.mjs';

export const OUTBOX = path.join(RUNTIME_DIR, 'outbox');
export const BOARD_VIEW = path.join(RUNTIME_DIR, 'board.md');
export const NUDGE = path.join(RUNTIME_DIR, 'NUDGE.md');
const WORKER_KINDS = ['note', 'question', 'answer', 'help'];
const KINDS = [...WORKER_KINDS, 'monitor', 'chief'];
export const HELP_ASKS = ['research', 'social_research', 'review', 'large_context', 'summarization', 'debugging', 'quick_coding'];

/** Reserves before submit, not after its promise resolves. Successful helpers consume a slot for the job's life. */
export function reserveHelperSlot(jobDir, {maxHelpers = 4, helpers = []} = {}) {
  const dir = path.join(jobDir, 'helper-slots');
  fs.mkdirSync(dir, {recursive: true});
  const committed = new Set();
  for (const name of fs.readdirSync(dir).filter(n => /^\d+\.json$/.test(n))) {
    try { committed.add(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')).taskId); } catch {}
  }
  // Helpers launched before slot reservations were introduced still count.
  const legacy = helpers.filter(h => !committed.has(h.taskId)).length;
  for (let i = legacy; i < maxHelpers; i++) {
    const file = path.join(dir, i + '.json');
    if (fs.existsSync(file)) continue;
    let release;
    try { release = acquireProcessLease(path.join(dir, i + '.lock')); }
    catch (e) { if (/busy or still active|contention/.test(e.message)) continue; throw e; }
    if (fs.existsSync(file)) { release(); continue; }
    let done = false;
    return {
      commit(taskId) {
        if (done) return;
        fs.writeFileSync(file, JSON.stringify({taskId}), {flag: 'wx'});
        release(); done = true;
      },
      release() { if (!done) { release(); done = true; } }
    };
  }
  return null;
}

/** The board file for a team: the workflow's, or the top job's when the work is not part of a workflow. */
export function boardFile(root, {workflowId = null, jobId = null}) {
  if (workflowId && /^[a-f0-9-]{36}$/.test(workflowId)) return path.join(root, 'workflows', workflowId, 'board.jsonl');
  if (jobId && /^[a-f0-9-]{36}$/.test(jobId)) return path.join(root, 'jobs', jobId, 'board.jsonl');
  throw Error('A board needs a workflow or job id');
}

/** Checks one message. Workers may post note, question, answer and help; DeltaRoute adds monitor and chief. */
export function validMessage(raw, {from, worker = true} = {}) {
  if (!raw || typeof raw !== 'object') throw Error('A board message must be a JSON object');
  const kind = String(raw.kind || 'note');
  if (!(worker ? WORKER_KINDS : KINDS).includes(kind)) throw Error('kind must be one of ' + (worker ? WORKER_KINDS : KINDS).join(', '));
  const text = String(raw.text || '').trim();
  if (!text || text.length > 6000) throw Error('text must be 1 to 6000 characters');
  const to = String(raw.to || 'all').slice(0, 60);
  const files = (Array.isArray(raw.files) ? raw.files : []).map(String).slice(0, 10);
  const msg = {kind, from: String(from || raw.from || 'unknown').slice(0, 80), to, text, files};
  if (kind === 'help') {
    const ask = String(raw.ask || 'research');
    if (!HELP_ASKS.includes(ask)) throw Error('ask must be one of ' + HELP_ASKS.join(', '));
    msg.ask = ask;
  }
  return msg;
}

export function postMessage(file, raw, options = {}) {
  const msg = {id: crypto.randomUUID().slice(0, 8), at: new Date().toISOString(), ...validMessage(raw, options)};
  for (const k of ['taskId', 'status']) if (raw[k] !== undefined) msg[k] = raw[k];
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.appendFileSync(file, JSON.stringify(msg) + '\n');
  return msg;
}

export function readBoard(file, {limit = 60} = {}) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return text.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).slice(-limit);
}

/** What one agent sees: messages to everyone, to it (by name, step or provider), and its own. */
export function boardView(messages, names) {
  const mine = new Set(names.filter(Boolean).map(n => n.toLowerCase()));
  const seen = messages.filter(m => m.to === 'all' || mine.has(String(m.to).toLowerCase()) || mine.has(String(m.from).toLowerCase()) || [...mine].some(n => String(m.from).toLowerCase().startsWith(n + ':')));
  if (!seen.length) return '# Team board\n\nNo messages yet. Write .deltaroute/outbox/<name>.json to post one.\n';
  return '# Team board (newest last)\n\n' + seen.map(m => `- ${m.at.slice(11, 19)} **${m.from}** to ${m.to} (${m.kind}${m.ask ? ': ' + m.ask : ''}${m.status ? ', ' + m.status : ''}): ${m.text.replace(/\s+/g, ' ').slice(0, 1500)}${m.files?.length ? ' Files: ' + m.files.join(', ') : ''}`).join('\n') + '\n';
}

/** Takes the messages a worker left in its outbox. Invalid ones are moved aside with the reason, never lost. */
export function collectOutbox(cwd, from) {
  const dir = path.join(cwd, OUTBOX), taken = [], rejected = [];
  let entries = [];
  try { entries = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort(); } catch { return {taken, rejected}; }
  fs.mkdirSync(path.join(dir, 'sent'), {recursive: true});
  for (const f of entries) {
    const file = path.join(dir, f);
    try {
      taken.push(validMessage(JSON.parse(fs.readFileSync(file, 'utf8')), {from}));
      fs.renameSync(file, path.join(dir, 'sent', f));
    } catch (e) {
      rejected.push({file: f, error: e.message});
      try { fs.renameSync(file, path.join(dir, 'sent', f + '.rejected')); fs.writeFileSync(path.join(dir, 'sent', f + '.error.txt'), e.message); } catch {}
    }
  }
  return {taken, rejected};
}

/** Writes the worker's board view only when it changed, so its file watcher is not woken for nothing. */
export function mirrorBoard(cwd, view) {
  const file = path.join(cwd, BOARD_VIEW);
  try { if (fs.readFileSync(file, 'utf8') === view) return false; } catch {}
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, view);
  return true;
}

export function boardBrief(name) {
  return `Team board: you are "${name}". Other agents on this job and DeltaRoute's monitors post to .deltaroute/board.md; read it when you start and whenever you are unsure. To post, write a JSON file .deltaroute/outbox/<any-name>.json: {"kind":"note","to":"all","text":"..."} to share a decision others depend on (names, file paths, interfaces); {"kind":"question","to":"<agent>","text":"..."} to ask a teammate; {"kind":"help","ask":"research","to":"any","text":"..."} to have another AI do a piece for you (ask: research, social_research, review, large_context, summarization, debugging or quick_coding; to: any, perplexity, grok, muse, codex or gemini). Help answers arrive on the board in a few minutes; keep working meanwhile. Never launch other AI programs yourself. If .deltaroute/NUDGE.md appears or changes, a monitor thinks you are off track: read it and adjust.`;
}
