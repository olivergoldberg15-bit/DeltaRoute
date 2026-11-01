// The coordinator's own tokens. Claude Code writes each reply's usage into its session transcripts
// (~/.claude/projects/<project>/<session>.jsonl), so DeltaRoute can count Chief's side too instead of
// reporting worker tokens alone and making the savings look better than they are.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MAX_FILE = 200 * 1024 * 1024;

/** Claude Code's folder name for a project directory. */
export const projectSlug = cwd => String(cwd).replace(/[^a-zA-Z0-9]/g, '-');

/** Transcript files changed since `since`, optionally only those that mention `mention` (a workflow or task id). */
export function transcriptFiles({home = os.homedir(), since = null, mention = null, maxFiles = 300} = {}) {
  const root = path.join(home, '.claude', 'projects');
  const sinceMs = since ? Date.parse(since) : 0, files = [];
  let dirs = [];
  try { dirs = fs.readdirSync(root, {withFileTypes: true}).filter(d => d.isDirectory()); } catch { return []; }
  for (const d of dirs) {
    let entries = [];
    try { entries = fs.readdirSync(path.join(root, d.name)).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of entries) {
      const file = path.join(root, d.name, f);
      try { const st = fs.statSync(file); if (st.mtimeMs >= sinceMs && st.size < MAX_FILE) files.push({file, mtimeMs: st.mtimeMs}); } catch {}
    }
  }
  const recent = files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, maxFiles).map(f => f.file);
  return mention ? recent.filter(f => { try { return fs.readFileSync(f, 'utf8').includes(mention); } catch { return false; } }) : recent;
}

/** Sums Claude's reply usage between since and until. One reply streams over several lines; each id counts once. */
export function coordinatorUsage({since = null, until = null, mention = null, home = os.homedir(), files = null} = {}) {
  const from = since ? Date.parse(since) : 0, to = until ? Date.parse(until) : Infinity;
  const total = {available: false, source: 'Claude Code session transcripts (~/.claude/projects)', sessions: 0, replies: 0, inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0};
  const seen = new Set(), sessions = new Set();
  for (const file of files || transcriptFiles({home, since, mention})) {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.includes('"usage"')) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      const u = row?.message?.usage, at = Date.parse(row?.timestamp || '');
      if (row.type !== 'assistant' || !u || !(at >= from && at <= to)) continue;
      const key = row.message.id || row.requestId || row.uuid;
      if (seen.has(key)) continue;
      seen.add(key); sessions.add(row.sessionId || file);
      total.replies++;
      total.inputTokens += u.input_tokens || 0;
      total.cacheWriteTokens += u.cache_creation_input_tokens || 0;
      total.cacheReadTokens += u.cache_read_input_tokens || 0;
      total.outputTokens += u.output_tokens || 0;
    }
  }
  total.sessions = sessions.size;
  total.available = total.replies > 0;
  // Fresh tokens: what the reply had to process new. Cached reads are cheaper and reported apart, as for workers.
  total.freshTokens = total.inputTokens + total.cacheWriteTokens + total.outputTokens;
  return total;
}
