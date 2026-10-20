# Changelog

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
