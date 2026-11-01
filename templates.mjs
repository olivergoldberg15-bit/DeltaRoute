// Templates for repeatable jobs (animated explainer, feature + tests, research report): a starting mode, the
// brief format, default acceptance checks per step and a review checklist. The plan's own values always win.
import fs from 'node:fs';
import path from 'node:path';

export function listTemplates(root) {
  try { return fs.readdirSync(path.join(root, 'templates')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)); } catch { return []; }
}

export function loadTemplate(root, name) {
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(String(name))) throw Error('Invalid template name');
  try { return JSON.parse(fs.readFileSync(path.join(root, 'templates', name + '.json'), 'utf8')); }
  catch { throw Error(`No template "${name}". Templates: ${listTemplates(root).join(', ')}`); }
}

/** The plan with the template's defaults filled in wherever the plan left a value out. */
export function applyTemplate(template, workflow = {}) {
  const d = template.step_defaults || {};
  return {
    ...workflow,
    mode: workflow.mode ?? template.mode,
    visual: workflow.visual ?? template.visual,
    constraints: [...(template.constraints || []), ...(workflow.constraints || [])],
    steps: (workflow.steps || []).map(s => ({
      ...s,
      category: s.category ?? d.category,
      ...(s.profile ?? d.profile ? {profile: s.profile ?? d.profile} : {}),
      ...(s.mode ?? d.mode ? {mode: s.mode ?? d.mode} : {}),
      acceptance: s.acceptance?.length ? s.acceptance : d.acceptance || [],
    })),
  };
}
