import test from 'node:test';
import assert from 'node:assert/strict';
import {checkFormat} from '../src/reply-format.mjs';
test('posting boundary rejects xAI identity, model authorship and remaining markdown',()=>{for(const text of ['I am xAI.','This reply was written by Claude.','*italic*','_italic_','~~strike~~','> quote'])assert.ok(checkFormat(text).length,text);assert.deepEqual(checkFormat('Grok is a product from xAI.'),[]);assert.deepEqual(checkFormat('Use the name event_team.'),[]);});
