// Live dashboard: a static HTML file beside plan.json that redraws the Chief > OP > routes >
// agents > sub-agents > review tree after every change. No server and no window popping up:
// open the file in any browser and it refreshes itself every few seconds until the run is done.
import fs from 'node:fs';
import path from 'node:path';
import {readWorkflow, workflowSummary, jobTokens} from './workflows.mjs';
import {readEvents} from './events.mjs';
import {PASS_SCORE} from './review.mjs';
import {spawn} from 'node:child_process';

/** Open a dashboard in the default browser through the OS file handler: no console window, never waited on. */
export function openDashboard(file, {platform = process.platform, launch = spawn} = {}) {
  if (!file || !fs.existsSync(file)) return false;
  const [command, args] = platform === 'win32' ? ['explorer.exe', [file]] : platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
  try { const child = launch(command, args, {detached: true, stdio: 'ignore', windowsHide: true}); child.on?.('error', () => {}); child.unref?.(); return true; } catch { return false; }
}

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);
const STATE = {accepted: 'done', completed: 'done', awaiting_review: 'wait', needs_revision: 'bad', failed: 'bad', needs_coordinator: 'bad', timed_out: 'bad', cancelled: 'bad', running: 'live', queued: 'live', pending: 'idle'};
const PHASE = {
  awaiting_plan_approval: ['wait', 'Waiting for your plan check'], running: ['live', 'Running'],
  reworking_after_simulated_review: ['bad', 'Reworking after simulated review'], awaiting_simulated_review: ['wait', 'Ready for simulated review'],
  awaiting_chief_review: ['wait', 'Waiting for Chief\'s final review'], awaiting_user_approval: ['wait', 'Waiting for your approval'], done: ['done', 'Done, approved by you'],
};
const bar = (used, max, label) => {
  if (max === null || max === undefined) return `<div class="bar"><span>${esc(label)}</span><b>${fmt(used)} / no cap</b></div>`;
  const pct = Math.min(100, Math.round(used / max * 100));
  return `<div class="bar ${pct >= 100 ? 'full' : pct >= 75 ? 'high' : ''}"><span>${esc(label)}</span><b>${fmt(used)} / ${fmt(max)}</b><i style="width:${pct}%"></i></div>`;
};
const node = (cls, kicker, title, body = '') => `<div class="node ${cls}"><div class="k">${esc(kicker)}</div><div class="t">${esc(title)}</div>${body}</div>`;
const describe = e => ({
  plan_created: `Plan created: ${e.steps} steps across ${(e.routes || []).join(', ')}`,
  plan_approved: `You approved the plan: "${e.by}"`,
  step_launched: `Agent launched for ${e.step}`,
  subagent_launched: `Sub-agent ${e.subagent} launched for ${e.step}`,
  job: `${e.step}${e.subagent ? ' / ' + e.subagent : ''}: ${e.provider || 'worker'} ${e.status}${e.phase ? ' (' + e.phase + ')' : ''}`,
  accepted: `${e.step} passed Review${e.score !== null && e.score !== undefined ? ' at ' + e.score : ''}`,
  sent_back: `${e.step} sent back${e.score !== null && e.score !== undefined ? ' at ' + e.score : ''}: ${e.note}`,
  simulated_review: `Simulated review ${e.passed ? 'passed' : 'failed'} at ${e.score}${e.sentBack?.length ? ', reopened ' + e.sentBack.join(', ') : ''}`,
  chief_review: `Chief final review: ${e.note}`,
  user_approved: `You approved the result: "${e.by}"`,
})[e.type] || e.type;

