# Deploying on Dokploy (Nixpacks)

Three services from this repository: two Nixpacks Applications (API, resource server) and a Postgres service. Both
Applications use **Build Type = Nixpacks** and **Build Path = `/`** (the repo root must be the build context so
`pnpm-workspace.yaml`, the lockfile and `packages/*` are present).

## 0 · Postgres (Dokploy → Create service → Database → Postgres)

Create a Postgres 16 service, then copy its internal connection string into the API app as `DATABASE_URL`
(e.g. `postgres://pera:<password>@<service-name>:5432/pera`). Tables are created automatically at API boot.

## 1 · `pera-api` (port 3000)

| Setting | Value |
|---|---|
| Provider | GitHub → this repo, branch `main` |
| Build Type | Nixpacks |
| Build Path | `/` |
| Environment (build + run) | `NIXPACKS_CONFIG_FILE=nixpacks.api.toml`, `PORT=3000`, `DATABASE_URL`, `WALLET_MASTER_KEY` (long random string), `SPONSOR_SECRET`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_GAS_SPONSORSHIP=on`, `API_BEARER_TOKEN`, `PUBLIC_API_URL=https://<api-host>`, `RESOURCE_SERVER_URL=https://<rs-host>`, `PASSKEY_RP_ID=<dashboard-domain>`, `PASSKEY_ORIGINS=https://<dashboard-domain>`, `VAULT_ID`, `DEFINDEX_API_KEY`, `X402_FACILITATOR_URL`. |
| Advanced → Volumes | **Volume Mount**: name `pera-data`, mount path `/data` (pending CCTP bridges + JSONL fallback) |
| Domains | Host `<api-host>`, Container Port `3000`, HTTPS on, Certificate `letsencrypt` |

## 2 · `pera-resource-server` (port 4000)

| Setting | Value |
|---|---|
| Build Type / Path | Nixpacks / `/` |
| Environment | `NIXPACKS_CONFIG_FILE=nixpacks.resource-server.toml`, `PORT=4000`, `SPONSOR_SECRET`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET` (creates the app-owned merchant wallet), `X402_FACILITATOR_URL=https://x402.org/facilitator`, optional `MERCHANT_STELLAR_ADDRESS` (default: owner demo key), `MERCHANT_EVM_ADDRESS`, `OZ_FACILITATOR_API_KEY` |
| Domains | Host `<rs-host>`, Container Port `4000`, HTTPS on, `letsencrypt` |

Deploy the resource server first, then set `RESOURCE_SERVER_URL` on the API app and deploy it. Nixpacks builds are
memory-hungry: deploy the two apps one at a time.

## 3 · Dashboard (Static)

`apps/dashboard` (landing page + dashboard; `apps/web` is the bare reference client and deploys the same way) builds
to static files: Application → Build Type **Static**, Build Path `/`, build command
`pnpm install --frozen-lockfile && pnpm --filter @pera/dashboard build`, publish directory `apps/dashboard/dist`, with an
SPA fallback to `index.html` (client-side routes under `/app`), env
`VITE_API_URL=https://<api-host>`, `VITE_RESOURCE_SERVER_URL=https://<rs-host>`. Its domain must equal
`PASSKEY_RP_ID` and appear in `PASSKEY_ORIGINS` on the API — passkeys are bound to the origin.

## Privy setup (EVM gas sponsorship)

Dashboard → App settings → Basics (App ID / App Secret) → Wallets → Advanced: enable **TEE execution** →
**Fee sponsorship**: turn on *Sponsor gas fees*, add **Base Sepolia** under *Supported chains*, add billing.
Privy is required: the API does not start without `PRIVY_APP_ID` / `PRIVY_APP_SECRET`, and every sign-up creates a
Privy user (`custom_auth` = Pera user id) plus an app-controlled wallet attributed to it.

## How the Nixpacks config works

`nixpacks.api.toml` / `nixpacks.resource-server.toml` at the repo root pin Node 22, enable corepack for
`pnpm@10.28.2`, run `pnpm install --frozen-lockfile`, typecheck, and start the app with `tsx` (no compile step).
Dokploy passes Application environment variables to the Nixpacks build, which is how `NIXPACKS_CONFIG_FILE`
selects the file.

## Verify

```bash
curl https://<api-host>/status | jq '.smartAccount.id, .policy.dailyCapUsdc'
curl -H "Authorization: Bearer $TOKEN" https://<api-host>/balances | jq
curl -N "https://<api-host>/events/stream?token=$TOKEN"          # ": ping" every 15 s, live events
curl -i https://<rs-host>/api/stellar/weather | head -5           # HTTP/1.1 402 + PAYMENT-REQUIRED header
PUBLIC_API_URL=https://<api-host> pnpm agent pay https://<rs-host>/api/stellar/weather
```

After a redeploy, `GET /events` must still list earlier events — that proves the `/data` volume is mounted.
