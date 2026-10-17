import fs from 'node:fs';

// Setup resolves executables to absolute paths. A script is optional for native
// CLIs and required only when the configured executable is their JS runtime.
export function workerLaunch(worker) {
  if (!worker?.command) throw Error('Worker executable is not configured; run setup.ps1.');
  return {command: worker.command, prefix: worker.script ? [worker.script] : []};
}

export function workerInstalled(worker) {
  return Boolean(worker?.command && fs.existsSync(worker.command) &&
    (!worker.script || fs.existsSync(worker.script)));
}
