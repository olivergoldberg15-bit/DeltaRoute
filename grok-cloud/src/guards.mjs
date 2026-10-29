export const dryRun = env => env.LIVE !== '1' || env.DRY_RUN === '1';
export function buckets(now) { const iso = now.toISOString(); return {day:iso.slice(0,10), hour:iso.slice(0,13)}; }
export async function guard(post, {env, store, now = new Date()}) {
  const {day, hour} = buckets(now);
  if (env.KILL_SWITCH === '1' || await store.get('kill_switch') === '1') return 'kill_switch';
  if (post.author_id === env.X_BOT_ID) return 'own_post';
  const handle = (env.X_BOT_HANDLE || '').replace(/^@/, '');
  if (!handle || !new RegExp(`@${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(post.text || '')) return 'untagged';
  if (await store.get(`handled:${post.id}`)) return 'dedupe';
  if (await store.get(`cooldown:${post.author_id}`)) return 'cooldown';
  if (Number(await store.get(`hour:${hour}`) || 0) >= Number(env.HOURLY_LIMIT || 20)) return 'hourly_limit';
  if (Number(await store.get(`spend:${day}`) || 0) >= Number(env.DAILY_SPEND_CAP || 10)) return 'spend_cap';
  return null;
}
export async function markHandled(post, {env, store, now = new Date()}) {
  const {day, hour} = buckets(now);
  await store.set(`handled:${post.id}`, '1', 7 * 86400);
  await store.set(`cooldown:${post.author_id}`, '1', Number(env.AUTHOR_COOLDOWN_SECONDS || 600));
  await store.add(`hour:${hour}`, 1); await store.add(`day:${day}`, 1);
}
