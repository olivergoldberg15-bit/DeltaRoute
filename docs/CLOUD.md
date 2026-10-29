# DeltaRoute on a cloud server

Runs DeltaRoute on an always-on Linux server so the Claude app on a phone can
drive it with Claude Code Remote Control while the laptop is off. It uses the
same subscriptions as the laptop (Claude, ChatGPT through Codex, Gemini,
Higgsfield, and the Perplexity and Grok browser sessions), each signed in once
on the server. No API keys are added.

One server is enough. The AI work runs on OpenAI's, Google's, Anthropic's and
the research sites' computers; DeltaRoute's machine only coordinates, and each
subscription's limit is per account, so more servers would not add capacity.

## 1. Create the server (Oracle Cloud Always Free)

An adult account holder creates the Oracle Cloud account (a card is needed for
verification; Always Free resources are not charged). Then, in the Oracle
console:

1. Compute > Instances > Create instance.
2. Image: Canonical Ubuntu 24.04. Shape: Ampere `VM.Standard.A1.Flex` with
   4 OCPUs and 24 GB memory (the Always Free allowance).
3. Under "Add SSH keys" choose "Generate a key pair" and download the private
   key. Keep it on the laptop.
4. Create, then copy the instance's public IP address. The user is `ubuntu`.

Oracle may reclaim an Always Free instance that stays idle for a long stretch;
check Oracle's current Always Free terms when creating it. Any Ubuntu 22.04 or
24.04 server (arm64 or x64) with about 4 GB of memory or more works the same way.

## 2. Copy DeltaRoute, install and sign in

From the main DeltaRoute folder on the laptop:

```
powershell -ExecutionPolicy Bypass -File cloud\push-to-server.ps1 -Server ubuntu@<server ip> -Key <path to the key> -BrowserSessions
```

It sends the committed `main` branch as a git bundle, so the server keeps a git
copy, then runs `cloud/install.sh` there. That installs Node 22, Claude Code,
Codex, the Gemini CLI, the Higgsfield CLI, the gstack research browser (pinned
to the same revision as the laptop) with Chromium, and DeltaRoute. It registers
DeltaRoute with Claude Code exactly like `install.ps1` does on the laptop (MCP
server, prompt hook, instructions and skill, through `install-claude.mjs`), sets
up a service that keeps `claude remote-control` running in tmux, and runs
DeltaRoute's tests on the server. `bash cloud/install.sh --dry-run` prints every
step without changing anything.

`-BrowserSessions` copies the research browser's saved sign-ins so Perplexity
and Grok start signed in.

Then `cloud/login.sh` runs the one-time sign-ins. Each step prints a link to
open on the phone or laptop. Codex must use "Sign in with ChatGPT" and Gemini
"Login with Google", so the subscriptions are used, not API billing. Steps that
are already signed in are skipped. Run it again any time:

```
ssh -t -i <path to the key> ubuntu@<server ip> bash ~/DeltaRoute/cloud/login.sh
```

## 3. Use it from the phone

Open the Claude app, go to Code and pick the session named DeltaRoute. It runs
on the server with DeltaRoute's tools, so work continues with the laptop off.
If the service is waiting on a question: `tmux attach -t deltaroute` on the
server (leave with Ctrl+B then D). Status: `systemctl status deltaroute-remote`.

## One constant VPN (optional)

Add `-Vpn <path to a WireGuard .conf>` to send all of the server's outgoing
traffic through one constant VPN exit (for example a Proton VPN WireGuard
config: Proton dashboard, Downloads, WireGuard configuration, Linux). SSH stays
reachable, and rerunning the push keeps it that way.

A VPN or datacenter address can draw more bot checks from Google, Perplexity and
Grok than a home connection. On 2026-10-29, Proton VPN on the laptop made Google
show its robot check and a Cloudflare site block the research browser.
DeltaRoute reports those and never works around them.

## Updating

Commit on the laptop, then run `push-to-server.ps1` again. The server's copy
fast-forwards to the new `main`, and its config, jobs and sign-ins stay. A
server first set up by an earlier file-copy push is converted to a git copy
with its config, sign-ins and jobs carried over.

## Limits

- Set up for Ubuntu on arm64 and x64. Checked on Windows with a dry run, syntax
  checks and DeltaRoute's tests; not yet run on a live Oracle instance, so the
  first install is the real test (it ends by running DeltaRoute's tests there).
- The Gemini worker uses the Gemini CLI on the server (the laptop's Antigravity
  build is Windows-only).
- Saved Perplexity or Grok sign-ins may be rejected from a new address; sign in
  again with gstack on the server if research reports a sign-in error.
