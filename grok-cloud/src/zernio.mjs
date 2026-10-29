// X through Zernio (https://docs.zernio.com): the bot's X account is connected once in the owner's Zernio
// workspace, and Zernio holds its permissions and rotates its tokens. Same shape as createX in x.mjs, so the
// pipeline does not change. Zernio has no X mentions feed, so tags are found with X search on the bot's
// @handle (last 7 days). Its tweet lookup returns the parent post but not quoted posts or media.
export const ZERNIO_API = 'https://zernio.com/api/v1';
const toPost = t => ({id:t.id, text:t.text, author_id:t.author?.id, lang:t.lang, created_at:t.created, conversation_id:t.conversationId, referenced_tweets:t.inReplyToTweetId ? [{type:'replied_to', id:t.inReplyToTweetId}] : []});
const toUser = t => t.author?.id ? [{id:t.author.id, username:t.author.username}] : [];
export function createZernioX(env, fetchImpl = fetch, charge = () => {}) {
  const base = env.ZERNIO_BASE_URL || ZERNIO_API, accountId = env.ZERNIO_ACCOUNT_ID, handle = (env.X_BOT_HANDLE || '').replace(/^@/, '');
  if (!accountId) throw new Error('zernio_account_required');
  async function request(path, init = {}) {
    const r = await fetchImpl(`${base}/${path}`, {...init, headers:{Authorization:`Bearer ${env.ZERNIO_API_KEY}`, 'Content-Type':'application/json', ...init.headers}, signal:AbortSignal.timeout(20000)});
    if (!r.ok && r.status !== 207) throw new Error('zernio_http_error');
    return {status:r.status, data:await r.json()};
  }
  const query = params => new URLSearchParams(Object.entries({accountId, ...params}).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return {
    async mentions(since, page, max = 100) {
      if (!handle) throw new Error('x_bot_handle_required');
      const {data} = await request(`twitter/search?${query({query:`@${handle} -from:${handle}`, limit:Math.min(100, Math.max(10, max)), sinceId:since, cursor:page})}`);
      const tweets = data.tweets || []; await charge(tweets.length);
      return {data:tweets.map(toPost), includes:{users:tweets.flatMap(toUser)}, meta:{newest_id:data.meta?.newestId ?? undefined, next_token:data.pagination?.hasMore ? data.pagination.cursor : undefined}};
    },
    async post(id) {
      const {data} = await request(`twitter/tweet?${query({tweetId:id})}`);
      if (!data.tweet) return {data:null};
      await charge(1);
      return {data:toPost(data.tweet), includes:{users:toUser(data.tweet), media:[]}};
    },
    // One Idempotency-Key per answered post: a retry returns the original reply instead of posting twice.
    async reply(id, text) {
      const {data} = await request('posts', {method:'POST', headers:{'Idempotency-Key':`grok-cloud-reply-${id}`}, body:JSON.stringify({content:text, platforms:[{platform:'twitter', accountId, platformSpecificData:{replyToTweetId:id}}], publishNow:true})});
      const sent = data.post?.platforms?.find(p => p.platform === 'twitter');
      if (sent?.status !== 'published') throw new Error('zernio_publish_failed');
      return {data:{id:sent.platformPostId, text, url:sent.platformPostUrl}};
    }
  };
}
// The connected X accounts in the Zernio workspace, for setup (ids and handles, never keys).
export async function zernioXAccounts(env, fetchImpl = fetch) {
  const r = await fetchImpl(`${env.ZERNIO_BASE_URL || ZERNIO_API}/accounts?platform=twitter`, {headers:{Authorization:`Bearer ${env.ZERNIO_API_KEY}`}, signal:AbortSignal.timeout(20000)});
  if (!r.ok) throw new Error('zernio_http_error');
  return ((await r.json()).accounts || []).map(a => ({accountId:a._id, username:a.username, xUserId:a.platformUserId}));
}
