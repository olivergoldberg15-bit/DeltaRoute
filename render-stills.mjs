// Render stills for workers that cannot open a browser (Codex's sandbox refuses to launch Chrome). A worker
// writes .deltaroute/render/<name>.json; DeltaRoute, running outside the sandbox, renders the frames into
// .deltaroute/render/<name>/ with one contact sheet, and writes done.json or error.json. The worker then
// opens the sheet and fixes what it sees, before the coordinator ever looks.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {RUNTIME_DIR} from './deadline.mjs';

export const RENDER_DIR = path.join(RUNTIME_DIR, 'render');
const NAME = /^[a-z0-9][a-z0-9_-]{0,40}$/i;
const MAX_FRAMES = 12;

/** Validates a render request: frames (Remotion frame numbers) or times (seconds), optional composition/target. */
export function renderRequest(raw) {
  if (!raw || typeof raw !== 'object') throw Error('Render request must be a JSON object');
  const frames = (raw.frames || []).map(Number), times = (raw.times || []).map(Number);
  if (!frames.length && !times.length) throw Error('Render request needs frames (frame numbers) or times (seconds)');
  if (frames.length + times.length > MAX_FRAMES) throw Error(`Render at most ${MAX_FRAMES} stills per request`);
  if ([...frames, ...times].some(n => !Number.isFinite(n) || n < 0)) throw Error('Frames and times must be numbers of 0 or more');
  const composition = raw.composition === undefined ? null : String(raw.composition);
  if (composition !== null && !/^[A-Za-z0-9_-]{1,80}$/.test(composition)) throw Error('Invalid composition name');
  const target = raw.target === undefined ? null : String(raw.target);
  if (target !== null && (/^[a-z]+:/i.test(target) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(target))) throw Error('target must be a project file or a localhost URL');
  return {frames: frames.map(Math.round), times, composition, target, width: Math.min(1920, Math.max(320, Number(raw.width) || 1280)), scale: Math.min(1, Math.max(0.1, Number(raw.scale) || 0.5))};
}

/** Works out how this project renders a still: a configured command, Remotion, or a plain HTML page. */
export function detectRenderer(cwd, request, {command = null} = {}) {
  if (command) return {kind: 'command', command};
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')); } catch {}
  const deps = {...pkg.dependencies, ...pkg.devDependencies};
  if (deps.remotion || deps['@remotion/cli']) {
    const scripted = Object.values(pkg.scripts || {}).map(s => String(s).match(/remotion\s+(?:studio|render|preview)\s+(\S+\.(?:tsx?|jsx?))/)?.[1]).find(Boolean);
    const entry = request.target && /\.(tsx?|jsx?)$/.test(request.target) ? request.target : scripted || ['src/index.ts', 'src/index.tsx', 'src/Root.tsx'].find(f => fs.existsSync(path.join(cwd, f)));
    if (!entry) throw Error('Remotion project found, but no entry file (src/index.ts); pass target');
    if (!request.composition) throw Error('Remotion stills need the composition name');
    return {kind: 'remotion', entry};
  }
  const page = request.target || ['index.html', 'dist/index.html', 'public/index.html'].find(f => fs.existsSync(path.join(cwd, f)));
  if (!page) throw Error('No renderer found: not a Remotion project and no index.html; pass target or set render.command');
  return {kind: 'html', page};
}

