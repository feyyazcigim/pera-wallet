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

Hermes asks before non-read tool calls (`pay_url`) unless you approve the tool for the session; read tools run freely.

## Run Hermes on a server (Dokploy, Telegram bot)

`docker-compose.yml` in this folder runs the official `nousresearch/hermes-agent` image as `hermes gateway` as a Telegram bot with the
Pera MCP server pre-configured: `/opt/data/config.yaml` is generated from the environment on every boot (model,
MCP URL, token), and the `payments/pera-wallet` skill is copied in.

1. Telegram: create a bot with @BotFather (token), get your numeric user id from @userinfobot.
2. Pera dashboard → *Connect an agent* → copy the `pat_…` token (read + pay).
   AWS: Bedrock console (your region) → *Model access* → enable the model (Kimi K2.5 / Claude); *API keys* → long-term key.
3. Dokploy → Create service → **Compose** → GitHub `pera-wallet`, branch `main`, Compose Path
   `./integrations/hermes/docker-compose.yml`. Environment tab:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC…
   TELEGRAM_ALLOWED_USERS=<your telegram user id>
   PERA_AGENT_TOKEN=pat_…
   PERA_MCP_URL=https://api.<domain>/mcp
   AWS_BEARER_TOKEN_BEDROCK=…          # Bedrock console → API keys (long-term); or AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY
   AWS_REGION=us-east-2                # a region where the model is available in-region
   HERMES_MODEL=moonshotai.kimi-k2.5   # or any Converse-capable model id / inference profile (e.g. us.anthropic.claude-…)
   ```
   The model provider is AWS Bedrock (`model.provider: bedrock` in `config.yaml`; the Hermes image includes boto3).
   IAM keys need `bedrock:InvokeModel` and `bedrock:InvokeModelWithResponseStream`.
   No domain is needed (Telegram long-polling). Deploy, then message the bot: "what's my wallet balance?".
4. Later changes: edit the env in Dokploy (model, token, MCP URL) or the YAML block in `docker-compose.yml`, then
   redeploy — the file in the volume is overwritten on boot. The on-chain cap and router rules bound every `pay_url`,
   whatever the model decides. The boot log prints
   `[pera] config.yaml written: …` so you can see what Hermes was given.

## Alternatives
- **stdio** (clients without remote MCP): `npx -y @pera/mcp` with `PERA_API_URL` + `PERA_AGENT_TOKEN` (see `apps/mcp-shim`).
- **Claude Code**: `claude mcp add --transport http pera https://<api-host>/mcp --header "Authorization: Bearer pat_…"`.
- **Egress allowlists** (`hermes egress`): allow `<api-host>`; `pay_url` on Base Sepolia can take > 60 s (CCTP) — keep `timeout: 120`.
