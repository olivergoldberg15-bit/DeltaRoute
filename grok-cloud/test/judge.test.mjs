import test from 'node:test';
import assert from 'node:assert/strict';
import {judge} from '../src/judge.mjs';
test('judge requires two answers and breaks score ties by length',async()=>{await assert.rejects(judge({},[],()=>{}),/insufficient/);const result=await judge({},[{model:'a',text:'longer'},{model:'b',text:'short'}],async()=>({text:JSON.stringify({scores:[{model:'a',score:90},{model:'b',score:90}],winner:'a'})}));assert.equal(result.winner,'b');await assert.rejects(judge({},[{model:'a'},{model:'b'}],async()=>({text:'{}'})),/invalid_judge/);});
