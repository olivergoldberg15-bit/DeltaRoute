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
export function mediaFileName(prompt, index, kind, ext = kind === 'video' ? 'mp4' : 'png') {
  const slug = String(prompt).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'media';
  return `${slug}${index ? '-' + (index + 1) : ''}.${ext}`;
}

/** The images.* request an image job takes, built from generate_media's arguments. */
export function mediaJobSpec(a, target) {
  const count = Math.min(4, Math.max(1, Number(a.count) || 1));
  return {kind: target.kind, ...(target.model ? {model: target.model} : {}), ...(a.deliver_to ? {deliver_to: a.deliver_to} : {}), ...(a.max_credits !== undefined ? {max_credits: a.max_credits} : {}),
    outputs: Array.from({length: count}, (_, i) => ({file: mediaFileName(a.prompt, count > 1 ? i : 0, target.kind, target.via === 'grok' ? 'jpg' : undefined), prompt: a.prompt, aspect_ratio: a.aspect_ratio || (target.kind === 'video' ? '16:9' : '1:1'), resolution: a.resolution || '2k', ...(a.references ? {references: a.references} : {}), ...(target.kind === 'video' && a.duration ? {duration: a.duration} : {})}))};
}

// Grok Imagine shows each result as an embedded data: JPEG (seen 2026-11-01, 768x1152, two per prompt); some
// results load from the account's generated/ address instead. imagine-public.x.ai is the public example feed,
// which keeps loading after the page opens, so it never counts. Small images (avatars, icons) are left out.
// A key per image (length and tail for data:, the address otherwise) tells new results from what was already there.
export const GROK_IMAGE_SCAN = '[...document.querySelectorAll("img")].filter(i=>i.naturalWidth>=512&&(i.src.startsWith("data:image/")||/assets\\.grok\\.com\\/users\\/[^/]+\\/generated\\//.test(i.src))).map(i=>i.src.startsWith("data:")?"data:"+i.src.length+":"+i.src.slice(-48):i.src)';
export function decodeDataImage(src) {
  const m = /^data:image\/[a-z+]+;base64,(.+)$/s.exec(String(src).trim());
  return m ? Buffer.from(m[1], 'base64') : null;
}

/**
 * Grok Imagine on grok.com (experimental). Sends the prompt on /imagine, waits until its new results stop changing,
 * then saves the first one: decoded when embedded, else fetched, drawn to canvas or captured from the loaded img.
 */
