# @pera/mcp — stdio shim for the Pera Agent Wallet

Pera's MCP server is remote (`https://<api-host>/mcp`, Streamable HTTP, bearer = your agent token). Clients that
only support stdio MCP servers can use this shim; it forwards every tool call and keeps no keys.

```json
{
  "mcpServers": {
    "pera_wallet": {
      "command": "npx",
      "args": ["-y", "@pera/mcp"],
      "env": { "PERA_API_URL": "https://<api-host>", "PERA_AGENT_TOKEN": "pat_…" }
    }
  }
}
```

Mint the token in the dashboard (Connect an agent) or with `POST /agent/tokens` while logged in with your passkey.
Scopes: `read` (balances, policy, quotes), `pay` (pay paywalls). Funding and rule changes stay with the owner.
