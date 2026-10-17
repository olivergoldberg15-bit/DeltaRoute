/** Maintainer tool: audit a local selected-skill library against pinned upstream Git blobs. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = process.argv.indexOf('--source');
if (at < 0 || !process.argv[at + 1]) throw Error('Usage: node scripts/package-skills.mjs --source <local-library-root>');
const source = path.resolve(process.argv[at + 1]);
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'skills-manifest.json')));
const families = {
  blender: {repo: 'arjun988/blender-skills', commit: '8f778d2405a214b508d4c7d80742be8e43acdd52', prefix: '.claude/skills', license: 'MIT', licenseFiles: ['LICENSE'], bundled: true},
  context: {repo: 'muratcankoylan/Agent-Skills-for-Context-Engineering', commit: '9ff0c99108b36d3b886defd825d8ac1f47dba374', prefix: 'skills', license: 'MIT', licenseFiles: ['LICENSE'], bundled: true},
  creative: {repo: 'anthropics/skills', commit: 'dbd4588f9e1033efb41dad4bef2f7947c8993d44', prefix: 'skills', license: 'Apache-2.0', licenseFiles: ['THIRD_PARTY_NOTICES.md'], bundled: true},
  media: {repo: 'bradautomates/claude-video', commit: '03ceb42f7fa2c4439aca01752118044baabffb8f', prefix: 'skills', license: 'MIT', licenseFiles: ['LICENSE'], bundled: true},
  threejs: {repo: 'CloudAI-X/threejs-skills', commit: 'b1c623076c661fc9b03dac19292e825a5d106823', prefix: 'skills', license: 'MIT', licenseFiles: ['README.md'], bundled: true, licenseNote: 'MIT declaration in pinned README; no standalone LICENSE file upstream.'},
  remotion: {repo: 'remotion-dev/skills', commit: '1441a11e95db35443bd76bb318386c0d3ca00053', prefix: 'skills', license: 'NOASSERTION', licenseFiles: [], bundled: false, licenseNote: 'No license declaration found in the pinned recursive tree, README or package.json. Explicit download acknowledgment does not grant rights.'},
  verification: {repo: 'obra/superpowers', commit: 'bb92a77741419a4ab5f06e711a283343f1ada0c3', prefix: 'skills', license: 'MIT', licenseFiles: ['LICENSE'], bundled: true},
};
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const gitsha = bytes => crypto.createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
function api(endpoint) {
  const result = spawnSync('gh', ['api', endpoint], {encoding: 'utf8', maxBuffer: 30 * 1024 * 1024, windowsHide: true});
  if (result.status !== 0) throw Error(result.stderr || 'GitHub metadata fetch failed');
  return JSON.parse(result.stdout);
}
function files(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) return [];
    if (entry.isSymbolicLink()) throw Error('Unexpected symbolic link');
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : entry.isFile() ? [file] : [];
  });
}
const resources = [], modifications = [];
for (const [family, definition] of Object.entries(families)) {
  const tree = api(`repos/${definition.repo}/git/trees/${definition.commit}?recursive=1`);
  if (tree.truncated) throw Error('Truncated upstream tree');
  const blobs = new Map(tree.tree.filter(item => item.type === 'blob').map(item => [item.path, item.sha]));
  const base = path.join(source, 'skill-library', family);
  for (const local of files(base)) {
    const relative = path.relative(base, local).replaceAll('\\', '/');
    const upstreamPath = relative === 'LICENSE' ? 'LICENSE' : definition.prefix + '/' + relative;
    const upstreamGitBlob = blobs.get(upstreamPath);
    if (!upstreamGitBlob) throw Error('Local file lacks pinned upstream provenance: ' + family + '/' + relative);
    let bytes = fs.readFileSync(local);
    // Git checkouts may normalize line endings. Package the byte-identical upstream form.
    const normalized = Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'));
    if (gitsha(bytes) !== upstreamGitBlob && gitsha(normalized) === upstreamGitBlob) bytes = normalized;
    const locallyModified = gitsha(bytes) !== upstreamGitBlob;
    if (locallyModified) {
      if (family !== 'media' || relative !== 'watch/scripts/download.py') throw Error('Unexpected local modification: ' + family + '/' + relative);
      bytes = Buffer.from(bytes.toString().replace(/^#!([^\r\n]*)(\r?\n)/, '#!$1$2# Modified by DeltaRoute, 2026-10-17: isolated downloads, bounded captions and yt-dlp --ignore-config.\n'));
      modifications.push({path: 'skill-library/' + family + '/' + relative, upstreamGitBlob, sha256: sha256(bytes), reason: 'Local adapter changes: safe URL/local file handling, per-run download isolation, bounded captions, and yt-dlp --ignore-config. Upstream version is retained; this file is modified.'});
    }
    const destination = 'skill-library/' + family + '/' + relative;
    resources.push({path: destination, family, upstreamPath, sha256: sha256(bytes), bytes: bytes.length, upstreamGitBlob, locallyModified, bundled: definition.bundled});
    if (definition.bundled) {
      const target = path.join(root, destination);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, bytes);
    }
  }
  for (const upstreamPath of definition.licenseFiles) {
    const remote = api(`repos/${definition.repo}/contents/${upstreamPath}?ref=${definition.commit}`);
    const bytes = Buffer.from(remote.content, 'base64');
    if (gitsha(bytes) !== blobs.get(upstreamPath)) throw Error('License blob mismatch');
    const name = upstreamPath === 'README.md' ? 'UPSTREAM_README.md' : upstreamPath;
    const destination = 'skill-library/' + family + '/' + name;
    if (resources.some(item => item.path === destination)) continue;
    resources.push({path: destination, family, upstreamPath, sha256: sha256(bytes), bytes: bytes.length, upstreamGitBlob: blobs.get(upstreamPath), locallyModified: false, bundled: definition.bundled});
    fs.mkdirSync(path.dirname(path.join(root, destination)), {recursive: true});
    fs.writeFileSync(path.join(root, destination), bytes);
  }
}
manifest.reviewedAt = new Date().toISOString();
manifest.policy = 'Third-party instructions load on demand. Bundled files retain upstream licensing and provenance. No script, hook, dependency install, browser login, audio upload or model call is executed by skill installation. Optional unlicensed sources require an explicit download acknowledgment.';
manifest.families = Object.entries(families).map(([id, definition]) => ({id, ...definition, source: 'https://github.com/' + definition.repo + '/tree/' + definition.commit}));
manifest.skills = manifest.skills.map(skill => {
  const definition = families[skill.family];
  const upstreamPath = skill.source.split('/tree/')[1].split('/').slice(1).join('/');
  const file = resources.find(resource => resource.path === skill.path);
  return {...skill, sha256: file.sha256, bytes: file.bytes, commit: definition.commit, source: 'https://github.com/' + definition.repo + '/tree/' + definition.commit + '/' + upstreamPath, license: definition.license, distribution: definition.bundled ? 'bundled' : 'optional-upstream-download', licenseNote: definition.licenseNote || null};
});
manifest.files = resources;
manifest.localPatches = modifications;
fs.writeFileSync(path.join(root, 'skills-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({skills: manifest.skills.length, bundled: manifest.skills.filter(skill => skill.distribution === 'bundled').length, optional: manifest.skills.filter(skill => skill.distribution !== 'bundled').length, files: resources.length, modifications}, null, 2));
