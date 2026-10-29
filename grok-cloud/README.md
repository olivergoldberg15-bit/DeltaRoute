# grok-cloud

Node 22+ ES modules, fetch only, no runtime dependencies. Deploy as a separate
Vercel project with Root Directory `grok-cloud` and Node 22. Pro cron runs the
mention poll every minute and Hive outreach daily. No deployment is performed
by these scripts.

Set the environment names in `.env.example` yourself in Vercel. Never commit
values. X_ACCESS_TOKEN must authorize the bot's own user to read mentions and
create replies using the official X API; an app-only bearer cannot post.
CRON_SECRET protects all three endpoints with `Authorization: Bearer ...`.
Upstash REST is required in production; MemoryStore is only for offline tests.
HIVE_ORGANIZATION_ID identifies the Atlas Hive organization.

`PRESET=top` is the default; `lean` selects the cheaper configured ensemble.
Prices and dated Gemini prices live in models.config.json. Default guards:
20 replies/hour, 600-second per-author cooldown, $10 UTC daily spend cap.
DRY_RUN is effective unless LIVE is exactly 1; DRY_RUN=1 always wins.
KILL_SWITCH=1 or Redis kill_switch=1 stops work. ALLOW_LINKS defaults off.
Do not enable LIVE until the owner approves, X approves AI replies, the account
has its automation label and its own identity, and dry-run review passes.

X through Zernio (recommended): connect the bot's X account once in your
Zernio dashboard (zernio.com), create a Zernio API key, then run
`node grok-cloud/scripts/zernio-setup.mjs` with ZERNIO_API_KEY set. It prints
ZERNIO_ACCOUNT_ID, X_BOT_ID and X_BOT_HANDLE for Vercel. With ZERNIO_API_KEY
set, the bot finds tags with X search on its @handle, reads threads with
Zernio's tweet lookup and replies through `POST /v1/posts` with one
Idempotency-Key per answered post. Zernio holds the X permissions and rotates
the tokens, so no X developer app, X_ACCESS_TOKEN or x-auth step is needed.
Limits: X search covers the last 7 days, and Zernio's lookup returns the
parent post but not quoted posts or media. X usage is billed by Zernio at X's
pass-through rates.

Direct X sign-in (without Zernio): an OAuth 2.0 user access token expires after about two hours, so
the bot renews its own. Set X_CLIENT_ID (and X_CLIENT_SECRET for a
confidential app) and the Upstash variables locally, add
`http://127.0.0.1:8723/callback` as a callback URL in the X app, then run
`node grok-cloud/scripts/x-auth.mjs` once and approve as the bot account. It
saves the tokens straight into the store (nothing is printed) and tells you
X_BOT_ID and X_BOT_HANDLE. With X_CLIENT_ID set in Vercel, each run uses the
cached access token, renews it from the stored refresh token when it expires,
saves X's rotated refresh token, and retries once on a 401. Without
X_CLIENT_ID the fixed X_ACCESS_TOKEN is used, which is enough for dry-run
reads. The replay script always uses the fixed token so it never rotates the
deployed bot's refresh token.

The first poll on an empty store only records the newest mention and answers
nothing, so a fresh deploy never replies to old tags. Media that cannot be
viewed is stated in the evidence pack, never described, and never stops a
reply. Unreported search usage is charged at 15 X posts and 4 web searches per
call so the spend cap does not under-count.

Run `npm test` from the repository root. All grok-cloud tests use fixtures and
stubbed providers/fetch; they never use personal login state or API accounts.
`node grok-cloud/scripts/replay.mjs posts.jsonl output.jsonl` forces dry-run,
but uses configured APIs for context/search/answers. Tests inject fixtures for
an entirely offline replay. Fixtures are synthetic, not observed production data.
`node grok-cloud/scripts/grok-sample.mjs 10 sample.jsonl` explicitly invokes
paid xAI X Search to retrieve current original @grok reply examples at review
time. It does not scrape X; the script was not executed against a real API.

Authenticated GET /api/status returns counters, spend and the last 20 logs.
Logs are structured JSON objects, serialized one per JSONL line when exported;
Redis keeps the last 5,000. They contain sources, candidate scores, selection,
final reply, timing, usage and costs, never provider headers or raw errors.
X read/reply costs and reported model/tool usage accrue to spend:<UTC day>.
Tool usage must be supplied by the API to be counted; missing usage is not a
verified zero-cost run. Prices are estimates, not billing reconciliation.

Outreach only queues proposals into Redis outreach_queue and logs, for a
separately approved Atlas integration. It never sends email. Source pages must
actually contain the address; unpublished/pattern-built addresses are rejected.
Every proposal carries fit/contact source URLs and requires Oliver's approval
in Atlas before sending from hivesales.info. Redis list values are JSON strings,
so the queue can be exported as one value per JSONL line. No Atlas code changes.

Media URLs are passed to xAI for a shared visual description; unsupported or
unavailable attachments stop the run. Actual image/video/audio coverage needs
verification against the live provider. Search verification and language
or dialect fidelity depend on model judgment. Live provider compatibility, real
API usage metadata, X authorization and Vercel execution need owner-run checks.
Never retry an ambiguous live posting failure blindly: dedupe is reserved first.
