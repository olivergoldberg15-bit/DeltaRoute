# Changelog

## 2.0.0: Claude first, chats everywhere, agents that talk and see

From the episode 1 report (rated 7/10) and Oliver's drawing of interconnected agents.

- **Claude first.** Claude keeps work unless a worker scores at least 5 points higher in the registry
  (`delegation.margin`). Live research, images, video and video frames always go out. `submit_task` with provider
  `auto` refuses work Claude keeps; naming a provider still sends it.
- **Live benchmarks.** Once a week a research job (Perplexity, Grok or Muse) reads recent benchmarks and release news,
  and cited changes apply on their own: at most 10 points per score, only from pages the research visited, dated
  within 60 days, logged and undoable (`model_registry` `undo`, `news` to check now). Changes show in `registryNews`.
- **Muse** (Meta AI on meta.ai) joins Perplexity and Grok as an experimental research worker in the gstack browser.
- **`generate_media`** (the seventh tool): images and video by plain model name: Nano Banana Pro and any Higgsfield
  model (credits, priced and capped; video too), ChatGPT through Codex (no credits), Grok Imagine on grok.com
  (experimental). No silent fallback to another platform. Several images generate at once. Results carry small
  previews the chat can see, and download links over the connector.
- **Chats everywhere, on this computer.** `connect.ps1` starts the endpoint, opens a Tailscale Funnel and prints a
  secret connector link (`add-client <name> --link`) for Claude chats (phone included) and ChatGPT, whose connector
  screens take only a URL. The Codespace and cloud server setups stay optional and off.
- **Team board.** Workers on a job share a board (`.deltaroute/outbox/` in, `.deltaroute/board.md` out), post notes
  and questions, and ask any AI for help; DeltaRoute launches each helper at once and posts its answer back. Chief can
  `post` too, and `get_task` on a workflow shows the board.
- **Disposable monitors.** Every few minutes a fresh Grok chat (Gemini Flash if Grok is busy, a no-model rule for
  plain stalls) judges a running worker from a progress snapshot. Off-track verdicts leave `.deltaroute/NUDGE.md`, post
  to the board and flag the job; monitors never stop a worker.
- **Workers see their work.** A worker writes `.deltaroute/render/<name>.json`; DeltaRoute renders the stills outside
  the sandbox (Remotion, a plain HTML page, or `render.command`) into one contact sheet. The final stills get a cheap
  Gemini Flash first look (`preReview`, advice only). `render_stills` gives Chief one sheet instead of many frames.
- **Time limits that hold.** Wall-clock watchdogs replace single long timers, which counted only awake time (Gemini's
  30-minute limit stopped it at 50). At 80% the worker gets `.deltaroute/WRAP_UP` and saves its progress.
- **Commit-free integration.** Every code attempt ends as `change.patch`, made outside the sandbox; `apply_patch`
  applies it without a commit. Scope audits read the patch, and a coordinator finish is audited on that step alone
  (`integrated_from`), not on the whole project.
- **Skill picking.** At most two skills, stronger matches only, never deploy/publish skills, never a skill the
  project's rules ban ("No Higgsfield"), plus `contextRetrieval.blockedSkills`.
- **Honest savings.** Claude's own tokens are read from Claude Code's transcripts: `list_workers` with
  `include_usage` and `npm run savings` (writes `state/savings.html`, per project) give one share of fresh tokens that
  ran off the Claude plan. Since 2026-10-31 that share was 14.9%.
- **Light plans** for creative phases (approved in one call, `revise_plan` keeps unchanged steps), **templates**
  (animated_explainer, feature_tests, research_report), and `node signins.mjs [--smoke]` for sign-in checks.
- **Faster, fewer tokens.** Reasoning effort per category (low for small jobs), four workers at once by default,
  `node_modules` linked into worktrees, a context packet capped at 12,000 characters (was 24,000), a shorter worker
  preamble, prompt hook and tool definitions, and compact JSON tool replies.
- AGENTS.md: seven stable tool names; workers reach other AIs only through the board.

## Unreleased — a sturdier endpoint for connected AIs

- `GET /health` answers without a key (up, version, uptime only), so a caller
  can tell a down server from a forwarding fault in one request.
