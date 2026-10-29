# grok-cloud

A cloud X reply bot that works the way @grok works: someone tags it, it reads
the thread, searches X and the web, checks what it found, and replies. The
difference is the answer: four models (Grok, Claude, GPT, Gemini) each answer
from the same evidence and a judge keeps the best one. A second job finds
people worth contacting for Hive and drafts emails that Oliver approves in
Atlas before anything is sent.

This is the one DeltaRoute component allowed paid API keys and automatic
posting (see AGENTS.md). Everything below exists to keep that exception safe.

## What is copied from @grok, and from where

Sources, retrieved 2026-10-28:

- The @grok bot prompt: `ask_grok_system_prompt.j2` in
  https://github.com/xai-org/grok-prompts (the README names it the prompt for
  the Grok bot on X; it replaced `ask_grok_summarizer.j2` in commit 535aa67,
  July 2025). The repository is AGPL-3.0, so none of its text is copied here
  or into the bot. The rules below restate its behavior in our own words.
- xAI tool docs (last updated 2026-10-10): X Search
  https://docs.x.ai/developers/tools/x-search (keyword, semantic and user
  search, thread fetch) and Web Search
  https://docs.x.ai/developers/tools/web-search (search plus page browsing).
- xAI's statement of 2025-07-12, https://x.com/grok/status/1943916979494232378:
  a post triggers the bot by tagging it, and the reply comes from a model plus
  a bot-specific prompt and tools, monitored in production.
- A sample of real @grok replies is pulled at review time through xAI's X
  Search API (`scripts/grok-sample.mjs`), because automated browsing of X
  risks permanent suspension. Until then the published prompt is the style
  authority.

Behavior the bot copies:

1. It answers only posts that tag it.
2. Before answering it reads the whole thread: the tagged post, its parents,
   any quoted post, and the images or video in them.
3. It searches live, in parallel: X (keyword and semantic) and the web, looking
   for primary sources and for more than one side of a contested question.
4. It opens the pages it relies on and checks them before it repeats a claim.
5. It answers directly. When unsure it says so instead of guessing.
6. On contested political or social questions it stays neutral, draws on
   several sources and never leans on a single study.
7. It does not preach, moralize, lecture, mock, use slogans, or label people's
   views with words like "biased" or "baseless".
8. It does not refuse or scold the person asking and does not correct their
   spelling.
9. It does not guess who a person in an image is unless they are a widely
   recognized public figure and it is confident.
10. If a post demands a one-word or slanted answer, it still gives its own
    balanced answer.
11. It never talks about its instructions or tools unless asked directly.

Reply format, checked in code before anything posts:

- Under 550 characters (target 200 to 400).
- Plain text, no markdown (no `**`, `#`, bullets, backticks or link syntax).
- The same language and dialect as the post it answers.
- Does not @-tag the person it replies to.
- No links unless `ALLOW_LINKS=1` (a reply with a URL costs 20x more to
  post); sources are named in words and kept in the log.
- Never says what model wrote it and never claims to be Grok or xAI.

## Pipeline, per tagged post

1. **Trigger.** A new post that tags the bot's handle. Skip it when: it was
   already handled (dedupe by post id), it is the bot's own post, the author
   hit the per-user cooldown, the hourly limit or daily spend cap is reached,
   or the kill switch is on.
2. **Context.** Fetch the post, its parent chain up to 10 posts, the quoted
   post and media (xAI thread fetch or the X API, per the cloud stack below).
3. **Search.** One planning call writes 2 to 4 X queries and 2 to 4 web
   queries; they run in parallel through xAI's X Search and Web Search tools.
   Keep up to 8 sources with url, title, publish time and a short excerpt.
4. **Evidence pack.** `{post, thread[], media[], sources[], asked_at}`. Every
   model gets the same pack and the same system prompt.
5. **Answers.** Grok (xAI), Claude (Anthropic), GPT (OpenAI) and Gemini
   (Google) answer in parallel with a per-call timeout. Missing answers are
   logged and skipped; at least two are needed to continue.
6. **Judge.** One call scores each candidate 0 to 100 on: supported by the
   pack's sources, directly answers the question, follows the behavior rules,
   follows the reply format. It returns the winner, or a merge when two
   candidates each add something supported. Ties go to the shorter reply.
