# DeltaRoute in the cloud

Run DeltaRoute on one always-on Linux server and drive it from the Claude app on your phone. It still uses only
your own subscriptions: each one is signed in once on the server. Your PC is needed once, to send it there.

One server is enough. The AI work runs on OpenAI's, Google's, Anthropic's and the research sites' computers;
DeltaRoute's machine only coordinates, and every subscription's limit is per account, so more servers would not
add capacity.

## 1. Create the server (Oracle Cloud Always Free)

Oracle's Always Free tier includes an Ampere (arm64) server large enough for DeltaRoute. The account needs an
adult account holder and a card for identity checks; Always Free resources are not charged.

1. On your PC, make an SSH key and copy the line it prints:
   `.\cloud\send-to-server.ps1 -NewKey`
2. In the Oracle Cloud console: Compute, Instances, Create instance.
   - Image: Canonical Ubuntu 24.04.
   - Shape: Ampere, VM.Standard.A1.Flex, 4 OCPUs and 24 GB memory (the Always Free maximum).
   - SSH keys: paste the public key from step 1.
3. Create it and note its public IP address. The user name on Ubuntu images is `ubuntu`.

Any Ubuntu 22.04 or 24.04 server with about 4 GB of memory or more works the same way.

## 2. Send DeltaRoute and install it

From the DeltaRoute folder on your PC:

```
.\cloud\send-to-server.ps1 -Server ubuntu@<server ip> -WithResearchSessions
```

This copies the main branch, installs Node 22, Claude Code, Codex, the Gemini CLI, the Higgsfield CLI, gstack
(pinned) with Chromium and DeltaRoute, runs DeltaRoute's tests on the server, and then starts the sign-ins.

`-WithResearchSessions` copies the research browser's signed-in session so Perplexity and Grok start signed in.
Sites can ask for a fresh check from a new address; DeltaRoute reports that and never gets around it.

## 3. Sign in (once)

`cloud/signin.sh` runs automatically after the install (or run `bash ~/DeltaRoute/cloud/signin.sh` later). Each
step shows a link: open it on your phone and sign in on the provider's own page.

1. Claude: your Claude subscription (`claude auth login --claudeai`).
2. ChatGPT for Codex (`codex login --device-auth`).
3. Google for Gemini (choose Login with Google).
4. Higgsfield, optional.
5. Trust the DeltaRoute folder, then Remote Control starts as a service.

## 4. Use it from your phone

Open the Claude app, go to Code, and pick the session named **DeltaRoute**. It runs on the server around the
clock and restarts on its own. Logs: `journalctl --user -u deltaroute-remote -f`.

## One constant VPN (optional)

`-Vpn <file>` routes all of the server's outbound traffic through one WireGuard exit, for example a Proton VPN
WireGuard config (Proton dashboard, Downloads, WireGuard configuration, Linux). SSH stays reachable. VPN exits are
flagged more often than plain servers: on 2026-10-29 Proton made Google show its robot check and made a Cloudflare
site block the research browser, so leave it off unless you want it.

```
.\cloud\send-to-server.ps1 -Server ubuntu@<server ip> -Vpn C:\path\to\proton.conf -WithResearchSessions
```

## Updating

Run `send-to-server.ps1` again. It fast-forwards the server's copy of main and reruns the install; existing
sign-ins stay.
