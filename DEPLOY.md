# Deploying on Dokploy (Nixpacks)

Two Applications from this repository, both **Build Type = Nixpacks** and **Build Path = `/`** (the repo root
must be the build context so `pnpm-workspace.yaml`, the lockfile and `packages/*` are present).

## 1 · `pera-api` (port 3000)

| Setting | Value |
|---|---|
| Provider | GitHub → this repo, branch `main` |
| Build Type | Nixpacks |
| Build Path | `/` |
| Environment (build + run) | `NIXPACKS_CONFIG_FILE=nixpacks.api.toml`, `PORT=3000`, plus everything from `.env` (secrets, `SMART_ACCOUNT_ID`, `AGENT_RULE_ID`, `VAULT_ID`, `API_BEARER_TOKEN`, `PUBLIC_API_URL=https://<api-host>`, `RESOURCE_SERVER_URL=https://<rs-host>`, `EVENTS_FILE=/data/events.jsonl`) |
| Advanced → Volumes | **Volume Mount**: name `events-data`, mount path `/data` (keeps the JSONL event log across redeploys) |
| Domains | Host `<api-host>`, Container Port `3000`, HTTPS on, Certificate `letsencrypt` |

## 2 · `pera-resource-server` (port 4000)

| Setting | Value |
|---|---|
| Build Type / Path | Nixpacks / `/` |
| Environment | `NIXPACKS_CONFIG_FILE=nixpacks.resource-server.toml`, `PORT=4000`, `OWNER_SECRET`, `AGENT_SECRET`, `SPONSOR_SECRET` (only public keys are derived), `EVM_SPONSOR_PRIVATE_KEY`, `X402_FACILITATOR_URL=https://x402.org/facilitator`, optional `MERCHANT_STELLAR_ADDRESS`, `MERCHANT_EVM_ADDRESS`, `OZ_FACILITATOR_API_KEY` |
| Domains | Host `<rs-host>`, Container Port `4000`, HTTPS on, `letsencrypt` |

Deploy the resource server first, then set `RESOURCE_SERVER_URL` on the API app and deploy it. Nixpacks builds are
memory-hungry: deploy the two apps one at a time.

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
