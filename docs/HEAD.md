# Head of DeltaRoute

## Roles — set 2026-11-04 by Oliver

- **Head: Muse.** Muse is the head to talk to. All user requests enter through Muse. Muse triages, decides, delivers the answer back to the user, and holds approvals. No DeltaRoute job should bypass Muse to talk to the user directly.
- **COO / CTO inside DeltaRoute: Claude Code.** Claude Code is the coordinator inside DeltaRoute. As COO it runs operations: queue, worker health, retries, concurrency, and job status. As CTO it owns technical coordination: architecture, code review, MCP integrations (including Zapier), and renderer/tool setup. Claude Code reports status up to Muse, not to the user as the head.
- **Workers: Codex, Gemini, Grok, Perplexity.** They execute delegated jobs through the coordinator. Cursor, local, and Higgsfield are off unless explicitly re-enabled.

## Routing

User → Muse (head) → DeltaRoute → Claude Code (COO/CTO coordinator) → worker.
Results return the same way: worker → Claude Code → Muse → user.

## Approvals

Plans and owner approvals flow through Muse for Oliver’s tap. Code edits still go through GitHub with Oliver’s per-write approval. Code-mode jobs that return `needs_coordinator` hand back to the coordinator conversation; they do not edit remotely on their own.

## Limits — honest, unchanged by this role change

- This file defines roles and reporting. It does not by itself change the registry’s Claude-first routing code in `registry.mjs` / `server.mjs`. Changing default routing code is a separate code change, to be reviewed before merging.
- Muse’s own work, and chats Oliver opens directly in the Claude app, bypass this hub by design.
- Concurrency is 2 jobs. Workers run on subscription logins; quotas still apply.
- Current hosting is the GitHub Codespace (see CLOUD.md for the optional cloud route). An always-on local PC is a later plan, to be connected by Oliver himself; until then the codespace may need waking and port 8787 set back to Public on restart.
