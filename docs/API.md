# API and MCP reference

The machine-readable contract is [openapi.yaml](../openapi.yaml).

## REST API

All amounts are decimal USDC strings. Auth: passkey login → session bearer `ps_…`; `API_BEARER_TOKEN` is the admin
credential (`/admin/*`). `/status`, `/health` and `/auth/*` are public; `/events/stream` also accepts `?token=`.
Full schema in [openapi.yaml](../openapi.yaml).

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/register/options` → `/auth/register` | WebAuthn registration → sponsored deploy, agent rule via installer, ownership check, provisioning, session |
| POST | `/auth/login/options` · `/auth/login/verify` | WebAuthn assertion challenge / verification → session |
| GET | `/me` · `/balances` | user + wallets · treasury, float, smart account, vault, Base USDC |
| POST | `/agent/authorize/build` → `/agent/authorize` | build `add_context_rule` → browser signs with passkey → sponsored submit |
| POST | `/agent/policy/build` → `/agent/policy` | same two-step flow for `set_spending_limit` |
| POST | `/stellar/submit` `{xdr}` | sponsored submission of any passkey-signed tx on the user's smart account |
| GET | `/agent/policy` | cap / used / remaining read from the policy contract |
| POST | `/onramp` `{amountTry}` · GET `/onramp/:id` | SEP-6 deposit into the treasury + simulated wire |
| POST | `/offramp` `{amountUsdc}` | vault → treasury if needed, SEP-6 withdraw (sponsor pays) |
| POST | `/yield/deposit` · `/yield/withdraw` · GET `/yield/position` | vault ops on the user's position |
| POST | `/agent/pay` `{url, method?, headers?, body?, prefer?, maxAmountUsdc?, approvalId?}` | pays a paywalled URL for the user (scope `pay`); body + receipt + timeline |
| POST | `/agent/quote` · GET `/agent/services` | probe without paying · discover paid endpoints (scope `read`) |
| POST · GET · DELETE | `/agent/tokens[/:id]` | scoped agent tokens for AI runtimes (owner) |
| GET · POST | `/approvals[/:id/approve\|deny]` | human approvals for payments above the threshold (owner) |
| POST | `/agent/connect/hermes` | token + config snippet + deep link for Hermes (owner) |
| POST | `/mcp` | MCP server (Streamable HTTP): the same capabilities as tools |
| POST | `/agent/pay/over-cap-demo` | funds the smart account, attempts an over-cap top-up, returns the rejection |
| POST | `/evm/transfer` `{to, amountUsdc}` | gasless USDC transfer from the user's EVM wallet |
| GET | `/events` · `/events/stream` · `/admin/events` | per-user events / SSE · all users (admin) |

Event types: `user.registered`, `wallet.provisioned`, `agent.authorized`, `onramp.started|completed`,
`yield.deposited|withdrawn`, `float.topup|topup.rejected`, `x402.402|paid`, `bridge.burned|attested|minted`,
`offramp.completed`: persisted per user in Postgres.

## MCP: use pera. from Hermes, Claude Code or any agent

Pera is a **remote MCP server** at `https://<api-host>/mcp` (Streamable HTTP, stateless, bearer = a scoped **agent
token**). No fork of the agent framework is needed; the policy stays on Pera's side, so the agent runtime is untrusted.

| Tool | Scope | What it does |
|---|---|---|
| `wallet_info`, `get_balances`, `get_spending_policy`, `list_services`, `list_payments` | `read` | wallet, balances, on-chain cap + owner rules, paid endpoints, history |
| `quote_payment { url }` | `read` | probe a paywall **without paying**: price, network, payee, verdict `allow \| requires_approval \| denied` |
| `pay_url { url, max_amount_usdc?, approval_id? }` | `pay` | pay the 402 within the owner's rules, the optional approval threshold and the **on-chain daily cap**; returns the paid body + receipt (`txHash`, `explorerUrl`) |

Human-in-the-loop: with `approveAboveUsdc` set in the rules, larger payments return `status: requires_approval`
with an `approveUrl`; the owner approves in the dashboard (`POST /approvals/:id/approve`) and the agent retries with
`approval_id` (single use, 24 h). Agent tokens are minted by the owner (`POST /agent/tokens`, scopes `read | pay`), shown once, stored hashed, revocable (`DELETE /agent/tokens/:id`). Agent tokens can never change
rules or the cap, off-ramp, or move funds out.

**Hermes Agent** (`integrations/hermes/`): `POST /agent/connect/hermes` returns the `~/.hermes/config.yaml` snippet,
the `PERA_AGENT_TOKEN` env line and a `hermes://mcp/install?…` deep link; a SKILL.md teaches the model when and how
to pay (`quote_payment` → `pay_url` → cite the receipt). **Claude Code**: `claude mcp add --transport http pera
https://<api-host>/mcp --header "Authorization: Bearer pat_…"`. **stdio-only clients**: `npx -y @pera/mcp`
(`apps/mcp-shim`, forwards to the remote server, keeps no keys). Verified end to end by `pnpm smoke:mcp`.