- Every response DeltaRoute sends carries an `X-DeltaRoute` header; a 404 or
  502 without it came from the port forwarding, not DeltaRoute.
- Finished jobs' output files download over HTTP with the same key:
  `GET /files/<task id>` lists them, `GET /files/<task id>/<file>` sends one.
  Only files directly inside that job's (or its attempts') `out/` folder.
- `node remote-mcp.mjs health | call | download <url> ...`: a client that
  retries forwarding faults and one transient 401, and never resubmits a task.
- Streamable HTTP: `Mcp-Session-Id` on initialize (nothing kept per session, so
  restarts never strand a client), `DELETE /mcp`, event-stream replies with
  keep-alives for clients that accept only a stream, trailing-slash paths.
- The client list is cached and reloaded when it changes; a failed read keeps
  the last good copy, and it is now written atomically. Rejected keys are
  logged with the reason (no key, or key not recognised).
- `cloud/serve-remote.sh` restarts the endpoint if it exits (Codespaces);
  `cloud/install.sh` adds a `deltaroute-mcp` systemd service on servers.
  `cloud/wake.sh` brings a stopped Codespace back from your own computer.
- `list_workers` shows `lastOutcomeAt`, so an old failure reads as old.

## Unreleased — image jobs and kept work

- Local CLI workers retrieve bounded project instructions, relevant installed
  skills, project notes and same-project job/process state automatically.
  Per-attempt context manifests and exact prompt additions make retrieval
  inspectable through `get_task`; browser services receive no automatic local context.

- Image category: `submit_task` with `category: image` and `images.outputs`
  runs on Nano Banana Pro through the user's Higgsfield login (new `higgsfield`
  worker, off until enabled). Each job is priced before generating, capped per
  job and against the balance, and reports credits used. Codex's built-in image
  tool is the backup. Higgsfield is never a fallback for other categories.
- Image jobs write into their own output folder and can copy checked files to
  `deliver_to`; no clean Git checkout or throwaway repo is needed.
- A run cut off by the time limit or a dropped connection is judged by what it
  left: image jobs whose files all exist count as completed with a warning, and
  code jobs that already changed files go back to the coordinator instead of
  starting a fallback that would redo the work.
- Dropped-connection errors ("stream disconnected", "No such host") are now
  classified as outages instead of unknown failures.

## 1.6.0 — Operation Plans, scored review and honest failures

- Operation Plans: the user approves the plan first; steps run in routes with
  token budgets (run count as backup), agents and cheap read-only sub-agents;
  workers get a pointer to the saved contract instead of a pushed prompt.
- Review pipeline: log self-check, 0-100 Review (80 passes, lower goes back to
  its route with notes only), simulated review of the whole product (visual work
  needs real frames), Chief's final review, then the user's approval.
- Capability registry (`models.json`, new `model_registry` tool): each role goes
  to the best available model; Gemini 4 Argon added at agent tier, Gemini 3.8
  Flash as the cheap sub-agent; score changes need citations and the user's
  quoted approval; stale warning after 14 days.
- Live dashboard and `events.jsonl` per workflow; no server, no popups.
- Honest failures: no-change code jobs fail and fall back, dirty checkouts no
  longer burn a step's try, Google's robot check is named as such, and
  `npm run smoke` launches real workers to prove they work.
- Global instructions trimmed to about 140 words; detail moved into the skill.

## 1.5.0 — initial public release

- Local five-tool MCP router for Claude Code and Codex, using separately
  authenticated subscription clients and bounded fallbacks.
- Persistent original-prompt contracts, scoped pinned worktrees, dependency
  checkpoints and retained attempt counters for heavy workflows.
- External managed Claude/Codex head replacement, native quota classification,
  ownership leases and pause-until-recovery behavior.
- Exact-model/category routing memory based on explicit coordinator reviews.
- Local sampled video evidence, native captions and dated social-source packets.
- On-demand specialist skill selection with pinned provenance and license notices.
- Portable setup/config examples, permission-preserving host installers,
  fixture tests, architecture charts and sanitized benchmark methodology.

Provider binaries, credentials, account state, raw session logs and personal
runtime worktrees are intentionally outside the public release.
