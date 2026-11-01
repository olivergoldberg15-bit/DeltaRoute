---
name: deltaroute
description: Use DeltaRoute to hand work to other AIs on the user's own subscriptions: live research (Perplexity, Grok, Muse), images and video (Nano Banana Pro, ChatGPT, Grok Imagine, Seedance, Veo), and code a worker is clearly better at. Also heavy coding/animation workflows, video URLs, social-trend research and savings reports. Keep everything else in Claude.
---

# DeltaRoute (Δ)

Claude does most of the work. DeltaRoute exists for what another model does clearly better, and for things Claude cannot do here: browse the live web, generate images and video, see sampled video frames.

## Who does what

- `recommend_route` (category, optional task) answers "who". It compares Claude with the best available worker in the capability registry and keeps the work in Claude unless a worker leads by `delegation.margin` (5) or more. Live research, media and video frames always go out. `submit_task` with provider `auto` refuses work Claude keeps; naming a provider sends it anyway.
- The registry follows live evidence: once a week DeltaRoute asks Perplexity/Grok/Muse what recent benchmarks and release news say, then applies cited changes itself (at most 10 points per score per check, sources must be pages the research visited, dates within 60 days). The next `list_workers` or `recommend_route` shows them under `registryNews`: tell the user what changed. `model_registry` `undo` with a `change_id` reverses one; `news` runs the check now.
- Muse (meta.ai), Grok and Perplexity run through the gstack research browser. They are experimental (consumer sites, robot checks); say so when a result depends on them.

## Images and video

`generate_media` with a `prompt` and a `model` the user names: `nano banana pro` (default image), `chatgpt` (Codex's image tool, ChatGPT plan, no credits), `grok imagine` (grok.com, experimental), `seedance` (default video), `veo`, `kling`, `wan`, or any Higgsfield job type. Optional count (1-4), aspect_ratio, resolution, duration, references, deliver_to, max_credits. Higgsfield jobs are priced first and refused past the cap or balance; the result reports credits. Nothing falls back to another platform: the user chose one. Results carry file paths, a small preview the chat can see and, over the connector, links the phone can open. Slow jobs return a task id: `get_task` with `wait_seconds: 45`. Describe a shot as an interior or subject view: "seen through a window" makes models draw a frame. Respect project rules that ban AI images or a platform.

## Work that goes to workers

Workers do not inherit the chat. Give an absolute `cwd`, a bounded task, context and acceptance checks. Default is read-only. Code mode needs a clean Git checkout and runs in an isolated worktree with the project's `node_modules` linked in.

- **Time.** Limits are wall-clock: a sleeping laptop no longer stretches them. At 80% the worker gets `.deltaroute/WRAP_UP` and its brief tells it to stop starting things, leave the code building and write `.deltaroute/PROGRESS.md`. `effort` (low/medium/high) defaults by category; low is much faster for small jobs.
- **Seeing their work.** Visual jobs (animation profile, frontend, creative, visual plans) can ask DeltaRoute to render stills: the worker writes `.deltaroute/render/<name>.json` (`frames` for Remotion with a `composition`, or `times` for an HTML page), and DeltaRoute renders outside the sandbox into one contact sheet the worker opens. Its `final.json` request is rendered when it stops, and a cheap Gemini Flash pass screens that sheet against the brief (`preReview`: score and misses). That is advice, not a review. `render_stills` does the same for Chief: open the one `sheet.jpg` instead of many frames.
- **Team board.** Workers on one workflow (or one job and its helpers) share a board. They post notes and questions through `.deltaroute/outbox/`, read `.deltaroute/board.md`, and ask any AI for help (`kind: help`, `ask: research|social_research|review|large_context|summarization|debugging|quick_coding`). DeltaRoute launches the helper at once (read-only, up to `board.maxHelpersPerJob`) and posts the answer back. `get_task` on a workflow shows the last board messages; `post` lets Chief write to it.
- **Monitors.** Every few minutes a disposable monitor judges the running worker from a progress snapshot: a fresh Grok chat, Gemini Flash when Grok is busy, or a no-model stall rule. Off-track verdicts leave `.deltaroute/NUDGE.md` for the worker and post to the board; a repeated off_task or a loop sets `attention` on the job. Monitors never stop a worker.
- **Don't hover.** With monitors, the board and Flash screening running, do not poll workers or re-check work in flight. Wait for the result and review it once.
- **Patches.** A code attempt ends as `change.patch` in its job folder, made outside the sandbox. `apply_patch` (task_id, or workflow_id + step_id) applies it to the project without committing; the paths are checked against the step's allowed paths. When a worker stops early with changes, the handoff names the patch.

## Plans

- Creative phases where direction still moves: a light plan. `create_workflow` with `workflow.mode: "light"` and `approved_by_user` quoting the user's go-ahead approves it in the same call; `revise_plan` with a one-line approval changes it later, keeping every unchanged step's jobs and reviews.
- Big builds: a full Operation Plan. Read [heavy workflows](references/heavy-workflows.md). `create_workflow`, show the plan, `approve_plan` with the user's words, `run_subagent` then `run_step`, a scored `checkpoint` (80 passes; lower goes back with the notes), `simulated_review` (visual work needs real frames), `final_review` and the user's approval.
- Finishing a step yourself after a handoff: integrate it in its own commits and pass `integrated_from` (the commit before them) to `checkpoint`, so the scope audit reads only that step's change.

## Savings

`list_workers` with `include_usage` gives worker counters and one honest line: the share of fresh tokens that ran off the Claude plan, with Claude's own tokens read from Claude Code's transcripts. `node usage-report.mjs --savings [since]` writes `state/savings.html`, per project. Token counts are not plan limits, and Claude-first routing deliberately keeps more work on Claude.

## Research and video

- Video URLs: category `video_analysis` with the URL and question. The local watch engine samples real frames and native captions for the Codex vision worker. State the sampled range; never infer visuals from captions or audio from silent frames.
- Social trends: category `social_research` with `research_scope: {topic, region, window_days}`. Gather original post URLs and native metadata; a few matching creators are candidate evidence, not proof of a global trend. Watch clips before describing them.
- Research packets validate the named primary publishers, with one repair and one gstack primary-page search, never endless retries. A Google robot check (usually a VPN IP) is reported, never bypassed.
- For animation, 3D, context and design guidance, read [the skill catalog](references/catalog.md), then only the relevant SKILL.md.

## Connecting chats

- Claude Code runs DeltaRoute locally through the `subscription-router` MCP server.
- Claude chat on phone or desktop, and ChatGPT: run `connect.ps1` on this computer. It starts the endpoint, opens a Tailscale Funnel and prints a secret connector link once; add it under Settings > Connectors. That link can generate media and delegate, but plan and review approvals stay in Claude Code. It works while this computer is on.
- The Codespace and cloud server setups (docs/CLOUD.md) still exist but are off unless the user starts them.

## Rules

- No paid API fallback, new credits beyond the per-job cap, credential access, limit bypass, publishing, deploying or messaging others.
- Workers reach other AIs only through the board; they never launch AI programs themselves.
- Provider recovery is automatic (`fallback=true` for delegation); never resubmit a failed job yourself. `generate_media` never falls back.
- Research sign-in: `research-login.ps1 -Provider grok|perplexity|muse` opens a visible window where the user logs in; then `research-login.ps1 -Finish`. Never type the user's passwords.
- After an install, update or login change, run `npm run smoke` (add `--research` for the browser workers).
- Report observed facts, inferences and unknowns apart. Fixed subscriptions, API-equivalent estimates and quota use are different quantities.
