# Heavy workflows in DeltaRoute

Use this reference for sustained coding, multi-part animation, large video analysis or work likely to outgrow one session. The current conversation is Chief: it plans, reviews and integrates. The tree is Chief > Operation Plan (OP) > routes (each with a lead and a token/run budget) > agents (one per step) > sub-agents (cheap, read-only pieces), then log self-check > Review > simulated review > Chief's final review > the user's approval. The user is asked twice: at the plan check and at the final approval. Step checkpoints in between are Chief's own review work.

0. Pick models with `model_registry(action="roles", category=...)`. Each role goes to the best available model whose tier allows it; Chief is always the host. Name a step's agent with `provider` plus a registry `model` (for example `gemini-4-argon-high`), or leave it to `provider="auto"`.
1. Create the Operation Plan with `submit_task(action="create_workflow", task=<original prompt>, cwd=<project>, workflow=...)`: objective, constraints, non_goals, `visual: true` when the result must be seen to be judged, `routes[{id, lead, budget:{tokens, runs}}]` and `steps[{id, route, task, category, mode, provider, model, subagents[{id, task}], depends_on, allowed_paths, acceptance}]`. Coding steps need relative allowed_paths. A route's default budget is one run per slot (each step or sub-agent times max_runs_per_step) and 150K fresh input + output tokens per run; cached reads are not budgeted. Keep independent steps parallel within the global two-external-worker cap.
2. Plan check: show the user the routes, agents, sub-agents and budgets in plain words and wait for their answer. Only then call `submit_task(action="approve_plan", workflow_id=..., approved_by_user=<their words>)`. Nothing runs before this. Give the user the `dashboard` path from the result: a local HTML file that redraws the tree and refreshes itself.
3. Run a step's sub-agents first with `submit_task(action="run_subagent", workflow_id=..., step_id=..., subagent_id=...)` (cheapest available registry model unless the plan names one), then its agent with `run_step`. Workers get a pointer to the saved contract (the context rail) and read only what they need. Collect results with `get_task(task_id=..., wait_seconds=...)`. A model saying completed does not release dependencies; code outside allowed paths stops the workflow and cannot trigger a more permissive fallback.
4. Review each completed result against the approved plan. Read the job's `selfCheck`: blocking findings (empty answer, admitted failure) must be resolved and explained in `self_check_addressed` before acceptance. Integrate accepted code in the project checkout, run checks, commit when project instructions permit, then call `submit_task(action="checkpoint", workflow_id=..., step_id=..., checkpoint={score:<0-100>, accepted:true, note:..., checks:[{criterion:<exact acceptance criterion>, passed:true, evidence:<actual output/artifact>}], integrated_head:<actual current HEAD>})`. 80 or above passes. Below 80, send `checkpoint={score, note:<specific correction>}`: the step goes back to its route carrying only those notes. Changed code requires a clean integrated checkout and a new HEAD; downstream steps validate all transitive accepted code ancestors against one pinned launch commit. If commits are forbidden, use coordinator implementation or read-only advice instead of forcing this path. When a route's token or run budget runs out it stops and reports what went wrong; revise the plan with the user rather than relaunching.
5. When every step is accepted, judge the whole product: `submit_task(action="simulated_review", workflow_id=..., review={score, note, evidence:[what you actually ran, rendered or opened], visual_evidence:[frame or screenshot paths], send_back:[step ids when below 80]})`. Visual work cannot pass without real frames or screenshots on disk, because workers never see their own renders. A failing review reopens the named steps and everything built on them.
6. Chief's final review: `submit_task(action="final_review", workflow_id=..., chief_note=...)`. Then show the user the result and record their approval with `final_review` and `approved_by_user=<their words>`. The phase becomes `done` only after that.

If the user changes scope, preserve this workflow and create a revised one from the updated brief, referencing the previous artifact. Do not silently edit the old contract or repeatedly relaunch exhausted workers. Plans saved before version 1.6 have no plan check or scores and still run.

Example creation arguments:

```json
{
  "action": "create_workflow",
  "task": "Implement the requested export feature while preserving the existing UI and public API.",
  "cwd": "C:/absolute/project",
  "workflow": {
    "objective": "Working export with existing behavior preserved",
    "constraints": ["Preserve public API and UI", "Use existing dependencies"],
    "non_goals": ["No redesign", "No unrelated refactoring"],
    "max_jobs": 12,
    "max_runs_per_step": 3,
    "routes": [{"id":"build","lead":"claude-opus-5-5","budget":{"tokens":600000,"runs":6}}],
    "steps": [
      {"id":"export","route":"build","provider":"codex","subagents":[{"id":"callers","task":"List every caller of the current export function"}],"task":"Implement only the requested export behavior","category":"implementation","mode":"code","profile":"heavy_coding","allowed_paths":["src/export","test/export"],"acceptance":["Export regression checks pass","Existing API remains compatible"]},
      {"id":"review","route":"build","task":"Review integrated export against the original prompt and run relevant checks","category":"review","depends_on":["export"],"acceptance":["Requested behavior and compatibility verified"]}
    ]
  }
}
```