export async function grokImagine({spec, outDir, cfg, root, timeoutMs = 240000}) {
  fs.mkdirSync(outDir, {recursive: true});
  return withBrowser(cfg, root, async ({browse, goto}) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    // gstack prints objects as JSON; a plain string may come back bare.
    const js = async code => { const out = await browse('js', code); try { return JSON.parse(out); } catch { return String(out).trim(); } };
    const listImages = async () => { const r = await js(GROK_IMAGE_SCAN); return Array.isArray(r) ? r : []; };
    const saved = [];
    for (const o of spec.outputs) {
      await goto('https://grok.com/imagine');
      const box = '[role="textbox"][contenteditable="true"]';
      if (!(await browse('wait', box, '25000').then(() => true, () => false))) throw Error('Grok Imagine did not show its prompt box (signed out or the page changed). Run research-login.ps1 grok.');
      // A cookie banner over the box is answered with Reject All, never Accept, as in research.
      await js('(()=>{const b=[...document.querySelectorAll("button")].find(b=>/^reject all$/i.test(b.innerText.trim()));if(b)b.click();return "ok"})()');
      const before = new Set(await listImages());
      await browse('fill', box, o.prompt + (o.aspect_ratio && o.aspect_ratio !== '1:1' ? ` (aspect ratio ${o.aspect_ratio})` : ''));
      await browse('press', 'Enter');
      let fresh = [], stable = 0;
      const sent = Date.now();
      while (Date.now() - sent < timeoutMs) {
        await sleep(4000);
        const body = String(await js('document.body.innerText.slice(0,3000)'));
        if (/verify you are human|checking your browser/i.test(body)) throw Error('Grok showed a browser challenge. No bypass attempted.');
        // Out of Imagine allowance, grok.com opens its plans page (#subscribe) instead of generating (seen 2026-11-01).
        const page = await js('({hash:location.hash,upsell:[...document.querySelectorAll("[role=dialog]")].some(d=>/unlock your creativity with imagine|get plus|upgrade/i.test(d.innerText))})');
        if (page?.hash === '#subscribe' || page?.upsell) throw Error('Grok Imagine limit reached: grok.com asked to upgrade the plan instead of generating. Nothing was bought. Try again after the limit resets, or use nano banana pro or chatgpt.');
        // A result can sharpen in place (new key, same count), so stable means the same keys twice in a row.
        const now = (await listImages()).filter(k => !before.has(k));
        stable = now.length && now.join('|') === fresh.join('|') ? stable + 1 : 0;
        fresh = now;
        if (stable >= 2) break;
      }
      if (!fresh.length) throw Error('Grok Imagine produced no new image in time; nothing was saved.');
      let bytes;
      if (fresh[0].startsWith('data:')) {
        const src = String(await js(`(()=>{const keys=${GROK_IMAGE_SCAN};const imgs=[...document.querySelectorAll("img")].filter(i=>i.naturalWidth>=512&&(i.src.startsWith("data:image/")||/assets\\.grok\\.com\\/users\\/[^/]+\\/generated\\//.test(i.src)));return imgs[keys.indexOf(${JSON.stringify(fresh[0])})]?.src||""})()`));
        bytes = decodeDataImage(src) || Buffer.alloc(0);
      } else {
        // Stay on Imagine: navigating away can discard the loaded pixels or revoke a blob URL.
        const src = JSON.stringify(fresh[0]), failures = [];
        const attempt = async (step, read) => {
          try {
            const result = await read();
            if (!isImageBytes(result)) throw Error('returned something that is not an image');
            return result;
          } catch (e) {
            failures.push(`${step}: ${String(e.message || e).split('\n')[0].replace(/^page\.evaluate:\s*/, '').slice(0, 300)}`);
            return null;
          }
        };
        bytes = await attempt('in-page fetch', async () => Buffer.from(String(await js(`(async()=>{const r=await fetch(${src});if(!r.ok)throw Error("HTTP "+r.status);const b=new Uint8Array(await r.arrayBuffer());let s="";for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s);})()`)), 'base64'));
        if (!bytes) bytes = await attempt('loaded-image canvas', async () => decodeDataImage(await js(`(()=>{const i=[...document.querySelectorAll("img")].find(i=>i.src===${src});if(!i||!i.complete||!i.naturalWidth)throw Error("Generated image is no longer loaded");i.setAttribute("data-deltaroute-save","");const c=document.createElement("canvas");c.width=i.naturalWidth;c.height=i.naturalHeight;c.getContext("2d").drawImage(i,0,0);return c.toDataURL("image/jpeg",0.95);})()`)));
        // gstack captures rendered pixels without reading a cross-origin canvas. This last resort is a PNG.
        if (!bytes) bytes = await attempt('gstack element screenshot', async () => {
          const dir = fs.mkdtempSync(path.join(outDir, '.grok-save-'));
          try {
            const file = path.resolve(dir, 'image.png');
            await browse('screenshot', file, '--selector', 'img[data-deltaroute-save]');
            return fs.readFileSync(file);
          } finally { fs.rmSync(dir, {recursive: true, force: true}); }
        });
        if (!bytes) throw Error('Grok Imagine could not save its generated image. ' + failures.join('; '));
      }
      if (!isImageBytes(bytes)) throw Error('Grok Imagine returned something that is not an image');
      fs.writeFileSync(path.join(outDir, o.file), bytes);
      saved.push({file: o.file, source: fresh[0].startsWith('data:') ? 'https://grok.com/imagine' : fresh[0]});
    }
    return saved;
  });
}

/** ffmpeg arguments for a small JPEG preview (first frame of a video), so a chat can see the result cheaply. */
export function previewArgs(file, out, {width = 640} = {}) {
  const video = /\.(mp4|webm|mov)$/i.test(file);
  return ['-y', '-loglevel', 'error', ...(video ? ['-ss', '1'] : []), '-i', file, '-vf', `scale='min(${width},iw)':-2`, '-frames:v', '1', '-q:v', '5', out];
}
