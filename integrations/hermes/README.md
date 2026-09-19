# Connect Hermes Agent to your Pera wallet

Hermes needs **no fork or plugin**: Pera is a remote MCP server. Three steps.

1. **Get an agent token** — in the Pera dashboard click *Connect an agent* (or, logged in with your passkey,
   `POST /agent/connect/hermes`). You get a `pat_…` token with the `read` + `pay` scopes (90 days, revocable
   under *Agent tokens*). Add it to Hermes' secrets:
   ```bash
   echo 'PERA_AGENT_TOKEN=pat_…' >> ~/.hermes/.env
   ```
2. **Register the MCP server** — paste `config.snippet.yaml` into `~/.hermes/config.yaml` (under `mcp_servers`),
   or open the `hermes://mcp/install?…` deep link the dashboard shows, or run
   `hermes mcp add pera_wallet` and enter the URL + header interactively. Then:
   ```bash
   hermes mcp test pera_wallet      # lists the 8 tools (mcp__pera_wallet__pay_url …)
   ```
3. **Install the skill** (optional but recommended — it tells the model *when* and *how* to use the wallet):
   ```bash
   hermes skills install https://raw.githubusercontent.com/feyyazcigim/pera-wallet/main/integrations/hermes/skills/payments/pera-wallet/SKILL.md
   ```

Try it: `hermes -z "Quote the price of http://<resource-server>/api/stellar/weather with my Pera wallet, then pay it and tell me the weather and the tx hash."`

## What the agent can and cannot do
- Reads (free): `wallet_info`, `get_balances`, `get_spending_policy`, `list_services`, `quote_payment`, `list_payments`.
- Pays (`pay` scope): `pay_url` — only within the owner's rules (allowed chains, max per call, weekly limit, optional
  approval threshold) and the **on-chain daily cap** enforced by the smart account's policy contract. Refusals come
  back as `status: denied` / `requires_approval` (the human approves in the dashboard, the agent retries with `approval_id`).
- Never: change rules or the cap, off-ramp, move funds out of the wallet, or fund it (`request_funding` only returns the
  bank instructions for the human, and needs the `fund` scope).

`trust: untrusted` in the snippet makes Hermes ask you before every non-read tool call; drop it once you trust the flow.

## Alternatives
- **stdio** (clients without remote MCP): `npx -y @pera/mcp` with `PERA_API_URL` + `PERA_AGENT_TOKEN` (see `apps/mcp-shim`).
- **Claude Code**: `claude mcp add --transport http pera https://<api-host>/mcp --header "Authorization: Bearer pat_…"`.
- **Egress allowlists** (`hermes egress`): allow `<api-host>`; `pay_url` on Base Sepolia can take > 60 s (CCTP) — keep `timeout: 120`.