/** Every still to make, each with its file name and the command that renders it. */
export function renderPlan(cwd, request, renderer, outDir, {chrome = null, node = process.execPath} = {}) {
  const shots = [...request.frames.map(f => ({label: 'frame-' + f, frame: f, time: null})), ...request.times.map(t => ({label: 't-' + String(t).replace('.', '_') + 's', frame: null, time: t}))];
  // Remotion's CLI script runs on node directly: Windows refuses to spawn npx.cmd without a shell.
  const remotion = path.join(cwd, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
  return shots.map(s => {
    const file = path.join(outDir, s.label + '.png');
    if (renderer.kind === 'remotion') {
      const frame = s.frame ?? Math.round(s.time * 30);
      return {...s, file, command: node, args: [remotion, 'still', renderer.entry, request.composition, file, '--frame=' + frame, '--scale=' + (request.scale ?? 0.5), ...(process.platform === 'win32' ? ['--gl=angle'] : []), '--log=error']};
    }
    if (renderer.kind === 'command') {
      const fill = v => v.replaceAll('{frame}', String(s.frame ?? '')).replaceAll('{time}', String(s.time ?? '')).replaceAll('{out}', file).replaceAll('{composition}', request.composition || '');
      const parts = renderer.command.map(fill);
      return {...s, file, command: parts[0], args: parts.slice(1)};
    }
    if (!chrome) throw Error('No Chrome or Chromium found to render the HTML page');
    const url = /^https?:/.test(renderer.page) ? renderer.page : pathToFileURL(path.resolve(cwd, renderer.page)).href;
    // Virtual time runs the page's timers and animations up to the requested moment before the screenshot.
    const budget = Math.round((s.time ?? (s.frame ?? 0) / 30) * 1000) + 250;
    return {...s, file, command: chrome, args: ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=' + request.width + ',' + Math.round(request.width * 9 / 16), '--virtual-time-budget=' + budget, '--screenshot=' + file, url]};
  });
}

/** Width and height from a PNG header, or null for anything else. */
export function pngSize(file) {
  try {
    const fd = fs.openSync(file, 'r'), b = Buffer.alloc(24);
    fs.readSync(fd, b, 0, 24, 0); fs.closeSync(fd);
    return b.toString('ascii', 1, 4) === 'PNG' ? {width: b.readUInt32BE(16), height: b.readUInt32BE(20)} : null;
  } catch { return null; }
}

/** All of a Remotion request's stills in one process (one bundle, one browser). Times become frames at 30 fps. */
export function remotionBatch(request, renderer, outDir, {node = process.execPath, script = new URL('./remotion-stills.mjs', import.meta.url)} = {}) {
  const frames = [...new Set([...request.frames, ...request.times.map(t => Math.round(t * 30))])];
  return {command: node, args: [fileURLToPath(script), renderer.entry, request.composition, outDir, String(request.scale ?? 0.5), ...frames.map(String)], files: frames.map(f => path.join(outDir, `frame-${f}.png`))};
}

/** Tiles the stills into one small JPEG, so a reviewer reads one image instead of many. */
export function contactSheetArgs(files, out, {tileWidth = 480, size = pngSize(files[0])} = {}) {
  const portrait = size && size.height > size.width;
  const tw = portrait ? 270 : tileWidth, th = portrait ? 480 : Math.round(tileWidth * 9 / 16 / 2) * 2;
  const columns = Math.min(portrait ? 6 : 4, files.length);
  const fit = `scale=${tw}:${th}:force_original_aspect_ratio=decrease,pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2`;
  const graph = files.length === 1 ? `[0:v]${fit}` : files.map((_, i) => `[${i}:v]${fit}[s${i}]`).join(';') + ';' +
    files.map((_, i) => `[s${i}]`).join('') + `xstack=inputs=${files.length}:layout=` + files.map((_, i) => `${(i % columns) * tw}_${Math.floor(i / columns) * th}`).join('|') + ':fill=black';
  return ['-y', '-loglevel', 'error', ...files.flatMap(f => ['-i', f]), '-filter_complex', graph, '-frames:v', '1', '-q:v', '4', out];
}

export function findChrome({browsersPath = null, env = process.env} = {}) {
  const candidates = [env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  if (browsersPath) {
    try {
      for (const dir of fs.readdirSync(browsersPath).filter(d => /^chromium-\d+/.test(d)).sort().reverse()) {
        candidates.push(path.join(browsersPath, dir, 'chrome-win', 'chrome.exe'), path.join(browsersPath, dir, 'chrome-win64', 'chrome.exe'), path.join(browsersPath, dir, 'chrome-linux', 'chrome'));
      }
    } catch {}
  }
  return candidates.find(c => c && fs.existsSync(c)) || null;
}

/**
 * Renders one request. run(command, args, {cwd}) resolves {code, stdout, stderr}. Writes done.json with
 * the stills and the contact sheet, or error.json, into .deltaroute/render/<name>/ and returns the record.
 */
export async function renderStills({cwd, name, request, run, renderCommand = null, chrome = null, ffmpeg = 'ffmpeg'}) {
  if (!NAME.test(name)) throw Error('Invalid render request name');
  const outDir = path.join(cwd, RENDER_DIR, name);
  fs.mkdirSync(outDir, {recursive: true});
  const startedAt = Date.now();
  try {
    const renderer = detectRenderer(cwd, request, {command: renderCommand});
    const stills = [], failed = [];
    let plan = renderPlan(cwd, request, renderer, outDir, {chrome});
    if (renderer.kind === 'remotion') {
      // One bundle for every frame; only frames the batch could not make fall back to one CLI call each.
      const batch = remotionBatch(request, renderer, outDir);
      const r = await run(batch.command, batch.args, {cwd});
      stills.push(...batch.files.filter(f => fs.existsSync(f)));
      if (stills.length === batch.files.length) plan = [];
      else { failed.push({still: 'batch', error: (r.stderr || r.stdout || 'batch render failed').slice(-600)}); plan = plan.filter(shot => !stills.includes(shot.file)); }
    }
    for (const shot of plan) {
      const r = await run(shot.command, shot.args, {cwd});
      if (r.code === 0 && fs.existsSync(shot.file)) stills.push(shot.file); else failed.push({still: shot.label, error: (r.stderr || r.stdout || 'render failed').slice(-600)});
    }
    if (!stills.length) throw Error('No still rendered. ' + (failed[0]?.error || ''));
    let sheet = null;
    const sheetFile = path.join(outDir, 'sheet.jpg');
    const s = await run(ffmpeg, contactSheetArgs(stills, sheetFile), {cwd});
    if (s.code === 0 && fs.existsSync(sheetFile)) sheet = sheetFile;
    const record = {status: 'done', renderer: renderer.kind, stills, sheet, failed, seconds: Math.round((Date.now() - startedAt) / 1000)};
    fs.writeFileSync(path.join(outDir, 'done.json'), JSON.stringify(record, null, 1));
    return record;
  } catch (e) {
    const record = {status: 'error', error: e.message.slice(0, 2000)};
    fs.writeFileSync(path.join(outDir, 'error.json'), JSON.stringify(record, null, 1));
    return record;
  }
}

/** Request files waiting in .deltaroute/render/ that have no result folder yet. */
export function pendingRequests(cwd) {
  const dir = path.join(cwd, RENDER_DIR);
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { return []; }
  return entries.filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(name => NAME.test(name) && !fs.existsSync(path.join(dir, name, 'done.json')) && !fs.existsSync(path.join(dir, name, 'error.json')));
}

/** What a worker needs to know to see its own work. */
export function renderBrief() {
  return 'Seeing your work: you cannot open a browser here, but DeltaRoute renders stills for you. Write .deltaroute/render/check-1.json containing {"frames":[0,45,90],"composition":"<Remotion composition id>"} (or {"times":[0,1.5,3]} for an HTML page; add "target" for a file other than the default). Wait until .deltaroute/render/check-1/done.json (or error.json) appears, polling every 10 s for up to 4 minutes, then open sheet.jpg and fix anything wrong before you finish. Use a new name for each check (check-2, check-3). Before you finish, write .deltaroute/render/final.json with the frames that best show your work; the reviewer starts from those.';
}
