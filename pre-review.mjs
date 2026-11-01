// Cheap first review. Before Claude spends tokens on a visual step, a fast Gemini Flash run looks at the
// contact sheet of the worker's final stills and lists obvious misses against the brief. It never accepts
// or rejects anything: the score is advice attached to the job, and a failed screen is simply skipped.

/** Arguments for one read-only Antigravity (agy) run on the cheap model. */
export function preReviewArgs({sheet, task, acceptance = [], model, seconds = 150}) {
  const prompt = [
    'First-pass visual check before the main reviewer. Open the image file ' + sheet + ' (a contact sheet of rendered stills, read left to right, top to bottom) and look at it carefully.',
    'Compare what you see with the assignment and the acceptance checks below. Do not edit any file.',
    'Reply with only JSON: {"score": 0-100, "misses": ["concrete visual problem"], "looks_right": ["what matches"]}. Score 80 or more only when every check visibly holds. Name concrete problems: wrong or unrecognisable shapes, overlapping or cut-off text, empty or black frames, wrong colours, things missing from the brief.',
    'Assignment:\n' + String(task).slice(0, 3000),
    acceptance.length ? 'Acceptance checks:\n' + acceptance.map(a => '- ' + a).join('\n') : '',
  ].filter(Boolean).join('\n\n');
  return ['-p', prompt, '--output-format', 'json', '--mode', 'plan', ...(model ? ['--model', model] : []), '--effort', 'low', '--print-timeout', seconds + 's', '--disable-slash-commands'];
}

/** Reads {score, misses, looks_right} out of agy's JSON output. Returns null when there is none. */
export function parsePreReview(stdout) {
  let text = String(stdout || '');
  try { const outer = JSON.parse(text); text = typeof outer.response === 'string' ? outer.response : text; } catch {}
  for (const m of text.matchAll(/\{[\s\S]*?"score"[\s\S]*?\}/g)) {
    try {
      const r = JSON.parse(m[0]);
      const score = Number(r.score);
      if (!Number.isFinite(score) || score < 0 || score > 100) continue;
      const list = v => (Array.isArray(v) ? v : []).map(x => String(x).slice(0, 300)).slice(0, 12);
      return {score: Math.round(score), misses: list(r.misses), looksRight: list(r.looks_right)};
    } catch {}
  }
  return null;
}
