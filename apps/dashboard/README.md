# @pera/dashboard

The product frontend: the landing page (`/`), passkey onboarding (`/app/onboard`) and the dashboard
(`/app`, `/app/rules`, `/app/analytics`). Vite + React + TypeScript, no build step beyond `vite build`.

```bash
pnpm dev:api && pnpm dev:rs        # the API (:3000) and the demo paywalls (:4000)
pnpm dev:dashboard                 # :5174 — must be listed in the API's PASSKEY_ORIGINS
```

| Path | What it is |
|---|---|
| `src/app/api.ts` | the only place that talks to the API; wire types mirror `apps/api/src/routes/*` and `openapi.yaml` |
| `src/app/kit.ts` | smart-account-kit attach + `signAdmin` for the passkey-signed cap change (ported from `apps/web`, lazy-loaded) |
| `src/app/store.tsx` | one data provider: `/me`, `/balances`, `/yield/position`, `/agent/policy`, `/events` + the SSE stream |
| `src/app/demo.ts` | an in-browser stand-in backend behind "Look around with demo data" — labelled as demo everywhere, never on-chain |
| `src/app/{Onboard,Shell,Home,Rules,Analytics}.tsx` | the pages |
| `src/{App,FlowScene,HowCards}.tsx` | the landing page; `FlowScene` is reused on the dashboard, driven by live events |

Env: `VITE_API_URL` (default `http://localhost:3000`), `VITE_RESOURCE_SERVER_URL` (default `http://localhost:4000`).
Passkeys are bound to the origin: the dashboard's host must equal `PASSKEY_RP_ID` and appear in `PASSKEY_ORIGINS`.
