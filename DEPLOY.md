# Deploying on Dokploy (Nixpacks)

Production = **Postgres + `pera-api` + the static dashboard on one domain**. The demo paywall server
(`apps/resource-server`) is optional: agents pay any third-party x402 endpoint; deploy it only if you want the built-in
demo paywalls. Nixpacks Applications use **Build Path = `/`** (the repo root must be the build context so
`pnpm-workspace.yaml`, the lockfile and `packages/*` are present).

Domains: `<domain>` → dashboard (landing at `/`, app at `/app`), `api.<domain>` → API (+ `/mcp`).
Passkeys are bound to the dashboard origin: `PASSKEY_RP_ID=<domain>`, `PASSKEY_ORIGINS=https://<domain>`.

## 0 · Before you start
- DNS: `<domain>` and `api.<domain>` → the Dokploy server.
- Privy (dashboard.privy.io): App ID + App Secret; Wallets → Advanced → **TEE execution**; **Fee sponsorship** → Sponsor gas
  fees + **Base Sepolia** in Supported chains + billing. (The API boots without Privy but sign-up answers `503 PRIVY_NOT_CONFIGURED`.)
- Optional: DeFindex API key (`sk_…`).
- Secrets: `SPONSOR_SECRET` = your funded testnet sponsor key; `WALLET_MASTER_KEY` and `API_BEARER_TOKEN` = `openssl rand -hex 32`.

## 1 · Postgres
Dokploy → Create service → Database → **Postgres 16** (db `pera`, user `pera`). Internal URL:
`postgres://pera:<password>@<service-name>:5432/pera`. Tables are created at API boot.

## 2 · `pera-api` (port 3000, also serves `/mcp`)
| Setting | Value |
|---|---|
| Provider | GitHub `feyyazcigim/pera-wallet`, branch `main` |
| Build Type / Path | Nixpacks / `/` |
| Environment | see block below |
| Advanced → Volumes | Volume Mount `pera-data` → `/data` (pending CCTP bridges) |
| Domains | Host `api.<domain>`, Container Port `3000`, HTTPS, letsencrypt |

```
NIXPACKS_CONFIG_FILE=nixpacks.api.toml
PORT=3000
DATABASE_URL=postgres://pera:<password>@<service-name>:5432/pera
WALLET_MASTER_KEY=<openssl rand -hex 32>
API_BEARER_TOKEN=<openssl rand -hex 32>
SPONSOR_SECRET=S…
PRIVY_APP_ID=…
PRIVY_APP_SECRET=…
PRIVY_GAS_SPONSORSHIP=on
PUBLIC_API_URL=https://api.<domain>
PASSKEY_RP_ID=<domain>
PASSKEY_ORIGINS=https://<domain>
X402_FACILITATOR_URL=https://x402.org/facilitator
AGENT_DAILY_CAP_USDC=10
YIELD_RESERVE_USDC=5
AUTOPILOT=on
LOG_LEVEL=info
# optional
DEFINDEX_API_KEY=sk_…                # optional; with it the API creates the DeFindex vault at first boot and stores the id in Postgres
VAULT_ID=
RESOURCE_SERVER_URL=            # only if you deploy the demo paywalls (step 4)
```
Keep the proxy read timeout ≥ 180 s on this host (`pay_url` on Base Sepolia bridges USDC through CCTP first).
Verify: `curl https://api.<domain>/status` → `database: "postgres"`, `evm.configured: true`, `mcp.url`.

## 3 · Dashboard (static, landing + app)
`apps/dashboard` is a Vite SPA (landing at `/`, app at `/app`). `Dockerfile.dashboard` builds it and serves the
output with nginx (SPA fallback in `apps/dashboard/nginx.conf`, needed for `/app` and `/approvals/<id>` deep links):

- Application → Provider: GitHub `pera-wallet`, branch `main`, **Build Path `/`**.
- Build Type **Dockerfile**: Docker File `Dockerfile.dashboard`, Docker Context Path `.`, Build Stage empty.
- Build Args (or Environment on older Dokploy versions): `VITE_API_URL=https://api.<domain>`. Optional: without it the
  dashboard talks to `https://api.<current hostname>`. `VITE_RESOURCE_SERVER_URL=https://x402.<domain>` only with
  step 4. Vite inlines `VITE_*` at build time, so changing them means a redeploy.
