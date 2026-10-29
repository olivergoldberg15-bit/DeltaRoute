import test from 'node:test';
import assert from 'node:assert/strict';
import poll from '../api/poll.mjs';
import outreach from '../api/outreach.mjs';
import status from '../api/status.mjs';
for(const handler of [poll,outreach,status])test('cron auth fails closed',async()=>{let code;await handler({headers:{}},{status(n){code=n;return this;},json(){}});assert.equal(code,401);});
