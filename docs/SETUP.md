# Setup, providers and operations

## Requirements and scope

Use Windows with Node.js 22+, Git, Python 3.11+ and PowerShell. The core has no
npm runtime dependencies. Python is used for Codex configuration and optional
local video tooling. You need each desired provider's official client and an
eligible signed-in account. DeltaRoute does not combine allowances or make a
web subscription an API entitlement.

Run `setup.ps1` from a permanent checkout path. It discovers compatible native
executables or installed JavaScript entry points and writes private `config.json`.
Missing clients remain disabled. Review the result and use the provider's own
model list before setting model IDs; a model available on one account may be
unavailable on another. Existing private configuration is preserved by default.

Only run the host installer you want, or both. Managed Claude/Codex head replacement requires both clients, their account logins and both host integrations. `install.ps1` writes Claude's
user MCP registration, one marked global policy block, a prompt hook and a
read-only repetitive agent. `install-codex.ps1` registers Codex MCP, a marked
AGENTS block and the native DeltaRoute skill. Optional context-mode is reused
only if already installed; DeltaRoute does not silently install a new service.

The Claude registration retains the compatibility name `subscription-router`;
the Codex registration is `deltaroute`. They expose the same five tools.
Installers preserve unrelated global configuration and create backups. An
existing registration pointing elsewhere is refused, rather than overwritten.
For an older installation, review and deliberately remove/migrate that specific
registration before installing this checkout. Keep the old runtime artifacts.

## Provider clients

| Provider | Configuration and authentication |
|---|---|
| Codex | Absolute native executable; `codex login`, then `codex login status` must report a ChatGPT account |
| Claude head | Absolute native executable; `claude auth login`, then `claude auth status` must report subscription OAuth |
| Google / Gemini | Supported native Google CLI transport, or installed Gemini JS entry; use personal Google account OAuth, never API-key/Vertex fallback |
| Cursor | Native agent executable or Node plus installed agent JS entry; `login-cursor.ps1` opens its normal login flow |
| Grok | Cursor transport with an account-supported Grok model ID; disabled unless configured deliberately |
| Perplexity | Dedicated gstack browser session and normal web sign-in; exact plan/model is not inferred |

Native CLI arguments were developed against Codex 0.163.0, Claude Code 2.1.300
and the local Google/Cursor clients available during development. Clients and
account policies change. Run the doctor and a small read-only check after an
upgrade. Bundled fake-provider tests verify orchestration, not every future
provider build. Do not use unsupported unofficial packages to supply credentials.

The Google adapter supports the `antigravity` native transport and a legacy
Gemini CLI transport with a personal-OAuth guard. Choose the currently supported
official client for your account. Do not assume all Google web plans expose the
same CLI models. Cursor's model list similarly determines whether Grok is usable.

## Research browser

Install gstack separately from its upstream project, read its `/browse` skill,
and configure the compiled browse executable, dedicated state-file path and
browser-cache path in `config.json`. Source:
[garrytan/gstack](https://github.com/garrytan/gstack).

Use `research-login.ps1 perplexity` to open the configured session's sign-in
page. Complete any login/challenge yourself. Existing local authorized cookie
setup may be used through gstack; DeltaRoute ships no cookies and exports none.
If a site blocks access, source collection reports the gate. No challenge bypass
or forced account creation is supplied.

Research can use original public pages through gstack when Perplexity is
unavailable. Required primary sources are validated before downstream analysis.
Grok analyzes the supplied source packet and should not claim native live X
access. Browser selectors are inherently subject to site changes.

## Video and specialist skills

The local watch engine requires Python, yt-dlp, FFmpeg/ffprobe and the watch
script dependencies documented in the bundled upstream skill. Keep these tools
local. Configure their absolute executable/script paths in `config.json`; the
doctor reports missing pieces. No provider binary or full Python environment is
redistributed.

Use `video_analysis` with the original public URL. The default samples the first
60 seconds with up to eight 512-pixel frames. Explicit `media_options` allow
windows up to 600 seconds, 1–24 frames and widths 256–1024. Long-video workflows
use multiple windows and disclose gaps. Audio is unverified without native
captions; no automatic speech-model installation or audio upload is enabled.

The skill manifest records source pins, hashes and licenses. Read
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) before adding optional
collections. Installation and routing never execute a matched skill script
automatically. Three.js/Blender/Remotion instructions require their actual
renderer/project dependencies. Existing product/video workflows take precedence.

## Manual integration

The portable stdio entry is `node /absolute/DeltaRoute/server.mjs`. Generate
`config.json` first, then register that command with the host's normal MCP setup.
Set `DELTAROUTE_COORDINATOR=codex` for a Codex host; the default is Claude.
Manually apply the corresponding `CODEX-ROUTING.md` or `ROUTING.md` policy and
copy the native skill, replacing `__DELTAROUTE_ROOT__` with your checkout path.
Windows installers do this replacement automatically.

macOS/Linux deployments need manual absolute paths and native CLI verification.
Windows-only subprocess tests and installation claims do not establish Unix
process-tree cancellation or a complete Unix installer.

## Common problems

- **No enabled worker:** install/sign in to an official client, review the
  generated command path and model, then deliberately enable it. A path existing
  does not prove current login/quota; the first task performs native checks.
- **Code checkout is dirty:** commit/stash your own changes when appropriate,
  or use read-only advice and implement locally. Workers do not copy uncommitted
  changes into their pinned worktrees.
- **Login expired or quota reached:** use the provider's normal sign-in or wait
  for recovery. Bounded eligible fallbacks retain failed attempts. Shared Cursor
  and Grok accounts share cooldowns.
- **`needs_coordinator`:** continue the saved task in the current host. Do not
  repeatedly submit exhausted workers. Wait for confirmed child shutdown before
  editing a workspace if the handoff requires it.
- **Both managed heads limited:** leave the supervisor waiting or stop it and
  resume the saved workflow later. Reset timestamps are not evidence of recovery.
- **MCP conflict:** inspect the existing registration and backups. Do not replace
  another server merely because it uses the same name.
- **Render unavailable:** install the renderer explicitly or return a scene
  script with unverified-render status. Skill text alone is insufficient.

## Updating and removal

Keep this checkout clean before pulling updates. Read changes, run the local
tests, review config-example differences and rerun the chosen installer if
instructions or schemas changed. Setup does not overwrite private config by
default. Preserve runtime artifacts if moving installations.

To remove host integration, remove only this project's MCP registration using
the host CLI, remove its marked global policy block, its prompt-hook entry and
the installed `deltaroute` skill/repetitive agent. Inspect the configuration
first; avoid restoring an old whole-file backup over later unrelated edits.
Stop managed supervisors and workers before removing their checkout. Private
job/workflow/media files can then be archived or deleted deliberately.
