// generate_media: "make me an image with Nano Banana Pro" from any chat, in one call. A plain model name is
// mapped to where it runs: Higgsfield (credits, priced and capped first), Codex's image tool (ChatGPT plan,
// no credits) or Grok Imagine on grok.com through the research browser (experimental). Nothing falls back to
// another platform on its own: the user named one, so a failure is reported, not redone elsewhere.
import fs from 'node:fs';
import path from 'node:path';
import {withBrowser} from './browser.mjs';
import {isImageBytes} from './image-jobs.mjs';

// Friendly names first; any other Higgsfield job type (see `higgsfield model list`) passes straight through.
const ALIASES = [
  [/^(nano ?banana ?pro|nbp|gemini 3 pro image)$/, {via: 'higgsfield', model: 'nano_banana_pro', kind: 'image'}],
  [/^nano ?banana ?2(\.1)?$/, {via: 'higgsfield', model: 'nano_banana_2_1', kind: 'image'}],
  [/^nano ?banana ?(2 ?)?lite$/, {via: 'higgsfield', model: 'nano_banana_2_lite', kind: 'image'}],
  [/^nano ?banana$/, {via: 'higgsfield', model: 'nano_banana_pro', kind: 'image'}],
  [/^(chatgpt|chat ?gpt ?images?|gpt[- ]?image|openai|codex)$/, {via: 'codex', model: null, kind: 'image'}],
  [/^(grok|grok ?imagine|imagine)$/, {via: 'grok', model: null, kind: 'image'}],
  [/^(seedream|seedream ?5( pro)?)$/, {via: 'higgsfield', model: 'seedream_v5_pro', kind: 'image'}],
  [/^(flux|flux ?3)$/, {via: 'higgsfield', model: 'flux_3_image', kind: 'image'}],
  [/^(seedance|seedance ?2(\.0)?)$/, {via: 'higgsfield', model: 'seedance_2_0', kind: 'video'}],
  [/^seedance ?2\.5$/, {via: 'higgsfield', model: 'seedance_2_5', kind: 'video'}],
  [/^(veo|veo ?3(\.1)?|google veo)$/, {via: 'higgsfield', model: 'veo3_1', kind: 'video'}],
  [/^(kling|kling ?4(\.0)?)$/, {via: 'higgsfield', model: 'kling4_0', kind: 'video'}],
  [/^(wan|wan ?3(\.0)?)$/, {via: 'higgsfield', model: 'wan3_0', kind: 'video'}],
  [/^(hailuo|minimax)$/, {via: 'higgsfield', model: 'minimax_hailuo', kind: 'video'}],
  [/^grok ?video$/, {via: 'higgsfield', model: 'grok_video_v15', kind: 'video'}],
];
const VIDEO_TYPES = /seedance|veo|kling|wan\d|hailuo|video|omni|genjutsu/;

/** Where a named model runs. kind is taken from the model when the caller leaves it out. */
export function resolveMedia(name, kind = null) {
  const key = String(name || '').toLowerCase().trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!key) return kind === 'video' ? {via: 'higgsfield', model: 'seedance_2_0', kind: 'video'} : {via: 'higgsfield', model: 'nano_banana_pro', kind: 'image'};
  for (const [pattern, target] of ALIASES) if (pattern.test(key)) {
    if (kind && kind !== target.kind) throw Error(`${name} makes ${target.kind}s, not ${kind}s`);
    return {...target};
  }
  const jobType = String(name).toLowerCase().trim();
  if (/^[a-z0-9][a-z0-9_]{1,60}$/.test(jobType)) return {via: 'higgsfield', model: jobType, kind: kind || (VIDEO_TYPES.test(jobType) ? 'video' : 'image')};
  throw Error(`Unknown model "${name}". Use a name like nano banana pro, chatgpt, grok imagine, seedance or veo, or any Higgsfield job type from "higgsfield model list".`);
}

