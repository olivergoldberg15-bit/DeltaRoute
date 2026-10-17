import {classifyFailure} from './fallback-policy.mjs';
export function hasUsableSource(packet){return [...(packet.sources||[]).map(s=>s.url),...(String(packet.answer||'').match(/https?:\/\/[^\s<>"')]+/g)||[])].some(u=>{try{return ['https:','http:'].includes(new URL(u).protocol);}catch{return false;}});}
export function primaryDomains(prompt){
 const text=String(prompt);if(!/official|original|primary/i.test(text))return [];
 const domains=new Set();for(const u of text.match(/https?:\/\/[^\s<>"')]+/g)||[]){try{domains.add(new URL(u).hostname.replace(/^www\./,''));}catch{}}
 if(/Google Developers Blog|Google announcement/i.test(text))domains.add('developers.googleblog.com');
 return [...domains];
}
export function missingPrimarySources(packet,domains){const urls=[...(packet.sources||[]).map(s=>s.url),...(String(packet.answer||'').match(/https?:\/\/[^\s<>"')]+/g)||[])];return domains.filter(d=>!urls.some(u=>{try{const h=new URL(u).hostname;return h===d||h.endsWith('.'+d);}catch{return false;}}));}
export async function collectResearchEvidence(prompt,fetchPacket,fallback=null){
 const domains=primaryDomains(prompt),requiresCitations=domains.length>0||/\b(cite|sources?|research|current|social|search)\b/i.test(prompt);let packet,attempts=0,recoveryReason=null;
 const missing=p=>{const m=missingPrimarySources(p,domains);if(requiresCitations&&!m.length&&!hasUsableSource(p))m.push('at least one usable original source URL');return m;};
 for(let attempt=0;attempt<2;attempt++){
  const followup=attempt?'\n\nSOURCE REPAIR: The previous result missed required primary sources: '+missingPrimarySources(packet,domains).join(', ')+'. Follow the original links and return their full direct URLs, exact dates, and verified facts. Do not substitute a secondary summary. Candidate pages from the previous result: '+JSON.stringify((packet.sources||[]).slice(0,5))+'. Previous answer: '+String(packet.answer||'').slice(0,1200):'';
  attempts++;try{packet=await fetchPacket(prompt+followup);}catch(e){const failure=classifyFailure(e.message);if(!fallback||!failure.fallbackEligible)throw e;recoveryReason=failure.kind;break;}const absent=missing(packet);
  if(!absent.length)return {...packet,sourceValidation:{attempts,requiredDomains:domains,passed:true}};
 }
 if(fallback){const direct=await fallback(domains);if(!missing(direct).length)return {...direct,sourceValidation:{attempts:attempts+1,requiredDomains:domains,passed:true,fallback:'gstack-primary-search',recoveryReason}};}
 throw Error('Required primary sources missing after 2 source-collection attempts: '+(packet?missing(packet):['source provider unavailable']).join(', ')+'. No downstream analysis launched.');
}
export function sourceCollectionPrompt(task){
 const question=String(task).split(/(?<=[.!?])\s+/).filter(s=>! /^(?:Do not|Keep |State that social|Social reactions|Use only)/i.test(s)).join(' ').replace(/^Use the collected source packet to state\s*/i,'').replace(/^Use the collected packet (?:for|to state)\s*/i,'');
 return 'Search the web and find primary sources for this factual question: '+question+'\nRequired primary publisher domains: '+(primaryDomains(task).join(', ')||'original publishers')+'. Return exact dates and full direct original URLs. Follow links to the original announcement. Report unavailable social posts honestly.';
}
export function selectPrimarySearchLinks(links,domain){return links.filter(a=>{try{const u=new URL(a.url);return u.protocol==='https:'&&(!domain?(a.result===true&&!['www.google.com','google.com'].includes(u.hostname)||a.result===true&&u.pathname==='/url'&&['www.google.com','google.com'].includes(u.hostname)):(u.hostname===domain||u.hostname.endsWith('.'+domain)||(['www.google.com','google.com'].includes(u.hostname)&&u.pathname==='/url'&&String(a.title).includes(domain))));}catch{return false;}}).filter((a,i,all)=>all.findIndex(b=>b.url===a.url)===i);}
