# Design notes

How pera. is put together, why, and what was hard. The overview is in the [README](../README.md).

## The flow, step by step

0. **Passkey sign-up: one biometric prompt, nothing else ever again for payments.** The dashboard runs a
   standard WebAuthn registration (`startRegistration`) and posts it to `POST /auth/register`. The API deploys the
   smart account with the sponsor key, with rule 0 = *[passkey, temporary installer key]* under `simple_threshold(1)`;
   the installer installs the agent's capped rule (`add_context_rule` with the agent signer + `spending_limit`),
   then **removes itself**, so rule 0 ends up passkey-only: verified on-chain before the response. The API also
   creates the user's **treasury** and **agent** Stellar accounts with *sponsored reserves* (0 XLM) and a **Privy
   EVM wallet**: a Privy user is created for the same identity (`custom_auth` = our user id, plus the email) and an
   app-controlled server wallet is attributed to it, so the agent can sign autonomously while Privy sponsors gas.
   Login is a standard WebAuthn assertion verified by the API (challenge + origin + rpId + P-256 signature);
   sessions last 7 days.
1. **Cap changes only** need the passkey: the owner signs `set_spending_limit` (through the smart account's
   `execute`) in the browser with `kit.signAdmin`; the API re-simulates and submits it sponsored. Re-approving the
   agent (e.g. after revoking it) uses the same two-step flow (`/agent/authorize/build` → `/agent/authorize`).
2. **On-ramp**: 200 TRY through `tr-mock-anchor` (SEP-1/10/12/38/6). USDC lands on the user's treasury account.
3. **Auto-yield**: the autopilot deposits everything above a reserve from each user's treasury into the shared
   DeFindex vault (per-user shares); withdrawals are instant and happen inline when the agent needs liquidity.
4. **Capped agent**: the agent tops up its float from the smart account under the `spending_limit` policy
   (10 USDC / rolling 24 h). A 0.51 USDC top-up succeeds; an attempt above the remaining cap is **rejected by the
   policy contract** (`Error(Contract, #3221) SpendingLimitExceeded`). Usage is read back from the policy's on-chain state.
5. **x402 on Stellar**: the agent hits a paywalled weather API, gets a 402, pays 0.01 USDC natively from its float,
   receives live Istanbul weather. The facilitator sponsors the network fee, so the float holds USDC only.
6. **x402 on Base Sepolia**: the agent hits an `eip155:84532` paywall, burns USDC on Stellar through **Circle
   CCTP V2**, waits for the Iris attestation, mints to the user's Privy wallet (`receiveMessage` sent by that wallet
   with Privy gas sponsorship) and pays with the EVM exact scheme (EIP-3009, gasless; ERC-1271 mode once the wallet
   is 7702-delegated).
7. **Off-ramp**: USDC back to TRY through the same anchor (SEP-6 withdraw with an id memo; sponsor pays the fee).

## Custody and the float

**Key custody.** The smart account owner is the user's passkey: it never leaves the device. The backend keeps two
custodial Ed25519 keys per user (treasury, agent), AES-256-GCM encrypted in Postgres under `WALLET_MASTER_KEY`; the
agent key is worthless beyond the on-chain cap, and the treasury key can only ever move funds *into* the smart
account, the vault or the anchor off-ramp. EVM keys never exist outside Privy's TEE. Roadmap: move the custodial
Stellar keys into Privy raw-sign wallets too, and make the Privy wallet user-owned with the backend as a session
signer (Privy authorization key) instead of app-owned.

