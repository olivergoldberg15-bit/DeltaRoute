# Working on DeltaRoute

Use Node.js 22+ and run `npm test` for core changes. Windows subprocess and
installer checks are documented in `benchmarks/README.md`. Default tests must
not call providers, consume account resets or depend on personal login state.

Keep local `config.json`, account files, prompts, logs, caches, worktrees and
workflow/routing-memory state out of Git. Review the staged file list before
publishing. Preserve third-party licenses and pinned source provenance.

Keep the six MCP tool names stable. Preserve existing explicit permissions and
unrelated host configuration. No API-key fallback, challenge bypass, automatic
publishing or account-limit evasion. Retain failures and counters; never label
process completion as verified quality without coordinator evidence.

If `MODEL_ROUTER_WORKER=1`, execute only the assigned bounded work. Do not call
DeltaRoute or other AI CLIs recursively. Respect the assigned worktree, file
scope and current project instructions. Keep all web browsing on gstack `/browse`.
