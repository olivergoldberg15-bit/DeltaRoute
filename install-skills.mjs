import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const maximumFileBytes = 10 * 1024 * 1024;

/** Resolve a manifest path without allowing traversal or existing symlink parents. */
export function skillTarget(root, relative) {
  if (typeof relative !== 'string' || !/^skill-library\/[a-z][a-z0-9_-]*\//.test(relative) || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test(part))) throw Error('Unsafe skill path');
  const base = path.resolve(root), target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) throw Error('Skill path escapes installation root');
  let current = base;
  if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error('Skill root cannot be a symbolic link');
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw Error('Symbolic link in skill path'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}

export function validateSkillManifest(manifest) {
  if (!Array.isArray(manifest?.skills) || !Array.isArray(manifest?.files) || !Array.isArray(manifest?.families) || manifest.files.length > 2000) throw Error('Invalid skill manifest');
  const families = new Map(manifest.families.map(family => {
    if (!/^[a-z][a-z0-9_-]*$/.test(family.id) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(family.repo) || !/^[a-f0-9]{40}$/.test(family.commit) || typeof family.bundled !== 'boolean') throw Error('Invalid pinned skill family');
    return [family.id, family];
  }));
  if (families.size !== manifest.families.length) throw Error('Duplicate skill family');
  const paths = new Set();
  for (const file of manifest.files) {
    const family = families.get(file.family);
    if (!family || typeof file.path !== 'string' || !file.path.startsWith('skill-library/' + file.family + '/') || paths.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isInteger(file.bytes) || file.bytes < 0 || file.bytes > maximumFileBytes || file.bundled !== family.bundled) throw Error('Invalid skill file');
    skillTarget(ROOT, file.path);
    if (typeof file.upstreamPath !== 'string' || file.upstreamPath.startsWith('/') || file.upstreamPath.includes('\\') || file.upstreamPath.split('/').some(part => !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test(part))) throw Error('Unsafe upstream skill path');
    paths.add(file.path);
  }
  const ids = new Set();
  for (const skill of manifest.skills) {
    if (ids.has(skill.id) || !families.has(skill.family) || !paths.has(skill.path)) throw Error('Invalid skill entry point');
    const file = manifest.files.find(value => value.path === skill.path);
    if (file.sha256 !== skill.sha256 || file.bytes !== skill.bytes) throw Error('Skill entry hash differs from file manifest');
    ids.add(skill.id);
  }
  return families;
}

export function verifySkillFiles(root = ROOT, manifest = JSON.parse(fs.readFileSync(path.join(root, 'skills-manifest.json')))) {
  validateSkillManifest(manifest);
  const missingBundled = [], missingOptional = [], mismatched = [];
  for (const file of manifest.files) {
    const target = skillTarget(root, file.path);
    if (!fs.existsSync(target)) { (file.bundled ? missingBundled : missingOptional).push(file.path); continue; }
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size !== file.bytes || digest(fs.readFileSync(target)) !== file.sha256) mismatched.push(file.path);
  }
  const bad = new Set([...missingBundled, ...missingOptional, ...mismatched]);
  const incompleteFamilies = new Set(manifest.files.filter(file => bad.has(file.path)).map(file => file.family));
  const installed = manifest.skills.filter(skill => !incompleteFamilies.has(skill.family)).map(skill => skill.id);
  return {totalSkills: manifest.skills.length, bundledSkills: manifest.skills.filter(skill => skill.distribution === 'bundled').length, installedSkills: installed.length, missingOptionalSkills: manifest.skills.filter(skill => skill.distribution !== 'bundled' && incompleteFamilies.has(skill.family)).map(skill => skill.id), missingBundled, missingOptional, mismatched, ok: missingBundled.length === 0 && mismatched.length === 0};
}

async function downloadBytes(fetchImpl, url, expectedBytes) {
  const response = await fetchImpl(url, {signal: AbortSignal.timeout(30_000), redirect: 'error'});
  if (!response.ok) throw Error('Skill download returned HTTP ' + response.status);
  const reader = response.body?.getReader();
  if (!reader) throw Error('Skill download has no readable body');
  const chunks = []; let length = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.byteLength;
    if (length > expectedBytes || length > maximumFileBytes) { await reader.cancel(); throw Error('Skill download exceeded pinned file size'); }
    chunks.push(Buffer.from(result.value));
  }
  if (length !== expectedBytes) throw Error('Skill download size mismatch');
  return Buffer.concat(chunks);
}

