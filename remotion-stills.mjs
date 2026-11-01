// Renders several Remotion stills with one bundle and one browser, on the GPU (ANGLE) at a review-sized scale.
// `remotion still` once per frame re-bundled every time and drew 3D on the CPU: 3 stills of the Laws film took
// 144 s; this takes about 2.5 s per still after a few seconds of setup (measured 2026-11-01).
//   node remotion-stills.mjs <entry> <composition> <out dir> <scale> <frame> [frame ...]   (run from the project folder)
// REMOTION_GL overrides the GL backend (angle, swangle, egl, ...).
import {createRequire} from 'node:module';
import path from 'node:path';

const [entry, composition, outDir, scaleArg, ...frames] = process.argv.slice(2);
if (!entry || !composition || !outDir || !frames.length) { console.error('Usage: node remotion-stills.mjs <entry> <composition> <out dir> <scale> <frame> [frame ...]'); process.exit(2); }
const scale = Math.min(1, Math.max(0.1, Number(scaleArg) || 0.5));
const require = createRequire(path.join(process.cwd(), 'package.json'));
const {bundle} = require('@remotion/bundler');
const {selectComposition, renderStill, openBrowser} = require('@remotion/renderer');

const gl = process.env.REMOTION_GL || (process.platform === 'win32' ? 'angle' : null);
const serveUrl = await bundle({entryPoint: path.resolve(entry)});
const browser = await openBrowser('chrome', gl ? {chromiumOptions: {gl}} : {});
try {
  const comp = await selectComposition({serveUrl, id: composition, puppeteerInstance: browser});
  for (const frame of frames.map(Number)) {
    await renderStill({composition: comp, serveUrl, output: path.join(outDir, `frame-${frame}.png`), frame: Math.min(frame, comp.durationInFrames - 1), scale, puppeteerInstance: browser});
  }
} finally {
  await browser.close({silent: true});
}
