// Preserve the previously reviewed checker; close additional contract cases
// at the posting boundary without modifying that module.
import {checkFormat as baseCheck} from './format.mjs';
export function checkFormat(text,options) {
 const reasons=baseCheck(text,options);
 if(typeof text!=='string')return reasons;
 if(/\b(?:I\s+am|I'm|I\u2019m|as)\s+(?:an?\s+)?(?:xai|x\.ai)\b/i.test(text)||/\b(?:this\s+(?:reply|answer)|I)\s+(?:was|is|am)\s+(?:written|generated|produced|powered)\s+by\s+(?:grok|claude|gpt[\w.-]*|chatgpt|gemini|xai|x\.ai|openai|anthropic|google)\b/i.test(text))reasons.push('model_reference');
 if(/(?:^|\s)(?:\*[^*\n]+\*|_[^_\n]+_)(?=$|[\s.,!?])|~~[^~\n]+~~|^\s*>\s/m.test(text))reasons.push('markdown');
 return [...new Set(reasons)];
}
