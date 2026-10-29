// One-time sign-in for the bot's own X account (OAuth 2.0 with PKCE). The owner runs this locally:
// it prints the X approval link, catches X's redirect on 127.0.0.1, and saves the tokens straight into
// the bot's Upstash store, so no token is printed or committed. After this the bot renews its own token.
// Needs X_CLIENT_ID (plus X_CLIENT_SECRET for a confidential app), UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN. The X app's callback URL must match X_REDIRECT_URI (default below).
import crypto from 'node:crypto';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {RedisStore} from '../src/store.mjs';
import {X_TOKEN_URL,xTokenRequest,saveXTokens} from '../src/x.mjs';
export const X_SCOPES = 'tweet.read tweet.write users.read offline.access';
export const DEFAULT_REDIRECT = 'http://127.0.0.1:8723/callback';
export function pkce() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  return {verifier, challenge:crypto.createHash('sha256').update(verifier).digest('base64url'), state:crypto.randomBytes(16).toString('base64url')};
}
export function authorizeUrl({clientId, redirectUri = DEFAULT_REDIRECT, challenge, state}) {
  return 'https://x.com/i/oauth2/authorize?' + new URLSearchParams({response_type:'code', client_id:clientId, redirect_uri:redirectUri, scope:X_SCOPES, state, code_challenge:challenge, code_challenge_method:'S256'});
}
export async function exchangeCode({env, store, code, verifier, redirectUri = DEFAULT_REDIRECT, fetchImpl = fetch}) {
  const r = await fetchImpl(X_TOKEN_URL, xTokenRequest(env, {grant_type:'authorization_code', code, redirect_uri:redirectUri, code_verifier:verifier}));
  if (!r.ok) throw new Error('x_code_exchange_failed');
  const data = await r.json();
  if (!data.refresh_token) throw new Error('x_no_refresh_token: the app must request offline.access');
  await saveXTokens(store, data);
  const me = await fetchImpl('https://api.x.com/2/users/me', {headers:{Authorization:`Bearer ${data.access_token}`}, signal:AbortSignal.timeout(20000)});
  return me.ok ? (await me.json()).data : null;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env, redirectUri = env.X_REDIRECT_URI || DEFAULT_REDIRECT;
  if (!env.X_CLIENT_ID) throw new Error('Set X_CLIENT_ID (and X_CLIENT_SECRET for a confidential app) first.');
  const store = new RedisStore(env), {verifier, challenge, state} = pkce(), url = new URL(redirectUri);
  const server = http.createServer(async (req, res) => {
    const got = new URL(req.url, redirectUri);
    if (got.pathname !== url.pathname) { res.writeHead(404).end(); return; }
    try {
      if (got.searchParams.get('state') !== state) throw new Error('state_mismatch');
      if (!got.searchParams.get('code')) throw new Error(got.searchParams.get('error') || 'no_code');
      const me = await exchangeCode({env, store, code:got.searchParams.get('code'), verifier, redirectUri});
      res.writeHead(200, {'Content-Type':'text/plain'}).end('Signed in. You can close this tab.');
      console.log('Saved the bot\'s X tokens in the store. It renews its own access token from now on.');
      if (me) console.log(`Signed in as @${me.username}. Set X_BOT_ID=${me.id} and X_BOT_HANDLE=${me.username} in Vercel.`);
    } catch (e) { res.writeHead(400, {'Content-Type':'text/plain'}).end('Sign-in failed: ' + e.message); console.error('Sign-in failed:', e.message); process.exitCode = 1; }
    server.close();
  });
  server.listen(Number(url.port || 80), url.hostname, () => console.log('Sign in as the bot account and approve:\n' + authorizeUrl({clientId:env.X_CLIENT_ID, redirectUri, challenge, state})));
}
