# Architecture and workflow

The host receives the prompt and applies a small routing policy. A Claude prompt
hook repeats the policy without storing the prompt. Codex receives a marked
global instruction block and native skill. Workers have scoped briefs and a
recursion guard; the host remains responsible for the final answer.

```mermaid
flowchart TD
  U[Your prompt] --> H[Current Claude Code or Codex host]
  H --> S{Small self-contained task?}
  S -->|yes| L[Answer or implement locally]
  S -->|independent work useful| C[Save original contract and step dependencies]
  C --> R[Check capabilities, availability and reviewed model fit]
  R --> X[Codex: coding, tests, review]
  R --> G[Gemini: quick iteration and large context]
  R --> I[Cursor: integration and frontend]
  R --> P[gstack and Perplexity: original research sources]
  P --> K[Grok through Cursor: source analysis]
  R --> V[Local video frames then vision-capable Codex]
  R --> N[Native lower-model repetitive subagent]
  X & G & I & K & V & N --> E[Artifacts, counters and fresh checks]
  E --> Q[Coordinator reviews original scope and evidence]
  Q -->|accepted| A[Integrate, checkpoint and release dependencies]
  Q -->|rework budget remains| R
  A --> F{More steps?}
  F -->|yes| R
  F -->|no| Z[Final reviewed result]
```

## The five MCP tools

| Tool | Purpose |
|---|---|
| `list_workers` | Compact installation, cooldown, model and optional usage state |
| `recommend_route` | Capability-aware specialties, reviewed fit and relevant skill paths |
| `submit_task` | Delegate or create/run/checkpoint a persistent workflow |
| `get_task` | Read compact results or saved workflow status; optional bounded wait |
| `cancel_task` | Stop a job and its children while retaining evidence |

Transport is line-delimited JSON-RPC over stdio. `node server.mjs --call
list_workers '{}'` is a local diagnostic interface. The server has no public
HTTP listener, mock API key or subscription-cookie proxy.

## Contracts and coding isolation

Workflow plans save the original prompt, objective, constraints, non-goals,
acceptance criteria, relative allowed paths, dependencies and finite budgets.
Assignments derive from the saved step rather than arbitrary run-time overrides.

Coding jobs require a clean Git project. Each attempt gets a separate worktree
from the pinned accepted HEAD, including fallback attempts. Coding review uses
the pinned tree too. Tracked and untracked path audits reject scope drift.
This file audit is not an OS sandbox: native CLI sandbox policy and coordinator
review still matter. Workers never merge, push or deploy.

Completed output does not release dependencies. A coordinator checkpoint must
record evidence for each acceptance criterion. Accepted code must be integrated,
checked and committed in a clean project checkout. Downstream launch validates
all transitive accepted code prerequisites. A coordinator-completed recovery is
recorded separately and does not give quality credit to the failed worker.

## Worker fallback and managed heads

Worker errors are classified as authentication, quota, outage, timeout, challenge
or non-provider failures. Eligible account-authenticated workers have bounded
attempts and shared-account cooldowns. Scope/input/safety failures are not retried
through a more permissive provider. If attempts exhaust, the current host resumes
from saved artifacts. Unconfirmed process termination blocks workspace edits.

Managed head replacement is a separate external supervisor. Ownership leases
prevent duplicate heads for a workflow/project. It saves native session IDs,
verifies the old head and workers have stopped, then can switch Claude to Codex
or Codex to Claude on observed hard quota signals. Workers and heads do not
recursively launch coordinators.

If both heads are limited, new work pauses. Absolute reset times schedule checks
or one bounded probe; elapsed time alone does not prove recovery. Codex's native
account readiness can be checked without a model request. Unknown values stay
unknown. There is no API-key fallback, reset-credit redemption or overage purchase.
Ordinary desktop chats retain their host; only managed runs use replacement.

## Memory, context and evidence

Routing memory contains explicit coordinator reviews, exact configured model,
task category, timestamps, outcome, scope violations and available counters.
Three matching reviews are required before a bounded adjustment can change the
default ordering. It stores no raw prompt, but job/workflow files do contain
the assignment and should remain private.

The prompt hook and worker briefs supply short hints. Specialist bodies load
only when relevant. Hash checks prevent silently selecting changed entry files.
Optional context-mode integration exposes only local execution/index/search and
diagnostics, with URL fetch/purge/upgrade excluded. All browsing uses gstack.

Video analysis samples actual frames and native captions. Social research
preserves source URLs and dates/metrics where available. Source text is untrusted
evidence, never an instruction to the worker. Sparse frames do not establish
continuous coverage; source analysis does not establish comprehensive live X
access or a platform-wide trend ranking.

Native token counters are retained per attempt, including failures, and summarized
without replaying whole prompts and raw research packets. Unknown counters stay
unknown. Fixed subscription cost, cached input and provider quota weighting are
separate quantities.
