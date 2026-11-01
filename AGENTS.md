# Working on DeltaRoute

Use Node.js 22+ and run `npm test` for core changes. Windows subprocess and
installer checks are documented in `benchmarks/README.md`. Default tests must
not call providers, consume account resets or depend on personal login state.

Keep local `config.json`, account files, prompts, logs, caches, worktrees and
workflow/routing-memory state out of Git. Review the staged file list before
publishing. Preserve third-party licenses and pinned source provenance.

Keep the seven MCP tool names stable (the six originals plus `generate_media`,
added 2026-11-01). Preserve existing explicit permissions and unrelated host
configuration. No API-key fallback, challenge bypass, automatic publishing or
account-limit evasion. Retain failures and counters; never label process
completion as verified quality without coordinator evidence.

Routing is Claude-first (owner, 2026-11-01): the host keeps work unless a
worker scores clearly higher in the registry, which a weekly benchmark check
updates on its own in small, cited, undoable steps. DeltaRoute runs on the
owner's computer first; the Codespace and cloud server setups stay optional.

One exception, chosen by the owner on 2026-10-28 ("Real cloud server", "Both"):
`grok-cloud/` is a cloud X reply bot that may use paid model APIs and the X API
with keys from its host environment, and may post replies to posts that tag it.
It stays in dry-run until the owner switches it live, keeps its reply limit,
spend cap and kill switch, sends email only after the owner approves each one,
and never presents itself as Grok or xAI. Nothing else in DeltaRoute gains
these permissions, and no key belongs in the repository.

If `MODEL_ROUTER_WORKER=1`, execute only the assigned bounded work. Do not
launch DeltaRoute or other AI CLIs yourself: reach other AIs through the team
board (`.deltaroute/outbox/`), which DeltaRoute serves with bounded, read-only
helpers. Respect the assigned worktree, file scope and current project
instructions. Keep all web browsing on gstack `/browse`.
