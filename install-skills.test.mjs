import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {testTempRoot} from './test-fixtures.mjs';
import {skillTarget, validateSkillManifest, verifySkillFiles, installSkillFamilies} from './install-skills.mjs';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function fixture(t, {bundled = false} = {}) {
  const root = fs.mkdtempSync(path.join(testTempRoot, 'deltaroute-skills-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const bodies = new Map([['skills/example/SKILL.md', Buffer.from('---\nname: example\n---\nBounded guidance\n')], ['skills/example/references/info.md', Buffer.from('Reference\n')]]);
  const files = [...bodies].map(([upstreamPath, bytes]) => ({family: 'example', path: 'skill-library/example/' + upstreamPath.slice('skills/'.length), upstreamPath, bytes: bytes.length, sha256: sha(bytes), bundled, locallyModified: false}));
  const entry = files.find(file => file.path.endsWith('/SKILL.md'));
  const manifest = {families: [{id: 'example', repo: 'example/skills', commit: 'a'.repeat(40), license: bundled ? 'MIT' : 'NOASSERTION', bundled}], files, skills: [{id: 'example/example', family: 'example', path: entry.path, sha256: entry.sha256, bytes: entry.bytes, distribution: bundled ? 'bundled' : 'optional-upstream-download'}]};
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({url, options}); const upstream = url.split('/' + 'a'.repeat(40) + '/')[1]; return new Response(bodies.get(upstream), {status: 200}); };
  return {root, manifest, bodies, calls, fetchImpl};
}

test('public bundle verifies 31 bundled skills and six explicit optional entries offline', () => {
  const result = verifySkillFiles();
  assert.equal(result.ok, true);
  assert.equal(result.totalSkills, 37);
  assert.equal(result.bundledSkills, 31);
  assert.ok(result.installedSkills >= 31);
  assert.equal(result.mismatched.length, 0);
});
test('unlicensed source installation requires deliberate acknowledgment before any network operation', async t => {
  const f = fixture(t);
  await assert.rejects(installSkillFamilies({...f, families: ['example']}), /acknowledge-unlicensed/);
  assert.equal(f.calls.length, 0);
  assert.equal(fs.existsSync(path.join(f.root, 'skill-library')), false);
});
test('dry-run reports downloads without network or filesystem mutations', async t => {
  const f = fixture(t);
  const result = await installSkillFamilies({...f, families: ['example'], acknowledgeUnlicensed: true, dryRun: true});
  assert.equal(result.pendingFiles.length, 2);
  assert.equal(result.downloadsPerformed, 0);
  assert.equal(result.scriptsExecuted, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(fs.existsSync(path.join(f.root, 'skill-library')), false);
});
test('downloads pin original URLs and verify hashes; references precede the entry point and reruns skip verified files', async t => {
  const f = fixture(t);
  const result = await installSkillFamilies({...f, families: ['example'], acknowledgeUnlicensed: true});
  assert.equal(result.downloadedFiles, 2);
  assert.equal(result.scriptsExecuted, 0);
  assert.match(f.calls[0].url, /references\/info\.md$/);
  assert.match(f.calls[1].url, /SKILL\.md$/);
  assert.ok(f.calls.every(call => call.url.startsWith('https://raw.githubusercontent.com/example/skills/' + 'a'.repeat(40) + '/')));
  assert.ok(f.calls.every(call => call.options.redirect === 'error'));
  const second = await installSkillFamilies({...f, families: ['example'], acknowledgeUnlicensed: true});
  assert.equal(second.downloadedFiles, 0);
  assert.equal(f.calls.length, 2);
  assert.equal(verifySkillFiles(f.root, f.manifest).installedSkills, 1);
});
test('altered bytes with matching size are rejected before becoming a local file', async t => {
  const f = fixture(t);
  const fetchImpl = async url => { const upstream = url.split('/' + 'a'.repeat(40) + '/')[1]; return new Response(Buffer.alloc(f.bodies.get(upstream).length, 88)); };
  await assert.rejects(installSkillFamilies({...f, fetchImpl, families: ['example'], acknowledgeUnlicensed: true}), /SHA-256/);
  assert.equal(fs.existsSync(path.join(f.root, 'skill-library/example/example/SKILL.md')), false);
});
test('overlong responses and failed HTTP requests do not create an entry point', async t => {
  const f = fixture(t);
  await assert.rejects(installSkillFamilies({...f, fetchImpl: async () => new Response('x'.repeat(200)), families: ['example'], acknowledgeUnlicensed: true}), /exceeded pinned file size/);
  await assert.rejects(installSkillFamilies({...f, fetchImpl: async () => new Response('not found', {status: 404}), families: ['example'], acknowledgeUnlicensed: true}), /HTTP 404/);
  assert.equal(fs.existsSync(path.join(f.root, 'skill-library/example/example/SKILL.md')), false);
});
test('existing local changes are preserved and block any network download', async t => {
  const f = fixture(t), target = skillTarget(f.root, f.manifest.files[0].path);
  fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, 'User edits');
  await assert.rejects(installSkillFamilies({...f, families: ['example'], acknowledgeUnlicensed: true}), /preserve your changes/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'User edits');
  assert.equal(f.calls.length, 0);
});
test('missing bundled files require restoring checkout rather than executing an upstream installer', async t => {
  const f = fixture(t, {bundled: true});
  await assert.rejects(installSkillFamilies({...f, families: ['example']}), /restore the DeltaRoute checkout/);
  assert.equal(f.calls.length, 0);
  assert.equal(verifySkillFiles(f.root, f.manifest).ok, false);
});
test('manifest rejects traversal, duplicate paths, mutable refs and nonpinned entry points', t => {
  const f = fixture(t);
  for (const target of ['../outside', 'skill-library/example/../../outside', 'skill-library/example/C:/outside', 'skill-library/example/a\\b']) assert.throws(() => skillTarget(f.root, target), /Unsafe/);
  const mutable = structuredClone(f.manifest); mutable.families[0].commit = 'main';
  assert.throws(() => validateSkillManifest(mutable), /pinned skill family/);
  const duplicate = structuredClone(f.manifest); duplicate.files.push({...duplicate.files[0]});
  assert.throws(() => validateSkillManifest(duplicate), /Invalid skill file/);
  const modified = structuredClone(f.manifest); modified.skills[0].sha256 = '0'.repeat(64);
  assert.throws(() => validateSkillManifest(modified), /hash differs/);
});
