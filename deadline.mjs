// Wall-clock time limits for worker attempts. One long setTimeout counts only the time the computer is
// awake, so a laptop that slept let Gemini's 30-minute limit stop it at 50 minutes (2026-10-31). A short
// interval that compares Date.now() fires on time, or right after the computer wakes up.
import fs from 'node:fs';
import path from 'node:path';

export const WARN_RATIO = 0.8;

/**
 * Calls onWarn once at warnRatio of the limit and onExpire once at the limit, both measured from startedAt.
 * Returns stop() for the caller's finally block, plus the two wall-clock times.
 */
export function watchDeadline({startedAt = Date.now(), seconds, warnRatio = WARN_RATIO, onWarn = () => {}, onExpire, intervalMs = 2000, now = () => Date.now(), timers = {setInterval, clearInterval}}) {
  const expireAt = startedAt + seconds * 1000, warnAt = startedAt + seconds * 1000 * warnRatio;
  let warned = false, done = false, timer = null;
  const stop = () => { done = true; if (timer) timers.clearInterval(timer); };
  const check = () => {
    if (done) return;
    const t = now();
    if (!warned && t >= warnAt) { warned = true; try { onWarn({warnAt, expireAt}); } catch {} }
    if (t >= expireAt) { stop(); onExpire({expireAt}); }
  };
  timer = timers.setInterval(check, intervalMs);
  return {expireAt, warnAt, stop, check};
}

// Files DeltaRoute and its workers keep inside a worktree for coordination. They are never project work,
// so scope audits, patches and dirty checks skip them.
export const RUNTIME_DIR = '.deltaroute';
// Everything in .deltaroute/ except context.md, a project note that worker-context reads.
const RUNTIME_PATH = /^\.deltaroute\/(?!context\.md$)/;
export const isRuntimePath = file => RUNTIME_PATH.test(String(file).replaceAll('\\', '/'));

/** The save-progress signal: a file the worker can check, written when 80% of the time is used. */
export function writeWrapUp(cwd, expireAt) {
  const dir = path.join(cwd, RUNTIME_DIR);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'WRAP_UP'), `Time is almost up. Hard stop at ${new Date(expireAt).toISOString()}. Start nothing new: leave the code building and write .deltaroute/PROGRESS.md (done, not done, next step).\n`);
}

/** The brief's time section, so a worker knows its limit before it starts. */
export function deadlineBrief({warnAt, expireAt}) {
  return `Time limit: hard stop at ${new Date(expireAt).toISOString()} (check with the clock). From ${new Date(warnAt).toISOString()}, or as soon as the file .deltaroute/WRAP_UP exists, start nothing new: make what you have build, then write .deltaroute/PROGRESS.md listing what is done, what is not and the next step. Work left in the folder is kept even if time runs out.`;
}
