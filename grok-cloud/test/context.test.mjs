import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichMedia,MEDIA_NOT_VIEWED} from '../src/context.mjs';
test('media analysis is shared evidence',async()=>{const pack=await enrichMedia({post:{text:'question'},media:[{type:'photo',url:'https://img.test/a.jpg'},{type:'video',variants:[{content_type:'video/mp4',url:'https://img.test/a.mp4'}]}]},async(role,req)=>{assert.equal(req.media[0].type,'input_image');assert.equal(req.media[1].type,'input_video');return {text:'Visible event; audio uncertain.'};});assert.match(pack.media_analysis,/uncertain/);assert.equal(pack.media_note,undefined);});
test('unviewable media is stated in the pack, never invented and never fatal',async()=>{
 const failed=await enrichMedia({post:{text:'is this real?'},media:[{type:'video',variants:[{content_type:'video/mp4',url:'https://img.test/a.mp4'}]}]},async()=>{throw Error('provider_http_error');});
 assert.equal(failed.media_analysis,null);assert.equal(failed.media_note,MEDIA_NOT_VIEWED);
 let called=false;const none=await enrichMedia({post:{text:'q'},media:[{type:'video'}]},async()=>{called=true;return {text:'x'};});
 assert.equal(called,false);assert.equal(none.media_note,MEDIA_NOT_VIEWED);
 const partial=await enrichMedia({post:{text:'q'},media:[{type:'photo',url:'https://img.test/a.jpg'},{type:'animated_gif'}]},async()=>({text:'A chart.'}));
 assert.equal(partial.media_analysis,'A chart.');assert.equal(partial.media_note,MEDIA_NOT_VIEWED);
});
