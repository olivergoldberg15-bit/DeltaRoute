# Changelog

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
