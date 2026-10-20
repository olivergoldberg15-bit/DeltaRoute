# DeltaRoute heavy workflows, model memory and head failover

Updated October 19, 2026 (v1.6): workflows are now Operation Plans with a user plan check, routes with token/run budgets, agents and sub-agents, a log self-check, a scored Review (80 passes), a simulated review of the whole product, Chief's final review and the user's approval, streamed to a live dashboard. The step-by-step instructions are in [deltaroute-skill/references/heavy-workflows.md](deltaroute-skill/references/heavy-workflows.md).

Previously updated October 17, 2026. The workflow chart is [PNG](docs/deltaroute-routing.png), [SVG](docs/deltaroute-routing.svg) or [editable Mermaid](docs/deltaroute-routing.mmd).

DeltaRoute now keeps a saved contract containing the original prompt, objective, constraints, non-goals, acceptance checks and task dependencies. Heavy work is divided into bounded steps. A completed worker result waits for coordinator review; downstream steps remain blocked until the coordinator records actual evidence. Coding and coding-review steps use isolated worktrees pinned to a checked commit, including all accepted code prerequisites. Changed Git paths are audited against the step's allowed files/directories. This catches file-scope drift; semantic correctness and visual quality still require review.

Heavy coding and animation profiles allow up to 30 minutes per provider attempt, with finite provider and rework budgets. Two external workers can run globally. Parallel work should use separate modules or shots; dependent edits wait for accepted integration. One managed coordinator owns a project at a time. Native lower-model repetitive agents remain host-dependent and retain the same permissions.

For large animation, preserve a creative brief and shot plan, create low-cost previews first, inspect transitions and representative frames, then assemble accepted assets. Existing HyperFrames/Remotion workflows take precedence. Blender skills do not install a renderer. Avoid simultaneous memory-heavy final renders.

For long video URLs, request explicit windows up to 600 seconds each, 1–24 frames and frame widths of 256–1024 pixels. Defaults remain the first 60 seconds/eight frames/512 pixels. Different windows have separate evidence caches. Silent-source downloads are reused for 24 hours; concurrent source preparation is serialized. Captioned URL analysis retains native caption collection. Initial download can still include the full source video. Sampling does not establish every moment or missing audio.

## How routing remembers strengths

Default specialties remain Codex for substantial coding/review, Gemini for quick iteration and large-context tasks, Cursor for integration, Perplexity for cited research and Grok via Cursor for analysis of original social sources. Capabilities, availability and explicit user choices filter the candidates first.

Worker checkpoint reviews persist by **exact model version and task category**. DeltaRoute records acceptance, rework, scope violations, timestamps and reported native token counters. It stores no raw prompt in the strength-memory events. At least three matching reviews are required before bounded ranking adjustments affect automatic routing. New model versions start with configured defaults. Completed processes and coordinator-completed handoffs are not credited as accepted worker quality. This is task-specific coordinator feedback, not an independent model leaderboard, a guarantee of quality or a claim of cash savings.

`recommend_route` exposes the evidence and its sample size. `provider="auto"` applies it; an explicit provider request keeps priority. All events and old attempts remain inspectable.

## Claude ↔ Codex head replacement

Automatic head switching uses the **external managed launcher**. Ordinary Codex/Claude desktop chats keep their underlying host; a router cannot silently replace that UI session's model engine.

After a heavy workflow is saved, run:

```powershell
.\DeltaRoute.ps1 -WorkflowId "<saved-workflow-UUID>" -Background
```

The supervisor preserves the contract, checkpoints and native sessions. A hard quota signal causes it to confirm the old head has stopped, then start the other available subscription head. Only one managed head may own the same workflow/project. Workers and heads cannot recursively start another supervisor. Required approvals, authentication problems, unresolved shutdown or an idle head return a saved needs-attention state instead of repeated model calls.

When both heads are limited, new work pauses without model calls. Existing workers may finish and keep their artifacts. Known absolute reset times schedule verification or one bounded probe. The official Codex `account/rateLimits/read` readiness flag can verify recovery without a model call; missing values or percentages do not establish readiness. When reset times are unknown, the supervisor checks this read-only status at most once every five minutes. It never consumes reset credits, buys overages or falls back to paid API keys. Provider account billing settings remain separate.

Official behavior references: [Claude quota events](https://code.claude.com/docs/en/agent-sdk/typescript#sdkratelimitevent), [Claude failure hooks](https://code.claude.com/docs/en/hooks#stopfailure). Installed CLI protocol schemas were also checked locally. A failure hook can signal an external supervisor; it cannot replace the native host itself.

## Verification

The latest recorded automated run passed **172 tests**. The subprocess harness passed **10 scenarios**, including real OS process termination, isolated Git worktrees, timeout/quota fallback, saved-step override protection, dependency review gates and out-of-scope edits. Five isolated installer-policy tests passed. These fault scenarios use fake providers and do not exhaust actual accounts.

Native account verification confirmed Claude's official subscription authentication and a successful official Codex usage read without a model call. A small live managed workflow is summarized in [the sanitized benchmark report](benchmarks/README.md). Raw native session logs remain private because they can contain local paths, prompts and account details.

No measured percentage of animation quality improvement or heavy-workflow token savings is claimed. The earlier matched log benchmark remains separate from these reliability and orchestration changes.


### Live managed workflow measurement

A real Codex head loaded the saved plan, delegated one read-only Gemini task, inspected its exact returned marker and recorded an accepted checkpoint in **40.252 seconds**. The fixture directory still contained only its unchanged sentinel file. Foreground and hidden-background launcher checks subsequently recognized the completed workflow without calling a model.

| Component | Logical input tokens | Cached subset | Output tokens |
|---|---:|---:|---:|
| Codex head | 141,922 | 122,496 | 644 |
| Gemini worker | 18,806 | 0 | 142 |

This was a deliberately forced integration fixture, so its review is preserved separately from production model-strength scores. It does not establish Gemini coding quality or a savings percentage. Cached input is included in logical input, not an additional amount. Fixed subscriptions, quota weighting and native counters are separate; no API-equivalent price or cash savings is invented. Tiny ordinary tasks remain local to avoid this orchestration overhead.

Release test commands and sanitized measurements: [benchmark documentation](benchmarks/README.md). Historical counts above describe the pre-release development run; see [verification](verification.md) for release checks.