- Domain: `<domain>`, container port 80, HTTPS.

Order: 1 → 2 → 3. Builds are memory-hungry: deploy one Application at a time. 1 → 2 → 3. Nixpacks builds are memory-hungry: deploy one Application at a time. 1 → 2 → 3. Nixpacks builds are memory-hungry: deploy one Application at a time.

## 4 · Optional: demo paywalls (`pera-resource-server`, port 4000)
x402 endpoints (`/api/stellar/weather` — Stellar only; `/api/base/weather` and `/api/base/summary` — Base only, $1; `/api/any/quote` — both)
at $0.01 on Stellar / $1 on Base, so agents have something to pay on testnet. Application → GitHub `pera-wallet`, **Nixpacks**, Build
Path `/`, domain `x402.<domain>` → port 4000, HTTPS. Env:
```
NIXPACKS_CONFIG_FILE=nixpacks.resource-server.toml
PORT=4000
SPONSOR_SECRET=S…                     # same as the API (only used as the default merchant)
X402_FACILITATOR_URL=https://x402.org/facilitator
MERCHANT_STELLAR_ADDRESS=G…           # receives the USDC: any testnet account with a USDC trustline,
                                      # e.g. your Treasury from the dashboard (Rules → Your accounts)
PASSKEY_RP_ID=<domain>                # loadEnv() needs them; unused here
PASSKEY_ORIGINS=https://<domain>
PRIVY_APP_ID= / PRIVY_APP_SECRET=     # optional: enables the Base offers (merchant = app-owned Privy wallet)
```
Then set `RESOURCE_SERVER_URL=https://x402.<domain>` on the API and `VITE_RESOURCE_SERVER_URL=https://x402.<domain>` on
the dashboard and redeploy both: `list_services` / `/agent/services` list the endpoints and the dashboard's demo
buttons get targets. `quote_payment` / `pay_url` work with any x402 URL regardless.

## Verify
```bash
curl https://api.<domain>/status | jq '.database, .evm.configured, .mcp'
# browser: https://<domain> → create wallet (one passkey prompt) → /app shows agentAuthorised: true
# mint an agent token in the dashboard (or POST /agent/tokens with the session), then:
curl -s https://api.<domain>/mcp -H "Authorization: Bearer pat_…" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'
PUBLIC_API_URL=https://api.<domain> pnpm agent connect <pat_token> && pnpm agent pay https://<any-x402-url>
```
After a redeploy, `GET /events` must still list earlier events (Postgres) and `/data` must persist.

## Hermes
Two ways to attach Nous Hermes Agent, both use the same `pat_…` token from the dashboard (*Connect an agent*):

- **On the user's machine** (CLI/TUI): `integrations/hermes/README.md`, first section — `~/.hermes/.env` gets
  `PERA_AGENT_TOKEN`, `config.yaml` gets `config.snippet.yaml` with `url: https://api.<domain>/mcp`.
- **On Dokploy as a Telegram bot** (Compose service, no domain): `integrations/hermes/README.md`, "Run Hermes on a
  server". Compose Path `./integrations/hermes/docker-compose.yml`; env `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USERS`,
  `PERA_AGENT_TOKEN`, `PERA_MCP_URL=https://api.<domain>/mcp`, `AWS_BEARER_TOKEN_BEDROCK` (or IAM keys), `AWS_REGION`,
  `HERMES_MODEL` (Bedrock inference profile id). Pulls the official `nousresearch/hermes-agent` image (≈ 1 GB); persistent volume `hermes-data`.

## How the Nixpacks config works
`nixpacks.api.toml` / `nixpacks.resource-server.toml` at the repo root pin Node 22, enable corepack for `pnpm@10.28.2`,
run `pnpm install --frozen-lockfile`, typecheck, and start the app with `tsx` (no compile step). Dokploy passes
Application environment variables to the Nixpacks build, which is how `NIXPACKS_CONFIG_FILE` selects the file.
