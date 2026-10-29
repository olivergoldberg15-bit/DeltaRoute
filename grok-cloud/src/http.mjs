import {RedisStore} from './store.mjs';
export function endpoint(action) {
 return async(req,res)=>{
  const env=process.env;
  if(!env.CRON_SECRET||req.headers?.authorization!==`Bearer ${env.CRON_SECRET}`)return res.status(401).json({error:'unauthorized'});
  try{return res.status(200).json(await action({env,store:new RedisStore(env)}));}
  catch{return res.status(500).json({error:'job_failed'});}
 };
}