**Design decision: vault-fronts-float.** `@x402/stellar` cannot use a C-address as the payer today: the client
forces an Ed25519 signature shape, the reference facilitator rejects policy events during simulation, and its fee
ceiling refuses `__check_auth` calls that touch other contracts (x402-foundation/x402 issues
[#3158](https://github.com/x402-foundation/x402/issues/3158), [#3352](https://github.com/x402-foundation/x402/issues/3352),
[#3515](https://github.com/x402-foundation/x402/issues/3515), all open). So the bulk of the funds stays in the
smart account and the vault, the agent owns a tiny classic *float* account, and the **only** path from the smart
account to the float is a USDC `transfer` that the agent's Ed25519 signer can authorise **under the on-chain
spending cap**. The agent then pays x402 from the float like any classic payer. The security story stays fully
on-chain: the cap is enforced inside the smart account's `__check_auth`, not by our backend.

## Design decisions and trade-offs

- **Vault-fronts-float** (above). Pure C-address x402 payment is a roadmap item, blocked by the linked issues.
- **Passkey owns the smart account; the backend holds only restricted keys.** Sign-up is a single ceremony
  because a temporary installer co-signer (derived from the master key + credential id, never stored) installs the
  agent rule under `simple_threshold(1)` and removes itself in the same flow; the API verifies the final rule 0
  before answering. Later admin operations (cap changes) are signed in the browser with `kit.signAdmin` and
  submitted by the API with the sponsor key (`resimulateAndAssemble` + fee payer), because the public relayer
  proxy is origin-locked and passkey-only. Trade-off: for a few seconds during sign-up the backend is a co-owner;
  the removal transaction is on-chain and auditable.
- **Treasury G-account per user is the anchor receiver and DeFindex depositor.** SEP-6 pays classic accounts and
  the hosted DeFindex API returns `operationXDR` for C-address callers; a custodial treasury keeps both flows to one
  signed XDR. All treasury/agent transactions are sponsor-sourced or fee-bumped, and the accounts are created with
  sponsored reserves, so users hold no XLM at all.
- **EVM gas sponsorship through Privy only** (`sponsor: true`, EIP-7702 + paymaster; needs TEE + Fee sponsorship +
  Base Sepolia enabled in the Privy dashboard). There is no non-Privy EVM path: no backend EOA holds ETH, and the
  API refuses to start without `PRIVY_APP_ID` / `PRIVY_APP_SECRET`.
- **Postgres for users, passkeys, sessions, wallets and events** (PGlite embedded in dev). Custodial secrets are
  AES-256-GCM encrypted under `WALLET_MASTER_KEY`.
- **No recipient allowlist.** OpenZeppelin's policies are `simple_threshold`, `weighted_threshold` and
  `spending_limit`; the latter meters `transfer` amounts but ignores `to`. The amount cap is the load-bearing
  control; a recipient-restricting policy is on the roadmap.
- **Own vault, zero strategies on testnet.** DeFindex's testnet Blend USDC strategy is denominated in a different
  test asset (BlendUSDC) than the anchor's USDC, so we create our own vault on the Circle USDC SAC. The vault
  contract accepts an asset with no strategies (deposits stay idle), which keeps deposit/withdraw/shares real
  while yield is zero on testnet. Mainnet roadmap: DeFindex's Blend USDC autocompound strategy.
- **CCTP over Near Intents / Allbridge.** Native USDC in, native USDC out, no liquidity assumptions. Near Intents
  is the roadmap path for non-USDC assets on mainnet.
- **`x402.org` facilitator for both networks.** It sponsors Stellar fees and serves Base Sepolia without a key;
  the OpenZeppelin facilitator is wired in as an optional second client.

## Technical challenges

- `@x402/stellar` C-address payer limitation (issues #3158 / #3352 / #3515) → vault-fronts-float.
- Two testnet USDCs: the DeFindex Blend strategy wants BlendUSDC, the anchor pays Circle USDC → own vault.
- `smart-account-kit` `connectWallet()` requires the indexer's birth claim and a WebAuthn ceremony → both the API
  and the reference client re-attach with the public `kit.wallet` + private ids (pinned to 0.8.0, canary-tested).
- Sponsored Privy transactions return `hash: ""` until confirmed → the provider polls `transactions().get(id)`.
- `spending_limit` only meters the `transfer` context and must be installed on a `CallContract` rule at rule
  creation time; the kit's `transfer()` takes whole units while the policy limit is in stroops.
- Two `@stellar/stellar-sdk` majors coexist (wallet-sdk pins 17.0.1, kit and x402 need ^16.3): packages exchange
  strings only, never SDK objects.
- CCTP amounts are 6-decimal while Stellar USDC has 7 → burn amounts are rounded down to multiples of 10 stroops;
  Iris attestation latency is hidden by pre-bridging at bootstrap and narrating progress over SSE.
- Over-cap rejections happen at simulation (Soroban evaluates the policy against live ledger state), so the
  artefact is the decoded `#3221` plus the policy contract: reproducible on demand from the dashboard.
