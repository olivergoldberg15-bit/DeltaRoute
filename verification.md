# Verification and measurement limits

DeltaRoute's default tests use local fixtures, not live subscriptions. They
cover routing, MCP stdio, counters, workflow contracts, dependency evidence,
path audits, model review memory, account readiness, head ownership and quota
classification. Windows subprocess tests exercise fake-provider outages, expired
logins, hard quotas, timeout/cancellation and fresh isolated worktrees. Isolated
installer tests protect existing approvals and unrelated MCP registrations.

The release clean checkout passed **195/195 core tests**, with **10/10 Windows fault scenarios**, **5/5 installer-policy fixtures** and **3/3 MCP client fixtures**. The 31 bundled skills passed integrity verification. Clean-checkout setup and local diagnostics passed without model calls.

Run the commands and see sanitized results in [benchmarks/README.md](benchmarks/README.md).
The GitHub Actions workflow is the reproducible release check. An automated pass
does not prove a future provider login, website selector or model is available.

## Historical live observations

Development checks used the official local clients with signed-in accounts.
Codex, Google/Gemini and Cursor returned bounded markers; Grok ran through Cursor;
Perplexity supplied research through gstack. Actual TikTok/Instagram frames were
extracted and inspected. One Codex vision worker described sampled Instagram
frames while explicitly reporting missing audio. No Blender render was verified.
Native Grok website access was blocked, and privileged live X access was not
verified. Perplexity Pro entitlement was not established.

A real managed Codex head loaded a saved workflow, launched one read-only Gemini
worker and accepted a verified marker in 40.252 seconds. Head input was 141,922
logical tokens, including 122,496 cached; output was 644. Worker input was 18,806,
with zero reported cached tokens and 142 output tokens. This forced integration
fixture was excluded from production quality scores. It establishes one working
path, not a coding-quality or efficiency ranking. Both head-switch directions
and the both-limited wait were tested using fake heads, without exhausting real
accounts. A native Codex account readiness read used no model call or reset credit.

## Token and latency interpretation

The historical matched log task used 89,908 versus 9,489 Claude logical input
tokens and returned the expected error counts in both arms. Local processing
reduced a 201,109-byte payload to 368 bytes; bytes are not tokens. A same-session
continuation read 96.9% of input from cache, versus 2.5% for one new-session repeat.
A tiny forced-delegation fixture consumed 151,109 coordinator input tokens versus
8,955 direct, before adding worker usage. Therefore small tasks stay local.

These were individual nonrandomized trials with specific session state. They do
not prove a universal savings rate or extra monthly allowance. Cached input is a
subset of logical input, not an additional amount; provider quota weighting and
internal subagent accounting can differ. Missing browser counters remain unknown.
No reduction in fixed monthly subscription bills is claimed. Reported model
list-price equivalents are not subscription invoices.

Latency includes native startup, authentication, queueing, source acquisition and
model execution. Historical worker examples ranged from about 14 to 142 seconds
on different fixtures; the samples are not comparable speed rankings. Large
video downloads, renders and coding jobs can take much longer. No availability,
latency, photorealism or percentage quality guarantee is made.

Raw job/session logs and account-specific configuration are withheld from this
public distribution. Sanitized aggregate values are retained as historical
observations; a public reader cannot independently reconstruct every old native
session from them. The fixture tests can be reproduced without those private logs.
