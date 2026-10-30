# Connect other AIs to DeltaRoute

Any AI that can use an MCP server over HTTP (Meta Muse custom connectors,
ChatGPT or Claude connectors, other agents) can send work to DeltaRoute. Each
one gets its own key, and you can add or remove them at any time.

## Add an AI

In the DeltaRoute folder (the Codespace terminal, or any server running it):

```
node remote-mcp.mjs add-client muse
```

It prints that AI's key once. Only a fingerprint of the key is stored, in
`state/remote-clients.json`, which never goes into Git. Add another AI the same
way with its own name (`add-client chatgpt`, `add-client my-agent`).
`node remote-mcp.mjs list-clients` shows them; `remove-client <name>` revokes
one immediately.

## Give the AI the address and key

- Address: `https://<codespace name>-8787.app.github.dev/mcp` in a GitHub
  Codespace (port 8787 must be set to Public: Ports tab, or
  `gh codespace ports visibility 8787:public -c <codespace name>`). On another
  server, put an HTTPS proxy in front of `http://127.0.0.1:8787/mcp`.
- Authentication: API key, sent as the header `Authorization: Bearer <key>`.
- Transport: MCP Streamable HTTP (JSON responses; an event stream for clients
  that accept only that).

For Meta Muse: ask Muse to "create a Custom Connector" for DeltaRoute, and give
it the address and the key when it asks (Muse keeps the key in its Secure
Credentials Store). Meta does not review custom connectors.

## What a connected AI can do

- Tools: `list_workers`, `recommend_route`, `submit_task` (delegate only),
  `get_task`, `cancel_task`.
- It cannot approve plans or reviews, change the model registry, or speak for
  you in any approval. Code jobs are off unless the AI was added with
  `--allow-code`.
- Full access is your choice per AI: `add-client <name> --full`, or
  `set-client <name> --full` for one already connected (its key stays the same).
  It then has every tool and action you have, plan and review approvals and
  model registry changes included, all made in your name.
  `set-client <name> --limited` takes that back.
- It runs work on your subscriptions and can ask workers to read files on that
  machine, so keep keys private and remove any you no longer use.

The endpoint starts with the Codespace (`cloud/remote.sh`) once at least one AI
is added, and `cloud/serve-remote.sh` restarts it if it exits (log:
`state/remote-mcp.log`). On a server, `cloud/install.sh` runs it as the
`deltaroute-mcp` systemd service. It is reachable only while the Codespace or
server is running. To run it by hand: `node remote-mcp.mjs serve`.

## Getting files back

Image and other output files can be downloaded with the same key:

- `GET /files/<task id>` lists a finished task's output files.
- `GET /files/<task id>/<file>` sends one.

Or from any computer with Node.js 22 and this repo:

```
DELTAROUTE_KEY=<key> node remote-mcp.mjs download https://<address> <task id> ./out
```

## When it does not answer

- `node remote-mcp.mjs health https://<address>` (or open
  `https://<address>/health`; no key needed). If that fails, the server, the
  Codespace or the forwarding is down, not your key.
- Every response from DeltaRoute itself has an `X-DeltaRoute` header. A 404 or
  502 without it came from GitHub's port forwarding; wait and retry.
  `node remote-mcp.mjs call https://<address> <tool> '<json>'` does that for
  you, and never sends a task twice.
- A stopped Codespace: from your own computer, with the GitHub CLI signed in,
  `bash cloud/wake.sh [codespace name]` starts it, starts the endpoint, makes
  port 8787 public again and waits for `/health`.
- The Codespace address only works while the Codespace runs and its forwarding
  behaves. For an address that stays up, run DeltaRoute on an always-on server
  (`cloud/install.sh`) behind an HTTPS proxy.
