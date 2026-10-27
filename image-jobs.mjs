// Image jobs: a validated list of files to make. Runs on Nano Banana Pro through the user's own
// Higgsfield login (credits are priced and capped before anything is generated), or on Codex's
// built-in image tool as the no-credit backup. Outputs land in an output folder, not a Git worktree.
import fs from 'node:fs';
import path from 'node:path';
import {workerLaunch} from './provider-command.mjs';

export const IMAGE_ASPECTS = ['1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '9:16', '16:9', '21:9'];
export const IMAGE_RESOLUTIONS = ['1k', '2k', '4k'];
const IMAGE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(png|jpe?g|webp)$/i;
const REFERENCE_FILE = /\.(png|jpe?g|webp)$/i;

/** Normalizes and checks the coordinator's image request. Throws input errors that never fall back. */
export function imageSpec(raw, {cwd} = {}) {
  if (!raw || typeof raw !== 'object') throw Error('Invalid request: image jobs need images.outputs');
  const outputs = Array.isArray(raw.outputs) ? raw.outputs : [];
  if (!outputs.length || outputs.length > 12) throw Error('Invalid request: images.outputs must list 1 to 12 files');
  const style = raw.style === undefined ? '' : String(raw.style);
  if (style.length > 3000) throw Error('Invalid request: images.style must be at most 3000 characters');
  const seen = new Set();
  const normalized = outputs.map((o, i) => {
    const file = String(o?.file || '');
    if (!IMAGE_FILE.test(file)) throw Error(`Invalid request: images.outputs[${i}].file must be a plain .png, .jpg or .webp file name`);
    if (seen.has(file.toLowerCase())) throw Error(`Invalid request: duplicate output file ${file}`);
    seen.add(file.toLowerCase());
    const prompt = String(o?.prompt || '').trim();
    if (!prompt || prompt.length > 4000) throw Error(`Invalid request: images.outputs[${i}].prompt must contain 1 to 4000 characters`);
    const aspect = o.aspect_ratio || '1:1', resolution = o.resolution || '2k';
    if (!IMAGE_ASPECTS.includes(aspect)) throw Error(`Invalid request: images.outputs[${i}].aspect_ratio must be one of ${IMAGE_ASPECTS.join(', ')}`);
    if (!IMAGE_RESOLUTIONS.includes(resolution)) throw Error(`Invalid request: images.outputs[${i}].resolution must be 1k, 2k or 4k`);
    const references = (Array.isArray(o.references) ? o.references : []).map(ref => {
      const resolved = path.resolve(cwd || process.cwd(), String(ref));
      if (!REFERENCE_FILE.test(resolved) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw Error(`Invalid request: reference image not found: ${ref}`);
      return resolved;
    });
    if (references.length > 6) throw Error(`Invalid request: images.outputs[${i}] allows at most 6 references`);
    return {file, prompt, aspect_ratio: aspect, resolution, references};
  });
  let deliverTo = null;
  if (raw.deliver_to !== undefined) {
    if (!path.isAbsolute(String(raw.deliver_to))) throw Error('Invalid request: images.deliver_to must be an absolute directory');
    deliverTo = path.resolve(String(raw.deliver_to));
  }
  const maxCredits = raw.max_credits === undefined ? null : Number(raw.max_credits);
  if (maxCredits !== null && !(maxCredits >= 0)) throw Error('Invalid request: images.max_credits must be a number of credits');
  return {style, outputs: normalized, deliverTo, maxCredits};
}

/** True when the bytes start like a PNG, JPEG or WebP file. */
export function isImageBytes(buffer) {
  if (!buffer || buffer.length < 12) return false;
  const png = buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG';
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const webp = buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return png || jpeg || webp;
}

/** Checks every expected file exists in dir and really is an image. */
export function verifyOutputs(dir, spec) {
  const files = [], missing = [];
  for (const o of spec.outputs) {
    const p = path.join(dir, o.file);
    let bytes = 0, valid = false;
    try { const b = fs.readFileSync(p); bytes = b.length; valid = isImageBytes(b); } catch {}
    if (valid) files.push({file: o.file, path: p, bytes}); else missing.push(o.file);
  }
  return {ok: missing.length === 0, files, missing};
}

/** Copies verified outputs to the requested folder; returns where each file ended up. */
export function deliverOutputs(verified, deliverTo) {
  if (!deliverTo) return verified.files;
  fs.mkdirSync(deliverTo, {recursive: true});
  return verified.files.map(f => { const target = path.join(deliverTo, f.file); fs.copyFileSync(f.path, target); return {...f, path: target, jobCopy: f.path}; });
}

export const fullPrompt = (spec, o) => (spec.style ? spec.style.trim() + '\n\n' : '') + o.prompt;

export function higgsfieldCreateArgs(model, spec, o) {
  const args = ['generate', 'create', model, '--prompt', fullPrompt(spec, o), '--aspect_ratio', o.aspect_ratio, '--resolution', o.resolution];
  for (const ref of o.references) args.push('--image', ref);
  return [...args, '--wait', '--json'];
}

/** Reads the final job object(s) the CLI prints with --wait --json. */
export function parseHiggsfieldResult(stdout) {
  const text = String(stdout || '');
  const start = text.search(/[[{]/);
  if (start < 0) throw Error('Higgsfield returned no JSON result');
  let parsed;
  try { parsed = JSON.parse(text.slice(start)); } catch { throw Error('Higgsfield returned unreadable JSON'); }
  const job = (Array.isArray(parsed) ? parsed : [parsed]).find(j => j && typeof j === 'object') || {};
  if (job.status !== 'completed') throw Error('Higgsfield job did not complete: ' + (job.status || 'unknown status') + (job.error ? ' ' + job.error : ''));
  if (!/^https:\/\//.test(job.result_url || '')) throw Error('Higgsfield job completed without a result URL');
  return {id: job.id || null, url: job.result_url, model: job.display_name || job.job_type || null};
}

export function parseCredits(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?)\s*credits?\b/i);
  return m ? Number(m[1]) : null;
}

/**
 * Generates each output with the Higgsfield CLI. run(command, args) resolves {code, stdout, stderr};
 * download(url) resolves a Buffer. Prices the whole job first and refuses to start past the cap or balance.
 */
export async function runHiggsfield({spec, worker, outDir, run: runRaw, download, onPhase = () => {}}) {
  const model = worker.model || 'nano_banana_2', launch = workerLaunch(worker), command = launch.command;
  // The CLI ships as a Node script on Windows, so it runs as node + script, like the Gemini CLI.
  const run = (cmd, args) => runRaw(cmd, [...launch.prefix, ...args]);
  const status = await run(command, ['account', 'status']);
  const statusText = status.stdout + status.stderr;
  if (status.code !== 0) throw Error(/session expired|not authenticated|log ?in/i.test(statusText) ? 'Higgsfield requires account login. Run higgsfield auth login.' : 'Higgsfield account check failed: ' + statusText.slice(-1500));
  const before = parseCredits(statusText);
  onPhase('pricing_images');
  const priceCache = new Map();
  let estimate = 0;
  for (const o of spec.outputs) {
    const key = o.aspect_ratio + '|' + o.resolution;
    if (!priceCache.has(key)) {
      const r = await run(command, ['generate', 'cost', model, '--prompt', 'price check', '--aspect_ratio', o.aspect_ratio, '--resolution', o.resolution]);
      const price = parseCredits(r.stdout + r.stderr);
      if (r.code !== 0 || price === null) throw Error('Higgsfield could not price this image: ' + (r.stdout + r.stderr).slice(-800));
      priceCache.set(key, price);
    }
    estimate += priceCache.get(key);
  }
  const cap = spec.maxCredits ?? worker.maxCreditsPerJob ?? 24;
  if (estimate > cap) throw Error(`Image job needs about ${estimate} credits, over the ${cap}-credit cap for one job (credit balance limit). Raise images.max_credits or split the job.`);
  if (before !== null && estimate > before) throw Error(`Not enough credits: the job needs about ${estimate} and the account has ${before}.`);
  fs.mkdirSync(outDir, {recursive: true});
  const made = [];
  for (const [i, o] of spec.outputs.entries()) {
    onPhase(`generating_${i + 1}_of_${spec.outputs.length}`);
    const r = await run(command, higgsfieldCreateArgs(model, spec, o));
    if (r.code !== 0) throw Error(`Higgsfield failed on ${o.file}: ` + (r.stderr || r.stdout).slice(-1500));
    const result = parseHiggsfieldResult(r.stdout);
    const bytes = await download(result.url);
    if (!isImageBytes(bytes)) throw Error(`Higgsfield result for ${o.file} is not an image`);
    fs.writeFileSync(path.join(outDir, o.file), bytes);
    made.push({file: o.file, model: result.model, jobId: result.id});
  }
  const after = await run(command, ['account', 'status']);
  const remaining = parseCredits(after.stdout + after.stderr);
  return {
    made,
    credits: {estimated: estimate, before, after: remaining, used: before !== null && remaining !== null ? Math.round((before - remaining) * 100) / 100 : null, cap},
    model: made[0]?.model || model,
  };
}

/** The assignment Codex gets when it is the image backup: its built-in tool, files saved in the current folder. */
export function codexImageAssignment(spec) {
  const lines = spec.outputs.map((o, i) => `${i + 1}. ${o.file} (aspect ${o.aspect_ratio}): ${fullPrompt(spec, o).replace(/\s+/g, ' ')}${o.references.length ? ` Match the style of the attached reference image(s).` : ''}`);
  return ['Generate these images with your built-in image generation tool (image_generation) and save each one as a PNG at exactly the file name given, in the current working directory. Copy each file from wherever the image tool writes its output. Make only these files and do not write code.', ...lines, 'When finished, list each file with its pixel size.'].join('\n');
}

/**
 * Decides what a non-completed attempt really means once its process has stopped.
 * Image jobs whose files all exist count as completed (with a warning). Code jobs that already
 * changed files go back to the coordinator instead of starting a fallback that would redo the work.
 */
export function salvageAttempt(attempt, {category, mode, outputs = null, changed = [], failureKind = null} = {}) {
  if (!attempt || attempt.status === 'completed' || attempt.status === 'cancelled') return null;
  if (category === 'image' && outputs?.ok) return {status: 'completed', recoveredFrom: {status: attempt.status, error: attempt.error || null}, warning: `The worker did not finish cleanly (${attempt.status}), but all ${outputs.files.length} expected image files exist and were checked.`};
  // Only a cut-off run (time limit or dropped connection) leaves work worth keeping; other failures still fall back.
  const cutOff = attempt.status === 'timed_out' || ['timeout', 'outage'].includes(failureKind);
  if (mode === 'code' && cutOff && changed.length) return {handoffRequired: true, error: `Worker stopped (${attempt.status}) after changing ${changed.length} file(s). Review the worktree before retrying; no fallback was started so nothing is done twice: ${changed.slice(0, 12).join(', ')}`};
  return null;
}
