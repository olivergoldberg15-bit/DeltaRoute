import test from 'node:test';
import assert from 'node:assert/strict';
import {search} from '../src/search.mjs';
test('planning then both search tools, deduplicated evidence',async()=>{const tools=[];const result=await search({},async(role,req)=>{if(!req.tools)return {text:JSON.stringify({x:['a','b'],web:['c','d']})};tools.push(req.tools[0].type);return {text:JSON.stringify({sources:[{url:'https://source.test',title:'Primary',excerpt:'Evidence'}]})};});assert.deepEqual(tools,['x_search','web_search']);assert.equal(result.sources.length,1);});