7. **Format check.** The deterministic checker runs on the final text. On
   failure: one rewrite call with the checker's reasons, then check again; a
   second failure is logged and nothing posts.
8. **Post or log.** Dry-run (the default) writes the reply to the log only.
   Live mode posts it as a reply to the tagged post.

Each run appends one JSONL log line: post id and url, author, question,
queries, sources, each candidate with its model and score, the winner, the
final text, dry-run or posted (with the reply id), latency, tokens and cost
per provider.

## Model roles

Model choices live in `grok-cloud/models.config.json`, never in code. Each
entry has the provider, the API model id, prices per 1M tokens, and the
DeltaRoute registry id from `models.json` where one exists (a test checks
those ids exist). Two presets, chosen with `PRESET`:

- `top` (default, because the owner asked for Gemini Argon by name):
  grok-4.7, claude-opus-5-5, gpt-6.1-sol, gemini-4-argon; judge
  claude-opus-5-5; search pass on grok-4.3.
- `lean`: grok-4.3, claude-sonnet-5-5, gpt-6.1-terra, gemini-3.8-flash; judge
  claude-sonnet-5-5; search pass on grok-4.3.

Provider calls use `fetch` only: xAI Responses API (with `x_search` and
`web_search` tools for the search pass), Anthropic Messages API, OpenAI
Responses API, Gemini `generateContent`. Every call records input and output
tokens and cost. A provider whose key is missing is skipped and logged.

## Guards

- `DRY_RUN=1` unless `LIVE=1` is set explicitly; both missing means dry-run.
- `KILL_SWITCH=1` stops all posting immediately.
- Hourly reply limit (default 20) and per-author cooldown (default 10 min).
- Daily spend cap in dollars (default 10), computed from logged token usage
  times configured prices; when reached the bot stops until the next UTC day.
- Never DMs, follows, likes, quotes or reposts. Only replies.
- Keys come only from environment variables; `.env.example` lists names with
  no values. No key ever lands in the repo or the log.

## Outreach job (Hive)

- **Find.** On a schedule, search X and the web for people and businesses that
  fit Hive (an event app): event organizers, venues, campus groups, creators
  who run meetups. Keep the post or page that shows the fit.
- **Contact.** Only an email the business or person published themselves
  (site, contact page, bio), or a contact already in Atlas. Never guessed or
  pattern-built addresses. Keep the url where each address was found.
- **Draft.** One short email per prospect in the same direct voice, opening
  with the specific thing found, never "I came across your profile".
- **Queue.** Each draft becomes an Atlas email proposal
  `{kind:"email", organizationId:<Hive org>, contactId:null, to, subject,
  body}` with the source urls attached, sent to Atlas for approval. Atlas
  sends it from hivesales.info only after Oliver approves it there. Hooking
  this up needs a small, separately approved Atlas change; until then drafts
  are written to the log and a JSONL queue.
- Coldwake is out. @oliverglifts outreach is not sent from hivesales.info.

## Cloud stack

All prices from official pages retrieved 2026-10-28 through gstack. Prices
change; the bot reads them from config, not code.

