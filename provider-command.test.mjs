import test from 'node:test';
import assert from 'node:assert/strict';
import {workerLaunch, workerInstalled} from './provider-command.mjs';

test('native CLIs and packaged JavaScript CLIs get distinct argument prefixes', () => {
  assert.deepEqual(workerLaunch({command: '/agent'}), {command: '/agent', prefix: []});
  assert.deepEqual(workerLaunch({command: '/node', script: '/agent.js'}),
    {command: '/node', prefix: ['/agent.js']});
  assert.throws(() => workerLaunch({script: '/agent.js'}), /not configured/);
});

test('installation requires both configured executable and optional script', () => {
  assert.equal(workerInstalled({command: process.execPath}), true);
  assert.equal(workerInstalled({command: process.execPath, script: '/nonexistent-deltaroute.js'}), false);
  assert.equal(workerInstalled({command: '/nonexistent-deltaroute-agent'}), false);
  assert.equal(workerInstalled({}), false);
});
