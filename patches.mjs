// Commit-free integration. A worker's change leaves its worktree as one binary patch, made by DeltaRoute
// outside the worker's sandbox (Codex's sandbox cannot write Git metadata), and the scope audit reads only
// that patch, so other steps' and the coordinator's own changes never count against it.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {isRuntimePath} from './deadline.mjs';

// DeltaRoute's coordination files (board, outbox, renders, signals) and gstack's runtime folder.
const EXCLUDE = [':(exclude).deltaroute', ':(exclude).gstack'];

function git(cwd, args, {env = process.env, trim = true} = {}) {
  const r = spawnSync('git', args, {cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 512 * 1024 * 1024});
  if (r.status !== 0) throw Error((r.stderr || r.error?.message || 'Git command failed').trim());
  return trim ? r.stdout.trim() : r.stdout;
}

/**
 * Writes everything changed in worktree since baseRef (untracked files included) to file.
 * A throwaway index keeps the worktree's own index untouched. Returns {file, paths, bytes}.
 */
export function exportPatch(worktree, baseRef, file) {
  const index = path.resolve(file + '.index');
  const env = {...process.env, GIT_INDEX_FILE: index};
  fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true});
  try {
    git(worktree, ['read-tree', baseRef], {env});
    git(worktree, ['add', '-A', '--', '.', ...EXCLUDE], {env});
    const patch = git(worktree, ['diff', '--cached', '--binary', '--no-renames', '--full-index', baseRef, '--'], {env, trim: false});
    const paths = git(worktree, ['diff', '--cached', '--no-renames', '--name-only', '-z', baseRef, '--'], {env}).split('\0').filter(p => p && !isRuntimePath(p));
    fs.writeFileSync(file, patch);
    return {file: path.resolve(file), paths, bytes: Buffer.byteLength(patch)};
  } finally {
    fs.rmSync(index, {force: true});
  }
}

/** File paths a saved patch touches, read from its diff headers. */
export function patchPaths(patchText) {
  const found = new Set();
  for (const m of String(patchText).matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) { found.add(m[1]); found.add(m[2]); }
  return [...found].filter(p => !isRuntimePath(p));
}

/**
 * Applies a saved patch to the working tree of cwd (nothing is committed). Falls back to a three-way
 * apply when the plain one does not fit. Returns {applied, method, paths} or throws with Git's reason.
 */
export function applyPatch(cwd, file) {
  const text = fs.readFileSync(file, 'utf8');
  const paths = patchPaths(text);
  if (!text.trim()) return {applied: false, method: null, paths, note: 'The patch is empty; there is nothing to apply.'};
  try {
    git(cwd, ['apply', '--check', '--whitespace=nowarn', file]);
    git(cwd, ['apply', '--whitespace=nowarn', file]);
    return {applied: true, method: 'apply', paths};
  } catch (plain) {
    try {
      git(cwd, ['apply', '--3way', '--whitespace=nowarn', file]);
      return {applied: true, method: '3way', paths, note: 'Applied with a three-way merge; the files are staged. Check for conflict markers.'};
    } catch (threeWay) {
      throw Error('The patch does not apply to this checkout: ' + threeWay.message.slice(0, 1500));
    }
  }
}
