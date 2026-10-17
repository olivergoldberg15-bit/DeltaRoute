# Security and local data

Report vulnerabilities privately using GitHub's private vulnerability reporting
for this repository, when enabled. Do not attach credentials or raw job logs to
public issues. If private reporting is unavailable, open an issue requesting a
private contact without disclosing exploit details or account data.

DeltaRoute runs local processes with the current user's permissions. Git path
audits and read-only briefs are not an operating-system sandbox. Review code,
skills and native provider permissions before enabling workers. Keep provider
clients current. The coordinator reviews results before integrating changes.

Jobs, workflows, media caches and head logs can contain prompts, source code,
research and personal information. They stay local and are ignored by Git.
Do not publish an installation directory wholesale or attach unreviewed logs.
The release excludes account files, cookies, API keys and provider binaries.

Subscription credentials remain in each official client's account store.
Worker environments remove API-key and endpoint overrides. This is a guard
against accidental API fallback, not a guarantee about a provider's billing or
terms. Account quotas, client features and provider policies still apply.