export function renderDashboard(root, id, readJob = () => null, {coordinatorLabel = 'Claude Code'} = {}) {
  const plan = readWorkflow(root, id);
  const s = workflowSummary(root, plan, readJob);
  const events = readEvents(root, id, 60).reverse();
  const steps = new Map(plan.contract.steps.map(x => [x.id, x]));
  const lastJob = st => { try { return st.lastTaskId ? readJob(st.lastTaskId) : null; } catch { return null; } };
  const [phaseState, phaseText] = PHASE[s.phase] || ['idle', s.phase];
  let blocking = 0, warnings = 0;
  const routeHtml = s.routes.map(r => {
    const agents = s.steps.filter(st => st.route === r.id).map(st => {
      const job = lastJob(st), def = steps.get(st.id);
      if (job?.selfCheck) for (const f of job.selfCheck.findings || []) f.severity === 'blocking' ? blocking++ : warnings++;
      const who = job?.modelUsed ? (job.provider || '') + ' · ' + job.modelUsed : def.provider ? def.provider + (def.model ? ' · ' + def.model : '') : 'picked at launch';
      const score = st.checkpoint?.score ?? st.lastReview?.score;
      const subs = st.subagents.map(x => `<span class="chip ${STATE[x.status] || 'idle'}" title="${esc(x.status)}">${esc(x.id)}</span>`).join('');
      const tokens = job ? jobTokens(job) : null;
      return `<div class="node agent ${STATE[st.status] || 'idle'}"><div class="k">Agent · ${esc(st.category)}</div><div class="t">${esc(st.id)}</div>
        <div class="s">${esc(who)}</div><div class="s">${esc(st.status.replaceAll('_', ' '))} · ${st.runs} run${st.runs === 1 ? '' : 's'}${score !== null && score !== undefined ? ' · score ' + score : ''}${tokens?.measured ? ' · ' + fmt(tokens.tokens) + ' tok' : ''}</div>
        ${st.blockedReason && !['already accepted'].includes(st.blockedReason) ? `<div class="s why">${esc(st.blockedReason)}</div>` : ''}
        ${subs ? `<div class="subs"><span class="k">Sub-agents</span>${subs}</div>` : ''}</div>`;
    }).join('');
    return `<div class="route ${r.exhausted ? 'bad' : ''}">${node('lead', 'Route lead', r.id, `<div class="s">${esc(r.lead || 'lead chosen by capability')}</div>${bar(r.used.tokens, r.budget.tokens, 'Tokens')}${bar(r.used.runs, r.budget.runs, 'Runs')}${r.used.unmeasuredRuns ? `<div class="s">${r.used.unmeasuredRuns} run(s) reported no token count</div>` : ''}${r.exhausted ? `<div class="s why">Budget used up: ${esc(r.failures.map(f => f.step + ': ' + f.error).join(' | ') || 'no failures recorded')}</div>` : ''}`)}<div class="agents">${agents}</div></div>`;
  }).join('');
  const scored = s.steps.filter(st => st.checkpoint?.score != null || st.lastReview?.score != null).map(st => `${esc(st.id)} ${st.checkpoint?.score ?? st.lastReview.score}${st.checkpoint ? ' ✓' : ' ✗'}`).join(' · ');
  const sim = s.simulatedReview;
  const approved = plan.approval?.status === 'approved' || !plan.approval;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${s.phase === 'done' ? '' : '<meta http-equiv="refresh" content="4">'}<title>ΔRoute · ${esc(plan.contract.objective.slice(0, 40))}</title>
<style>
:root{--bg:#F3F5F8;--surface:#fff;--ink:#141A24;--muted:#5B6678;--line:#AEB8C8;--live:#2F5BD3;--done:#1E7A4C;--wait:#B4610F;--bad:#B4302A;--idle:#98A4BB;--ctx:#7A5BC2;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0D1119;--surface:#161C27;--ink:#E6EAF2;--muted:#93A0B5;--line:#3A4559;--live:#7C9DF5;--done:#5CC98F;--wait:#F0A855;--bad:#F07A72;--idle:#56617A;--ctx:#B49AF0;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:1180px;margin:0 auto;padding:20px 16px 40px}
h1{font-size:26px;margin:0}h1 span{color:var(--live)}.sub{color:var(--muted);margin:2px 0 12px}
.pill{display:inline-block;padding:3px 10px;border-radius:99px;font-weight:600;font-size:12px;border:1.5px solid currentColor}
.live{--c:var(--live)}.done{--c:var(--done)}.wait{--c:var(--wait)}.bad{--c:var(--bad)}.idle{--c:var(--idle)}.pill{color:var(--c)}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px}@media (max-width:860px){.grid{grid-template-columns:minmax(0,1fr)}}
.tree{display:flex;flex-direction:column;align-items:stretch;gap:0}
.node{background:var(--surface);border:1.6px solid var(--c,var(--line));border-radius:8px;padding:8px 10px;min-width:0}
.node .k{font:600 10.5px ui-monospace,Menlo,monospace;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
.node .t{font-weight:700;font-size:15px;overflow-wrap:anywhere}.node .s{color:var(--muted);font-size:12.5px;overflow-wrap:anywhere}.node .s.why{color:var(--c,var(--muted))}
.link{width:2px;height:16px;background:var(--line);margin:0 auto}
.pair{display:grid;grid-template-columns:2fr 1fr;gap:10px}@media (max-width:560px){.pair{grid-template-columns:1fr}}.ctx{border-style:dashed;border-color:var(--ctx)}
.routes{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.route{border:1px dashed var(--line);border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:8px}.route.bad{border-color:var(--bad)}
.agents{display:flex;flex-direction:column;gap:8px}.agent.live{animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{50%{box-shadow:0 0 0 4px color-mix(in srgb,var(--live) 22%,transparent)}}
@media (prefers-reduced-motion:reduce){.agent.live{animation:none}}
.subs{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:4px}.subs .k{margin-right:2px}
.chip{font:11px ui-monospace,Menlo,monospace;padding:1px 6px;border-radius:4px;border:1.3px solid var(--c);color:var(--ink)}
.bar{position:relative;display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-top:4px;padding:1px 4px;border-radius:4px;overflow:hidden;background:color-mix(in srgb,var(--line) 22%,transparent)}
.bar i{position:absolute;inset:0 auto 0 0;background:color-mix(in srgb,var(--live) 22%,transparent)}.bar.high i{background:color-mix(in srgb,var(--wait) 30%,transparent)}.bar.full i{background:color-mix(in srgb,var(--bad) 30%,transparent)}
.bar span,.bar b{position:relative;font-weight:500}
.log{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px;max-height:80vh;overflow:auto}
.log h2{font-size:13px;margin:0 0 6px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.ev{border-top:1px solid color-mix(in srgb,var(--line) 50%,transparent);padding:5px 0;font-size:12.5px;overflow-wrap:anywhere}.ev time{display:block;color:var(--muted);font:11px ui-monospace,Menlo,monospace}
.foot{color:var(--muted);font-size:12px;margin-top:12px}
</style></head><body><div class="wrap">
<h1><span>Δ</span>Route</h1><div class="sub">${esc(plan.contract.objective.slice(0, 220))}</div>
<span class="pill ${phaseState}">${esc(phaseText)}</span> <span class="sub">Updated ${esc(new Date().toLocaleString())}${s.phase === 'done' ? '' : ' · refreshes every 4 s'}</span>
<div class="grid" style="margin-top:14px"><div class="tree">
${node('idle', 'Input', 'User', '<div class="s">Original prompt saved as the source of truth</div>')}<div class="link"></div>
<div class="pair">${node(s.final?.chiefNote ? 'done' : 'idle', 'Chief · top model', coordinatorLabel, '<div class="s">Owns the run and gives the final review</div>')}${node('ctx', 'Context rail', 'Prompt + plan', `<div class="s">${esc(path.basename(path.dirname(s.artifact)))}/plan.json, pulled on demand</div>`)}</div><div class="link"></div>
${node(approved ? 'done' : 'wait', 'Planner · top model', 'OP · Operation Plan', `<div class="s">${approved ? (plan.approval ? 'You approved: "' + esc(plan.approval.approvedByUser) + '"' : 'Plan saved before approvals existed') : 'Waiting for your plan check'}</div><div class="s">${s.routes.length} route${s.routes.length === 1 ? '' : 's'} · ${s.steps.length} agent step${s.steps.length === 1 ? '' : 's'} · ${s.budget.launched}/${s.budget.maxJobs} jobs</div>`)}<div class="link"></div>
<div class="routes">${routeHtml}</div><div class="link"></div>
${node(blocking ? 'bad' : warnings ? 'wait' : 'idle', 'Pre-review', 'Log self-check', `<div class="s">${blocking} blocking · ${warnings} warning${warnings === 1 ? '' : 's'} on the latest runs</div>`)}<div class="link"></div>
${node(s.steps.every(st => st.checkpoint) ? 'done' : s.steps.some(st => st.status === 'awaiting_review') ? 'wait' : 'idle', 'Gate · bar ' + PASS_SCORE, 'Review', `<div class="s">${scored || 'No scores yet'}</div><div class="s">Below ${PASS_SCORE} goes back to the branch that made it</div>`)}<div class="link"></div>
${node(sim ? (sim.passed ? 'done' : 'bad') : s.phase === 'awaiting_simulated_review' ? 'wait' : 'idle', 'Gate · whole product', 'Simulated review', `<div class="s">${sim ? 'Score ' + sim.score + (sim.passed ? ', passed' : ', failed; reopened ' + esc((sim.sentBack || []).join(', '))) : 'Runs once every step passes'}</div>`)}<div class="link"></div>
${node(s.final?.chiefNote ? 'done' : s.phase === 'awaiting_chief_review' ? 'wait' : 'idle', 'Chief', 'Final review', `<div class="s">${esc(s.final?.chiefNote || 'Not yet')}</div>`)}<div class="link"></div>
${node(s.final?.approvedByUser ? 'done' : s.phase === 'awaiting_user_approval' ? 'wait' : 'idle', 'Gate', 'Human approves', `<div class="s">${s.final?.approvedByUser ? 'You approved: "' + esc(s.final.approvedByUser) + '"' : 'Nothing counts as done until you approve it'}</div>`)}
</div><aside class="log"><h2>Every step, newest first</h2>${events.map(e => `<div class="ev"><time>${esc(new Date(e.at).toLocaleTimeString())}</time>${esc(describe(e))}</div>`).join('') || '<div class="ev">No events yet</div>'}</aside></div>
<div class="foot">Token counts are workers' fresh input + output only. Claude's own tokens as Chief and reviewer are not measured here.</div>
</div></body></html>`;
  const file = path.join(root, 'workflows', id, 'dashboard.html'), tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, html);
  try { fs.renameSync(tmp, file); } catch { fs.writeFileSync(file, html); try { fs.unlinkSync(tmp); } catch {} }
  return file;
}
