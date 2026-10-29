import {endpoint} from '../src/http.mjs';
import {dryRun,buckets} from '../src/guards.mjs';
export async function status({env,store}){
 const {day,hour}=buckets(new Date());
 return {mode:dryRun(env)?'dry-run':'live',kill_switch:env.KILL_SWITCH==='1'||await store.get('kill_switch')==='1',hour:Number(await store.get(`hour:${hour}`)||0),day:Number(await store.get(`day:${day}`)||0),spend:Number(await store.get(`spend:${day}`)||0),runs:await store.list('logs',20)};
}
export default endpoint(status);
