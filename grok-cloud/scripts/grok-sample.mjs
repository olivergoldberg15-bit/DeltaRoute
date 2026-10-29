import {appendFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import config from '../models.config.json' with {type:'json'};
import {callModel,parseJSON} from '../src/models.mjs';
export async function sample(count,{env=process.env,provider=callModel}={}) {
 if(!env.XAI_API_KEY)throw Error('XAI_API_KEY_required');
 if(!Number.isInteger(count)||count<1||count>100)throw Error('count_1_to_100');
 const result=await provider(config.models[config.presets[env.PRESET||'top'].search],{env,tools:[{type:'x_search',allowed_x_handles:['grok']}],system:'Retrieve actual recent replies authored by @grok using X Search, not recollections or invented examples. Return JSON {replies:[{id,url,text,created_at,question,question_url}]}. Include original post links and dates; omit anything unverifiable.',input:`Retrieve ${count} recent public replies by @grok. Fetch their threads for the original questions.`});
 const replies=parseJSON(result.text).replies;
 if(!Array.isArray(replies))throw Error('invalid_sample');
 return replies.filter(r=>/^https:\/\/(?:x\.com|twitter\.com)\/grok\/status\/\d+/.test(r.url)&&r.text&&r.created_at).slice(0,count).map(r=>({...r,retrieved_at:new Date().toISOString(),method:'xai_x_search'}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){for(const row of await sample(Number(process.argv[2]||10)))await appendFile(process.argv[3]||'grok-sample.jsonl',JSON.stringify(row)+'\n');}
