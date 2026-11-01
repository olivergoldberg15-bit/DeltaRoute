// Disposable monitors. While a worker runs, DeltaRoute takes a small snapshot of its progress every few minutes
// and hands it to a fresh Grok chat (Gemini Flash when Grok is busy or signed out) that answers one question:
// is this worker going to finish the assignment? A clear stall needs no model at all. Monitors only advise:
// they post to the board, leave a nudge for the worker and flag the job for Chief; they never stop a worker.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {isRuntimePath} from './deadline.mjs';

export const VERDICTS = ['on_track', 'behind', 'stalled', 'looping', 'off_task', 'done'];
export const NEEDS_NUDGE = new Set(['behind', 'stalled', 'looping', 'off_task']);

const read = (file, max) => { try { const t = fs.readFileSync(file, 'utf8'); return t.length > max ? t.slice(-max) : t; } catch { return ''; } };
const mtime = file => { try { return fs.statSync(file).mtimeMs; } catch { return 0; } };

/** Short lines from the end of a worker's output: event types and the start of what they said or ran. */
export function activityTail(stdout, lines = 25) {
  return String(stdout).split('\n').filter(Boolean).slice(-lines).map(line => {
    try {
      const row = JSON.parse(line), item = row.item || row.msg || row;
      const what = item.command || item.text || item.message || item.content || item.path || '';
      return [row.type, item.type, typeof what === 'string' ? what.replace(/\s+/g, ' ').slice(0, 160) : ''].filter(Boolean).join(' | ');
    } catch { return line.slice(0, 200); }
  }).join('\n');
}

/** What changed in the worktree so far, by name only (cheap; no diff text). */
export function changedSoFar(cwd, baseRef) {
  const run = args => { const r = spawnSync('git', args, {cwd, encoding: 'utf8', windowsHide: true}); return r.status === 0 ? r.stdout : ''; };
  const files = [...new Set([...run(['diff', '--name-only', baseRef, '--']).split('\n'), ...run(['ls-files', '--others', '--exclude-standard']).split('\n')])].filter(f => f && !isRuntimePath(f));
  return {files: files.slice(0, 40), count: files.length, newest: Math.max(0, ...files.slice(0, 200).map(f => mtime(path.join(cwd, f))))};
}

/** One progress snapshot. Everything the monitor sees is in here; it never reads the project itself. */
export function progressSnapshot({task, cwd, baseRef, jobDir, startedAt, expireAt, now = Date.now()}) {
  const changed = baseRef ? changedSoFar(cwd, baseRef) : {files: [], count: 0, newest: 0};
  const stdoutFile = path.join(jobDir, 'stdout.log');
  const lastActivity = Math.max(mtime(stdoutFile), changed.newest, mtime(path.join(cwd, '.deltaroute', 'PROGRESS.md')));
  return {
    assignment: String(task).slice(0, 2500),
    minutesElapsed: Math.round((now - startedAt) / 60000),
    minutesLeft: Math.max(0, Math.round((expireAt - now) / 60000)),
    minutesSinceActivity: lastActivity ? Math.round((now - lastActivity) / 60000) : null,
    changedFiles: changed.files, changedCount: changed.count,
    progressNote: read(path.join(cwd, '.deltaroute', 'PROGRESS.md'), 1500),
    recentActivity: activityTail(read(stdoutFile, 60000)),
  };
}

/** Verdicts that need no model: nothing written and no output for a long stretch is a stall. */
export function ruleVerdict(snapshot, {stallMinutes = 10} = {}) {
  if (snapshot.minutesSinceActivity !== null && snapshot.minutesSinceActivity >= stallMinutes && snapshot.minutesElapsed >= stallMinutes)
    return {status: 'stalled', confidence: 90, note: `No output and no file change for ${snapshot.minutesSinceActivity} minutes.`, nudge: 'You have produced nothing for a while. If you are stuck, write what blocks you to .deltaroute/PROGRESS.md and either take the simplest path that satisfies the assignment or post a help request.', by: 'rule'};
  return null;
}

export function monitorPrompt(snapshot) {
  return ['You are a disposable monitoring agent with one job: judge from this snapshot whether an AI coding worker will finish its assignment in the time left. You cannot see the code; do not ask for more. Be decisive and brief.',
    'Reply with only JSON: {"status":"on_track|behind|stalled|looping|off_task|done","confidence":0-100,"note":"one sentence","nudge":"one or two sentences telling the worker what to do next, or empty when on track"}.',
    'looping = repeating the same commands or edits; off_task = working on things the assignment did not ask for; behind = moving but unlikely to finish in time.',
    'Snapshot:\n' + JSON.stringify(snapshot)].join('\n\n');
}

/** Reads a verdict out of a model's reply (plain text, or agy's JSON wrapper). */
export function parseVerdict(text) {
  let body = String(text || '');
  try { const outer = JSON.parse(body); if (typeof outer.response === 'string') body = outer.response; } catch {}
  for (const m of body.matchAll(/\{[^{}]*"status"[^{}]*\}/g)) {
    try {
      const v = JSON.parse(m[0]);
      if (!VERDICTS.includes(v.status)) continue;
      return {status: v.status, confidence: Math.max(0, Math.min(100, Math.round(Number(v.confidence) || 50))), note: String(v.note || '').slice(0, 400), nudge: String(v.nudge || '').slice(0, 800)};
    } catch {}
  }
  return null;
}

/** The nudge file a worker is told to watch. */
export function nudgeText(verdict) {
  return `# Monitor nudge (${new Date().toISOString()})\n\nStatus: ${verdict.status} (${verdict.by}, confidence ${verdict.confidence}).\n${verdict.note}\n\nWhat to do: ${verdict.nudge || 'Re-read the assignment and finish the smallest version that satisfies it.'}\n`;
}
