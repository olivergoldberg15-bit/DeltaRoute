export const fixtureProvider=async(model,req)=> {
 const s=req.system||'';let text='The available primary evidence supports this answer, with some uncertainty.';
 if(s.startsWith('Return JSON'))text=JSON.stringify({x:['one','two'],web:['one','two']});
 if(req.tools)text=JSON.stringify({sources:[{url:'https://example.test/evidence',title:'Primary source',published_at:null,excerpt:'Evidence'}]});
 if(s.startsWith('Judge'))text=JSON.stringify({scores:req.input.candidates.map(c=>({model:c.model,score:90})),winner:req.input.candidates[0].model});
 return {text,usage:{input:10,output:10}};
};
export const fixtureX={post:async id=>({data:{id,text:'@helper What is supported?',author_id:'person',lang:'en'},includes:{users:[{id:'person',username:'person'}]}}),reply:()=>{throw Error('must not post');}};
