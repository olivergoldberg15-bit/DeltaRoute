# Contributing

Use a clean checkout and Node.js 22 or newer. Run `npm test` before submitting
changes. Windows process and installer checks are described in
[benchmarks/README.md](benchmarks/README.md).

Add focused regression coverage for routing, permissions, process ownership,
quota handling or workflow changes. Tests must use local fixtures by default;
do not make paid calls, consume account resets or depend on a signed-in account.
Document optional live checks separately with exact measured counters and limits.

Keep provider adapters configurable. Never add a paid API fallback, challenge
bypass, automatic external publishing or credential export. Preserve failed
attempts and distinguish process success from reviewed output quality.

Add upstream skills only with provenance, pinned source and license review.
Do not execute skill scripts merely because their names match a prompt.
Never commit `config.json`, runtime state, cookies or raw session logs.
