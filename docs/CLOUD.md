# DeltaRoute on a cloud server

Runs DeltaRoute on an always-on Linux server so the Claude app on a phone can
drive it with Claude Code Remote Control while the laptop is off. It uses the
same subscriptions as the laptop (Claude, ChatGPT through Codex, Gemini,
Higgsfield, and the Perplexity and Grok browser sessions), each signed in once
on the server. No API keys are added.

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
check Oracle's current Always Free terms when creating it.

## 2. Copy DeltaRoute and install

From the main DeltaRoute folder on the laptop:

```
powershell -ExecutionPolicy Bypass -File cloud\push-to-server.ps1 -Server ubuntu@<server ip> -Key <path to the key> -BrowserSessions
```

Add `-Vpn <path to a WireGuard .conf>` to send all of the server's outgoing
traffic through one constant VPN exit (for example a Proton VPN WireGuard
config). SSH stays reachable. A VPN or datacenter address can draw more bot
checks from Google, Perplexity and Grok than a home connection; DeltaRoute
reports those and never works around them.

The installer sets up Node 22, Claude Code, Codex, the Gemini CLI, the
Higgsfield CLI, the gstack research browser, DeltaRoute's config, its
`subscription-router` MCP registration, and a service that keeps
`claude remote-control` running.

## 3. Sign in once

```
ssh -t -i <path to the key> ubuntu@<server ip> bash ~/DeltaRoute/cloud/login.sh
```

Each step prints a link to open on the phone or laptop. Codex must use "Sign
in with ChatGPT" and Gemini "Login with Google", so the subscriptions are used,
not API billing.

## 4. Use it from the phone

Open the Claude app, go to Code and pick the session named DeltaRoute. It runs
on the server with DeltaRoute's tools, so work continues with the laptop off.

## Updating

Run `push-to-server.ps1` again after committing changes on the laptop. It
replaces the code and keeps the server's config, jobs and sign-ins.

## Limits

- Set up for Ubuntu on arm64 and x64; checked locally for syntax only, not yet
  run on a live Oracle instance.
- The Gemini worker uses the Gemini CLI on the server (the laptop's Antigravity
  build is Windows-only).
- Saved Perplexity or Grok sign-ins may be rejected from a new address; sign in
  again with gstack on the server if research reports a sign-in error.