/** A short safe file name from the prompt. */
export function mediaFileName(prompt, index, kind) {
  const slug = String(prompt).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'media';
  return `${slug}${index ? '-' + (index + 1) : ''}.${kind === 'video' ? 'mp4' : 'png'}`;
}

/** The images.* request an image job takes, built from generate_media's arguments. */
export function mediaJobSpec(a, target) {
  const count = Math.min(4, Math.max(1, Number(a.count) || 1));
  return {kind: target.kind, ...(target.model ? {model: target.model} : {}), ...(a.deliver_to ? {deliver_to: a.deliver_to} : {}), ...(a.max_credits !== undefined ? {max_credits: a.max_credits} : {}),
    outputs: Array.from({length: count}, (_, i) => ({file: mediaFileName(a.prompt, count > 1 ? i : 0, target.kind), prompt: a.prompt, aspect_ratio: a.aspect_ratio || (target.kind === 'video' ? '16:9' : '1:1'), resolution: a.resolution || '2k', ...(a.references ? {references: a.references} : {}), ...(target.kind === 'video' && a.duration ? {duration: a.duration} : {})}))};
}

/**
 * Grok Imagine on grok.com (experimental). Sends the prompt on /imagine, waits for new generated images, then
 * opens each image's own address so the page can read its bytes same-origin. Returns the files it saved.
 */
export async function grokImagine({spec, outDir, cfg, root, timeoutMs = 240000}) {
  fs.mkdirSync(outDir, {recursive: true});
  return withBrowser(cfg, root, async ({browse, goto}) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    // gstack prints objects as JSON; a plain string may come back bare.
    const js = async code => { const out = await browse('js', code); try { return JSON.parse(out); } catch { return String(out).trim(); } };
    const listImages = async () => (await js('[...document.querySelectorAll("img")].map(i=>i.src).filter(s=>/assets\\.grok\\.com\\/users\\//.test(s))'));
    const saved = [];
    for (const o of spec.outputs) {
      await goto('https://grok.com/imagine');
      const box = '[role="textbox"][contenteditable="true"]';
      if (!(await browse('wait', box, '25000').then(() => true, () => false))) throw Error('Grok Imagine did not show its prompt box (signed out or the page changed). Run research-login.ps1 grok.');
      const before = new Set(await listImages());
      await browse('fill', box, o.prompt + (o.aspect_ratio && o.aspect_ratio !== '1:1' ? ` (aspect ratio ${o.aspect_ratio})` : ''));
      await browse('press', 'Enter');
      let fresh = [], stable = 0;
      const sent = Date.now();
      while (Date.now() - sent < timeoutMs) {
        await sleep(4000);
        const body = String(await js('document.body.innerText.slice(0,3000)'));
        if (/verify you are human|checking your browser/i.test(body)) throw Error('Grok showed a browser challenge. No bypass attempted.');
        const now = (await listImages()).filter(s => !before.has(s));
        stable = now.length && now.length === fresh.length ? stable + 1 : 0;
        fresh = now;
        if (stable >= 2) break;
      }
      if (!fresh.length) throw Error('Grok Imagine produced no new image in time; nothing was saved.');
      await goto(fresh[0]);
      const b64 = String(await js('(async()=>{const r=await fetch(location.href);const b=new Uint8Array(await r.arrayBuffer());let s="";for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s);})()'));
      const bytes = Buffer.from(b64, 'base64');
      if (!isImageBytes(bytes)) throw Error('Grok Imagine returned something that is not an image');
      fs.writeFileSync(path.join(outDir, o.file), bytes);
      saved.push({file: o.file, source: fresh[0]});
    }
    return saved;
  });
}

/** ffmpeg arguments for a small JPEG preview (first frame of a video), so a chat can see the result cheaply. */
export function previewArgs(file, out, {width = 640} = {}) {
  const video = /\.(mp4|webm|mov)$/i.test(file);
  return ['-y', '-loglevel', 'error', ...(video ? ['-ss', '1'] : []), '-i', file, '-vf', `scale='min(${width},iw)':-2`, '-frames:v', '1', '-q:v', '5', out];
}
