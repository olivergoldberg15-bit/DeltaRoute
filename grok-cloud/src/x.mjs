import {createZernioX} from './zernio.mjs';
// With ZERNIO_API_KEY set, X goes through the owner's Zernio workspace; otherwise straight to the X API.
export function xClient(env, fetchImpl = fetch, charge = () => {}, store = null) {
  return env.ZERNIO_API_KEY ? createZernioX(env, fetchImpl, charge) : createX(env, fetchImpl, charge, store);
}
// X OAuth 2.0 user tokens expire after two hours. With X_CLIENT_ID set, the bot renews its own access token
// from the refresh token that scripts/x-auth.mjs saved in the store (or X_REFRESH_TOKEN to seed it). X rotates
// the refresh token on every use, so the new one is saved at once. Every live X call runs under the job lock.
export const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
export function xTokenRequest(env, params) {
  const headers = {'Content-Type':'application/x-www-form-urlencoded'};
  if (env.X_CLIENT_SECRET) headers.Authorization = 'Basic ' + Buffer.from(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`).toString('base64');
  return {method:'POST', headers, body:new URLSearchParams({...params, client_id:env.X_CLIENT_ID}).toString(), signal:AbortSignal.timeout(20000)};
}
export async function saveXTokens(store, data) {
  if (!data?.access_token) throw new Error('x_token_missing');
  if (data.refresh_token) await store.set('x:refresh_token', data.refresh_token);
  await store.set('x:access_token', data.access_token, Math.max(60, Number(data.expires_in || 7200) - 300));
}
export function xAccess(env, store, fetchImpl = fetch) {
  return async (force = false) => {
    if (!env.X_CLIENT_ID) return env.X_ACCESS_TOKEN;
    if (!store) throw new Error('x_token_store_required');
    if (!force) { const cached = await store.get('x:access_token'); if (cached) return cached; }
    const refresh = await store.get('x:refresh_token') || env.X_REFRESH_TOKEN;
    if (!refresh) throw new Error('x_refresh_token_missing');
    const r = await fetchImpl(X_TOKEN_URL, xTokenRequest(env, {grant_type:'refresh_token', refresh_token:refresh}));
    if (!r.ok) throw new Error('x_token_refresh_failed');
    const data = await r.json(); await saveXTokens(store, data); return data.access_token;
  };
}
export function createX(env, fetchImpl = fetch, charge = () => {}, store = null) {
  const access = xAccess(env, store, fetchImpl);
  async function request(path, body, retried = false) {
    const r = await fetchImpl(`https://api.x.com/2/${path}`, {method:body ? 'POST' : 'GET', headers:{Authorization:`Bearer ${await access()}`, 'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(20000)});
    // A 401 is a clear rejection (nothing was posted), so one retry with a fresh token is safe.
    if (r.status === 401 && env.X_CLIENT_ID && !retried) { await access(true); return request(path, body, true); }
    if (!r.ok) throw new Error('x_http_error');
    const data = await r.json();
    if (!body) await charge(Array.isArray(data.data) ? data.data.length : data.data ? 1 : 0);
    return data;
  }
  const fields = 'tweet.fields=author_id,referenced_tweets,attachments,lang,created_at&expansions=attachments.media_keys,author_id&media.fields=url,preview_image_url,variants,type&user.fields=username';
  return {
    mentions: (since, page, max = 100) => request(`users/${encodeURIComponent(env.X_BOT_ID)}/mentions?${fields}&max_results=${max}${since ? `&since_id=${encodeURIComponent(since)}` : ''}${page ? `&pagination_token=${encodeURIComponent(page)}` : ''}`),
    post: id => request(`tweets/${encodeURIComponent(id)}?${fields}`),
    reply: (id, text) => request('tweets', {text, reply:{in_reply_to_tweet_id:id}})
  };
}
export async function fetchContext(post, x) {
  const thread = [], media = [], seen = new Set();
  let current = post;
  for (let i = 0; i <= 10 && current && !seen.has(current.id); i++) {
    seen.add(current.id);
    const fetched = await x.post(current.id);
    current = fetched.data;
    if (!current) throw new Error('missing_context');
    if (i === 0) post = {...current, username:fetched.includes?.users?.find(u => u.id === current.author_id)?.username};
    else thread.push(current);
    media.push(...(fetched.includes?.media || []));
    const quoted = current.referenced_tweets?.find(r => r.type === 'quoted');
    if (quoted && !seen.has(quoted.id)) {
      seen.add(quoted.id); const q = await x.post(quoted.id);
      if (q.data) thread.push(q.data); media.push(...(q.includes?.media || []));
    }
    const parent = current.referenced_tweets?.find(r => r.type === 'replied_to');
    current = parent ? {id:parent.id} : null;
  }
  return {post, thread, media};
}