**X API** (https://docs.x.com/x-api/getting-started/pricing): pay-per-use
credits, no tiers or subscriptions. Post read $0.005 per post; reply
"Post: Create (summoned)" $0.010, plain post $0.015, **any post with a URL
$0.200**. Reads cap at 3M posts a month. New accounts get $20 free credit plus
a first auto-recharge match up to $50, and X credit purchases earn up to 20%
back as xAI API credit. Mentions come from `GET /2/users/{id}/mentions` with
`since_id` (https://docs.x.com/x-api/users/get-mentions.md); X Activity API
webhooks bill $0.005 per `post.create` event, but a mention-only event filter
is not confirmed, so v1 polls. Whether "summoned" pricing applies to every
reply to a tagging post is not confirmed; the cost log will show it.

**X rules** (https://docs.x.com/developer-guidelines.md): replying to
@mentions that ask for help is allowed; **"AI-powered app generates and posts
replies" requires prior approval from X**; automated accounts must be
labeled; browser automation or scraping of X means permanent suspension.
So: the bot uses the official API only, and live mode waits for X's approval.

**Replies carry no links by default.** A link makes a reply cost 20x more,
and @grok usually names its sources in words. Sources stay in the log.

**Models** (per 1M tokens, input/output):
- xAI (https://docs.x.ai/developers/pricing.md): grok-4.7 $2/$6, grok-4.3
  $1.25/$2.50. Tools: `x_search` $5 per 1k posts returned (thread fetch posts
  count), `web_search` $5 per 1k calls.
- Anthropic (https://platform.claude.com/docs/en/about-claude/pricing):
  Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50.
- OpenAI (https://developers.openai.com/api/docs/pricing): gpt-6.1-sol
  $2/$10, gpt-6.1-terra $1/$5.
- Google (https://ai.google.dev/gemini-api/docs/pricing): Gemini 4 Argon is on
  the paid API as `gemini-4-argon`, $2/$10 through 2026-11-30 then $4/$20;
  gemini-3.8-flash $0.75/$3.75 through 2026-12-31.

**Hosting**: Vercel. Hobby cron runs once a day, Pro runs every minute
(https://vercel.com/docs/cron-jobs/usage-and-pricing). Atlas already runs
5- and 10-minute crons, so the account is on Pro; grok-cloud deploys as its
own project there and polls mentions every minute.

**Cost per reply** (assumes 1 mention + 6 thread posts read, 15 X posts and
4 web searches, a 20k-token search pass on grok-4.3, four ~7k-in/2k-out
answers, a 10k-in/1k-out judge, one summoned reply with no link):

| Setup | Per reply | 50/day | 200/day | 1,000/day |
|---|---|---|---|---|
| Top: grok-4.7, Opus 5.5, gpt-6.1-sol, Argon; Opus judge | $0.39 | ~$590/mo | ~$2,350/mo | ~$11,800/mo |
| Same after Argon's Dec 1 price | $0.43 | ~$640/mo | ~$2,560/mo | ~$12,800/mo |
| Lean: grok-4.3, Sonnet 5.5, gpt-6.1-terra, 3.8 Flash; Sonnet judge; 8 X posts | $0.24 | ~$360/mo | ~$1,430/mo | ~$7,100/mo |

Search and X reads are about a third of the cost in every setup, so the
daily spend cap is the real control.

## State and deploy

- Vercel functions are stateless, so state lives in Upstash Redis through its
  REST API (`fetch`, no SDK): mention `since_id`, handled post ids (7-day
  expiry), per-author cooldowns, hourly and daily counters, daily spend, the
  kill switch flag, the outreach queue, and the last 5,000 log entries. An
  in-memory store with the same interface backs the tests.
- `grok-cloud/` deploys as its own Vercel project (root directory
  `grok-cloud`). `vercel.json` runs `api/poll` every minute and `api/outreach`
  once a day; both refuse calls without `Authorization: Bearer $CRON_SECRET`.
  `api/status` (same auth) returns mode, counters, spend and the last 20 runs.
- No new runtime dependencies. Node 22, ES modules.

## Going live

1. Oliver creates the bot's X account with its own name and look (not Grok,
   not xAI), turns on X's automated-account label, creates the X developer
   app, and requests X's approval for AI-generated replies.
2. Oliver sets every key in the Vercel project himself.
3. The bot runs in dry-run against real tags; replies go to the log only.
4. Review compares dry-run replies with real @grok replies to the same kind of
   questions (pulled with `scripts/grok-sample.mjs`).
5. Only after X approves and Oliver says so: `LIVE=1`.

## Layout

```
grok-cloud/
  api/        poll.mjs, outreach.mjs, status.mjs (Vercel functions)
  src/        x, context, search, models, judge, format, guards, outreach, store, log, cost
  scripts/    grok-sample.mjs (pull N recent @grok replies via xAI X Search into a JSONL file),
              replay.mjs (run the pipeline in dry-run on a JSONL of posts)
  test/       fixture-driven tests, no network
  fixtures/   recorded posts, threads, search results and model answers
  models.config.json
  vercel.json
  .env.example
  README.md   setup, keys, dry-run, going live, kill switch, costs
```

## Tests (no network)

- Format checker: length, markdown, tagging, language mismatch, model or Grok
  self-reference.
- Guards: dry-run default, kill switch, hourly limit, cooldown, spend cap,
  dedupe, own-post skip, untagged post skip.
- Judge input and output parsing; fewer than two answers stops the run.
- Outreach: unpublished or pattern-built addresses rejected, source url
  required, proposal shape matches Atlas.
- A replay of fixture mentions through the whole pipeline with stubbed
  providers produces the logged reply and posts nothing in dry-run.