`standard` respects existing configured deadlines. `heavy_coding` and `animation` allow 30-minute attempts with at most three provider attempts; `video_analysis` allows 30 minutes with at most two attempts. These are ceilings, not a reason to keep a failing model running. Plans support up to 64 steps; default rework budget is three launches per step, with a finite overall job budget. Known native counters remain per job/attempt, including failed attempts. This is not a hard live token cap or a quota bypass.

For long coding, split by coherent interfaces/modules, acceptance checks and integration dependencies. Prefer one writer per module. Do not parallelize dependent edits. Use local context indexing for large logs and repeated retrieval; preserve decision evidence and artifacts on disk. After compaction/restart, read the workflow summary and only the needed contract/last accepted artifacts. Semantic drift still requires coordinator review; the Git path audit is not an OS sandbox and does not prove correctness.

For heavy animation, preserve a creative brief and shot/scene plan: duration, aspect ratio, frame rate, palette, typography, audio rights, visual references and intended output. Assign independent shots/assets with stable interfaces and deterministic timing/seeds. Use low-resolution previews or short frame ranges before final renders. Inspect representative beginning/middle/end and transition frames; validate duration, codecs, missing assets and audio separately. Final assembly follows accepted shots/assets. Apply existing HyperFrames/Remotion/product skills as required; Blender rendering requires an installed renderer. Avoid starting two memory-heavy final renders at once; use the second slot for light inspection/research when appropriate.

For long source videos, `media_options` sets `start_seconds`, `end_seconds`, `max_frames`, `frame_width` and `detail` (`efficient` or `balanced`). Each analysis window is at most 600 seconds, with 1–24 frames and width 256–1024; defaults stay 0–60 seconds/eight frames/512px. Make multiple timeline/shot steps for longer coverage. Report actual observed timestamps and gaps; sparse frames do not establish every event between them. Original media may need a full initial download even for a short analysis window. Silent-source downloads are reused locally across windows for 24 hours, and concurrent same-source preparation is serialized. Captioned URL runs retain native caption collection. Cached source acquisition time stays visible; engagement metadata must be freshly collected for trend claims. No automatic audio upload, cloud render service, paid model API or speech-model download is authorized.

If `needs_coordinator` is returned, continue in this conversation from saved artifacts. After completing and verifying the step yourself, checkpoint with `coordinator_completed:true`, acceptance evidence and (for code) the clean integrated HEAD. The original failed worker remains failed in its history; coordinator completion is recorded separately and code scope is audited again in the integrated checkout. For unconfirmed worker termination, wait before editing its workspace. Never spawn a new coordinator recursively. Existing permission and publication restrictions still apply.


## Capability registry

`models.json` scores every model 0-100 on planning, coding, review, research, visual, large context, speed and cost, with a tier (top, mid, cheap) and the source of each judgment. Approved local changes live in routing-memory/model-registry.json so a reinstall keeps them. `model_registry(action="refresh")` compares live CLI model lists (`agy models`) with the registry and writes a proposal; `propose` adds cited score or tier changes (source_url and source_date required); `apply` needs `approved_by_user` quoting the user. News never changes a score on its own. `list_workers` warns once the registry is more than 14 days old. New models from a refresh stay unassigned until they get scores and a tier.

## Model-strength memory

`recommend_route` returns configured task specialties plus model/category review evidence. `provider="auto"` uses this ordering after availability and capability filtering; an explicitly requested provider keeps priority. Accepted/rejected worker checkpoints create compact persistent review events under the router's routing-memory/events directory. Three matching reviews are required before bounded adjustments affect ordering. Exact current model versions and categories are isolated; a replacement model starts with configured defaults. A successful process is not quality evidence. Coordinator-completed handoffs are not credited as accepted worker work. Review notes, scope violations, timestamps and native counters are retained, without raw prompts. Explain the amount of evidence and limitations instead of calling the model objectively best.

## Managed coordinator handoff

For automatic head replacement, run the external launcher against the saved workflow:

```powershell
& "__DELTAROUTE_ROOT__/DeltaRoute.ps1" -WorkflowId "<saved workflow UUID>" -Background
```

The launcher permits one managed head for that workflow/project. It preserves sessions, original contract, checkpoints, failed attempts and native logs. On a native hard quota error it confirms the old head has stopped, then changes Claude to Codex or Codex to Claude. Neither workers nor managed heads may launch another supervisor or coordinator. This is a flat external replacement, not recursive delegation. Ordinary native desktop chats retain their host; the launcher is the execution path for automatic switching.

If both heads are blocked, the supervisor pauses new work without model calls. Already-started workers may finish and keep their artifacts. Reported absolute reset times schedule a recheck or one permitted reset probe; elapsed time and percentages never establish recovery. The official Codex account/rateLimits/read status can confirm ordinaryUsageAllowed=true without a model call. Unknown reset times remain unknown; while waiting, the supervisor checks that read-only status at most once every five minutes. No reset credits, API billing fallback, paid overage purchase or challenge bypass is used.

If approval, login, semantic review or process termination is unresolved, preserve state and report needs_attention. Existing deny rules remain in force. The managed-head installer can approve only the six local DeltaRoute MCP tools where no explicit restriction exists; it does not approve shell, browser, publishing or unrelated MCP tools.
