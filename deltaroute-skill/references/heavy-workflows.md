# Heavy workflows in DeltaRoute

Use this reference for sustained coding, multi-part animation, large video analysis or work likely to outgrow one session. Keep a single coordinator in the current conversation. Routine checkpoints are the coordinator's review work; they do not require asking the user to approve every step.

1. Preserve the original prompt in `submit_task(action="create_workflow", task=<original prompt>, cwd=<project>, workflow=...)`. Specify a concise objective, constraints, non_goals and meaningful bounded steps. Each step needs a task and acceptance criteria; coding steps also need relative allowed_paths. Dependencies use step IDs. Keep independent steps parallel where useful, within the global two-external-worker cap.
2. Read the saved summary with `get_task(workflow_id=...)`; launch ready steps with `submit_task(action="run_step", workflow_id=..., step_id=..., provider="auto")`. The saved task/scope wins over incidental task overrides. Workers receive a short brief and must read the saved contract constraints and assigned step. Retrieve relevant input/dependency artifacts rather than replaying the entire conversation.
3. Collect the job with `get_task(task_id=..., wait_seconds=...)`. Review actual diffs, original constraints, generated assets and fresh checks. A model saying completed does not release dependencies. Code changes outside allowed paths stop the workflow and cannot trigger a more permissive fallback.
4. Integrate accepted code in the coordinator's project checkout, run appropriate checks and commit the accepted result when project instructions permit. Then call `submit_task(action="checkpoint", workflow_id=..., step_id=..., checkpoint={accepted:true,note:...,checks:[{criterion:<exact acceptance criterion>,passed:true,evidence:<actual output/artifact>}],integrated_head:<actual current HEAD>})`. Every acceptance criterion needs evidence. Changed code requires a clean integrated checkout and a new HEAD; downstream steps validate all transitive accepted code ancestors against one pinned launch commit. Coding-workflow review jobs also use pinned isolated worktrees. Do not override project instructions to obtain a commit; if commits are forbidden, use coordinator implementation/read-only advice instead of forcing this code checkpoint path.
5. Reject a completed result with `checkpoint={accepted:false,note:<specific correction>}` before rework. Retry/job budgets are enforced; failed attempts and evidence remain saved. If the user changes scope, preserve this workflow and create a revised one from the user's updated brief, referencing the previous artifact. Do not silently edit the old contract or repeatedly relaunch exhausted workers.

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
    "steps": [
      {"id":"export","task":"Implement only the requested export behavior","category":"implementation","mode":"code","profile":"heavy_coding","allowed_paths":["src/export","test/export"],"acceptance":["Export regression checks pass","Existing API remains compatible"]},
      {"id":"review","task":"Review integrated export against the original prompt and run relevant checks","category":"review","depends_on":["export"],"acceptance":["Requested behavior and compatibility verified"]}
    ]
  }
}
```

`standard` respects existing configured deadlines. `heavy_coding` and `animation` allow 30-minute attempts with at most three provider attempts; `video_analysis` allows 30 minutes with at most two attempts. These are ceilings, not a reason to keep a failing model running. Plans support up to 64 steps; default rework budget is three launches per step, with a finite overall job budget. Known native counters remain per job/attempt, including failed attempts. This is not a hard live token cap or a quota bypass.

For long coding, split by coherent interfaces/modules, acceptance checks and integration dependencies. Prefer one writer per module. Do not parallelize dependent edits. Use local context indexing for large logs and repeated retrieval; preserve decision evidence and artifacts on disk. After compaction/restart, read the workflow summary and only the needed contract/last accepted artifacts. Semantic drift still requires coordinator review; the Git path audit is not an OS sandbox and does not prove correctness.

For heavy animation, preserve a creative brief and shot/scene plan: duration, aspect ratio, frame rate, palette, typography, audio rights, visual references and intended output. Assign independent shots/assets with stable interfaces and deterministic timing/seeds. Use low-resolution previews or short frame ranges before final renders. Inspect representative beginning/middle/end and transition frames; validate duration, codecs, missing assets and audio separately. Final assembly follows accepted shots/assets. Apply existing HyperFrames/Remotion/product skills as required; Blender rendering requires an installed renderer. Avoid starting two memory-heavy final renders at once; use the second slot for light inspection/research when appropriate.

For long source videos, `media_options` sets `start_seconds`, `end_seconds`, `max_frames`, `frame_width` and `detail` (`efficient` or `balanced`). Each analysis window is at most 600 seconds, with 1–24 frames and width 256–1024; defaults stay 0–60 seconds/eight frames/512px. Make multiple timeline/shot steps for longer coverage. Report actual observed timestamps and gaps; sparse frames do not establish every event between them. Original media may need a full initial download even for a short analysis window. Silent-source downloads are reused locally across windows for 24 hours, and concurrent same-source preparation is serialized. Captioned URL runs retain native caption collection. Cached source acquisition time stays visible; engagement metadata must be freshly collected for trend claims. No automatic audio upload, cloud render service, paid model API or speech-model download is authorized.

If `needs_coordinator` is returned, continue in this conversation from saved artifacts. After completing and verifying the step yourself, checkpoint with `coordinator_completed:true`, acceptance evidence and (for code) the clean integrated HEAD. The original failed worker remains failed in its history; coordinator completion is recorded separately and code scope is audited again in the integrated checkout. For unconfirmed worker termination, wait before editing its workspace. Never spawn a new coordinator recursively. Existing permission and publication restrictions still apply.


## Model-strength memory

`recommend_route` returns configured task specialties plus model/category review evidence. `provider="auto"` uses this ordering after availability and capability filtering; an explicitly requested provider keeps priority. Accepted/rejected worker checkpoints create compact persistent review events under the router's routing-memory/events directory. Three matching reviews are required before bounded adjustments affect ordering. Exact current model versions and categories are isolated; a replacement model starts with configured defaults. A successful process is not quality evidence. Coordinator-completed handoffs are not credited as accepted worker work. Review notes, scope violations, timestamps and native counters are retained, without raw prompts. Explain the amount of evidence and limitations instead of calling the model objectively best.

## Managed coordinator handoff

For automatic head replacement, run the external launcher against the saved workflow:

```powershell
& "__DELTAROUTE_ROOT__/DeltaRoute.ps1" -WorkflowId "<saved workflow UUID>" -Background
```

The launcher permits one managed head for that workflow/project. It preserves sessions, original contract, checkpoints, failed attempts and native logs. On a native hard quota error it confirms the old head has stopped, then changes Claude to Codex or Codex to Claude. Neither workers nor managed heads may launch another supervisor or coordinator. This is a flat external replacement, not recursive delegation. Ordinary native desktop chats retain their host; the launcher is the execution path for automatic switching.

If both heads are blocked, the supervisor pauses new work without model calls. Already-started workers may finish and keep their artifacts. Reported absolute reset times schedule a recheck or one permitted reset probe; elapsed time and percentages never establish recovery. The official Codex account/rateLimits/read status can confirm ordinaryUsageAllowed=true without a model call. Unknown reset times remain unknown; while waiting, the supervisor checks that read-only status at most once every five minutes. No reset credits, API billing fallback, paid overage purchase or challenge bypass is used.

If approval, login, semantic review or process termination is unresolved, preserve state and report needs_attention. Existing deny rules remain in force. The managed-head installer can approve only the five existing local DeltaRoute MCP tools where no explicit restriction exists; it does not approve shell, browser, publishing or unrelated MCP tools.
