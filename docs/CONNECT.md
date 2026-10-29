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
- Transport: MCP Streamable HTTP (JSON responses).

For Meta Muse: ask Muse to "create a Custom Connector" for DeltaRoute, and give
it the address and the key when it asks (Muse keeps the key in its Secure
Credentials Store). Meta does not review custom connectors.

## What a connected AI can do

- Tools: `list_workers`, `recommend_route`, `submit_task` (delegate only),
  `get_task`, `cancel_task`.
- It cannot approve plans or reviews, change the model registry, or speak for
  you in any approval. Code jobs are off unless the AI was added with
  `--allow-code`.
- It runs work on your subscriptions and can ask workers to read files on that
  machine, so keep keys private and remove any you no longer use.

The endpoint starts with the Codespace (`cloud/remote.sh`) once at least one AI
is added, and is reachable only while the Codespace is running. To run it by
hand: `node remote-mcp.mjs serve`.
