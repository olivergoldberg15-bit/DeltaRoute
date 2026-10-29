import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../models.config.json' with {type:'json'};
import {toolCost} from '../src/cost.mjs';
test('reported tool usage is charged as reported',()=>{assert.equal(toolCost(config.prices,{x_search:2,web_search:0},[{type:'x_search'}]),0.01);});
test('unreported tool usage is charged at the spec estimate, never zero',()=>{
 assert.equal(toolCost(config.prices,{},[{type:'x_search'}]),15*0.005);
 assert.equal(toolCost(config.prices,undefined,[{type:'web_search'}]),4*0.005);
 assert.equal(toolCost(config.prices,{},[]),0);
});