/** Explicit opt-in downloads only; never invokes a shell, hook, script or package manager. */
export async function installSkillFamilies({root = ROOT, manifest = JSON.parse(fs.readFileSync(path.join(root, 'skills-manifest.json'))), families = [], acknowledgeUnlicensed = false, dryRun = false, fetchImpl = globalThis.fetch} = {}) {
  const definitions = validateSkillManifest(manifest);
  if (!Array.isArray(families) || !families.length) throw Error('Choose at least one skill family');
  const selected = [...new Set(families)];
  for (const name of selected) {
    const definition = definitions.get(name);
    if (!definition) throw Error('Unknown skill family: ' + name);
    if (definition.license === 'NOASSERTION' && !acknowledgeUnlicensed) throw Error(name + ' has no declared upstream license. Review THIRD_PARTY_NOTICES.md and supply --acknowledge-unlicensed only if appropriate for your use; this flag does not grant rights.');
  }
  const pending = [], matched = [];
  for (const file of manifest.files.filter(item => selected.includes(item.family))) {
    const target = skillTarget(root, file.path);
    if (fs.existsSync(target)) {
      const stat = fs.statSync(target);
      if (!stat.isFile() || stat.size !== file.bytes || digest(fs.readFileSync(target)) !== file.sha256) throw Error('Existing skill file differs; preserve your changes and restore/review manually: ' + file.path);
      matched.push(file.path);
    } else {
      if (file.bundled) throw Error('Bundled file is missing; restore the DeltaRoute checkout: ' + file.path);
      if (file.locallyModified) throw Error('Cannot reconstruct a local patch from upstream: ' + file.path);
      pending.push(file);
    }
  }
  // Reference files first. An interrupted download should not expose a new SKILL.md prematurely.
  pending.sort((a, b) => Number(a.path.endsWith('/SKILL.md')) - Number(b.path.endsWith('/SKILL.md')) || a.path.localeCompare(b.path));
  if (dryRun) return {families: selected, matchedFiles: matched.length, pendingFiles: pending.map(file => file.path), downloadsPerformed: 0, scriptsExecuted: 0};
  let downloads = 0;
  for (const file of pending) {
    const definition = definitions.get(file.family);
    const url = 'https://raw.githubusercontent.com/' + definition.repo + '/' + definition.commit + '/' + file.upstreamPath.split('/').map(encodeURIComponent).join('/');
    const bytes = await downloadBytes(fetchImpl, url, file.bytes);
    if (digest(bytes) !== file.sha256) throw Error('Pinned SHA-256 verification failed: ' + file.path);
    const target = skillTarget(root, file.path);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    skillTarget(root, file.path);
    const temporary = target + '.' + crypto.randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, bytes, {flag: 'wx'});
      // Prefer an exclusive atomic link; COPYFILE_EXCL also supports hosts disallowing hard links.
      try {
        try { fs.linkSync(temporary, target); } catch (error) {
          if (!['EPERM', 'ENOTSUP', 'EXDEV', 'EACCES'].includes(error.code)) throw error;
          fs.copyFileSync(temporary, target, fs.constants.COPYFILE_EXCL);
        }
      } catch (error) {
        if (error.code !== 'EEXIST' || digest(fs.readFileSync(target)) !== file.sha256) throw error;
      }
    } finally { try { fs.unlinkSync(temporary); } catch {} }
    downloads++;
  }
  return {families: selected, matchedFiles: matched.length, downloadedFiles: downloads, scriptsExecuted: 0};
}

async function main() {
  const args = process.argv.slice(2), manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills-manifest.json')));
  validateSkillManifest(manifest);
  if (!args.length || args.includes('--list')) {
    console.log(JSON.stringify(manifest.families.map(family => ({family: family.id, skills: manifest.skills.filter(skill => skill.family === family.id).length, license: family.license, bundled: family.bundled, note: family.licenseNote || null})), null, 2));
    return;
  }
  if (args.includes('--verify')) {
    const result = verifySkillFiles(ROOT, manifest);
    console.log(JSON.stringify({...result, missingOptional: result.missingOptional.length}, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const families = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--family') { if (!args[index + 1] || args[index + 1].startsWith('--')) throw Error('--family requires a family name'); families.push(args[++index]); }
    else if (argument === '--all') families.push(...manifest.families.map(family => family.id));
    else if (!['--acknowledge-unlicensed', '--dry-run'].includes(argument)) throw Error('Unknown option: ' + argument);
  }
  console.log(JSON.stringify(await installSkillFamilies({manifest, families, acknowledgeUnlicensed: args.includes('--acknowledge-unlicensed'), dryRun: args.includes('--dry-run')}), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
