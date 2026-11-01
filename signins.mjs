// Which subscriptions are signed in, without a model request: Codex's own login status, the Antigravity model
// list, Higgsfield's account status, and the research browser's saved cookies for Perplexity, Grok and Muse.
// node signins.mjs            prints the table and what to do next
// node signins.mjs --smoke    then runs `npm run smoke` (tiny real jobs) for everything that is signed in
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {workerLaunch} from './provider-command.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SITES = {perplexity: ['perplexity.ai'], grok: ['grok.com', 'x.ai'], muse: ['meta.ai']};

function quiet(command, args) {
  const r = spawnSync(command, args, {encoding: 'utf8', windowsHide: true, timeout: 45000});
  return {ok: r.status === 0, timedOut: r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM', text: (r.stdout || '') + (r.stderr || '')};
}

/** Browser cookie domains saved for the research browser. Presence suggests a sign-in; it does not prove one. */
export function cookieDomains(stateFile) {
  try { return [...new Set((JSON.parse(fs.readFileSync(stateFile, 'utf8')).cookies || []).map(c => String(c.domain).replace(/^\./, '')))]; } catch { return []; }
}

export function checkSignins(cfg, {run = quiet, root = ROOT} = {}) {
  const rows = [], w = cfg.workers || {};
  const add = (name, state, next) => rows.push({name, state, next});
  // A CLI that does not answer in time is unknown, not signed out; a failure shows the CLI's own words.
  const verdict = (r, good, signedIn, fix) => r.ok && good ? [signedIn, ''] : r.timedOut ? ['unknown (no answer in 45 s)', 'Try again; if it repeats: ' + fix] : ['not signed in: ' + r.text.trim().split('\n').pop().slice(0, 120), fix];
  if (w.codex?.enabled) { const r = run(w.codex.command, ['login', 'status']); add('codex', ...verdict(r, /ChatGPT/i.test(r.text), 'signed in (ChatGPT plan)', 'Run: codex login (choose Sign in with ChatGPT)')); }
  if (w.gemini?.enabled) {
    if (w.gemini.transport === 'antigravity') { const r = run(w.gemini.command, ['models']); add('gemini', ...verdict(r, r.text.trim(), 'signed in (Antigravity)', 'Run agy once and sign in with Google')); }
    else add('gemini', 'installed (sign-in not checked)', 'login-gemini.ps1 if jobs fail');
  }
  if (w.higgsfield?.enabled) { const launch = workerLaunch(w.higgsfield), r = run(launch.command, [...launch.prefix, 'account', 'status']); const credits = r.text.match(/(\d+(?:\.\d+)?)\s*credits?/i)?.[1]; add('higgsfield', ...verdict(r, true, 'signed in' + (credits ? `, ${credits} credits` : ''), 'Run: higgsfield auth login')); }
  const domains = cookieDomains(path.join(root, 'state', 'browser', 'session-state.json'));
  for (const [name, sites] of Object.entries(SITES)) {
    if (!w[name]?.enabled || w[name].transport === 'cursor') continue;
    const seen = sites.some(s => domains.some(d => d === s || d.endsWith('.' + s)));
    add(name, seen ? 'site cookies saved; sign-in not verified (experimental)' : 'no browser session', seen ? '' : `Run: research-login.ps1 -Provider ${name}, sign in, then research-login.ps1 -Finish`);
  }
  return rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')); } catch { console.error('No config.json yet: run node setup.mjs first.'); process.exit(1); }
  const rows = checkSignins(cfg);
  for (const r of rows) console.log(`${r.name.padEnd(11)} ${r.state}${r.next ? '\n            ' + r.next : ''}`);
  if (!rows.length) console.log('No workers are enabled in config.json.');
  if (process.argv.includes('--smoke')) {
    console.log('\nSmoke test: one tiny real job per signed-in code worker...');
    const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'smoke'], {cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32'});
    process.exitCode = r.status ?? 1;
  }
}
