export function createX(env, fetchImpl = fetch, charge = () => {}) {
  async function request(path, body) {
    const r = await fetchImpl(`https://api.x.com/2/${path}`, {method:body ? 'POST' : 'GET', headers:{Authorization:`Bearer ${env.X_ACCESS_TOKEN}`, 'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(20000)});
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
