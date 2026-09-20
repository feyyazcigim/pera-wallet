---
name: pera-wallet
description: Pay HTTP 402 (x402) paywalls and check balances with the user's Pera Agent Wallet on Stellar (+ Base Sepolia) through the pera_wallet MCP server.
version: 0.1.0
author: Pera
license: MIT
platforms: [linux, macos, windows]
required_environment_variables: [PERA_AGENT_TOKEN]
metadata:
  hermes:
    tags: [payments, x402, stellar, wallet, usdc, http-402]
    category: payments
    requires_tools: [mcp__pera_wallet__quote_payment, mcp__pera_wallet__pay_url]
---

# Pera wallet — paying for things on the user's behalf

Tool names appear as `mcp__pera_wallet__<tool>` (if your Hermes shows `mcp_pera_wallet_<tool>`, use that spelling).

## When to use
- A request answers **HTTP 402** with a `PAYMENT-REQUIRED` header (x402), or the user asks you to buy/fetch a paid API,
  dataset or service, or asks about their wallet balance / spending limits / payment history.
- Not for: sending money to people, changing limits, cashing out — those are owner actions in the Pera dashboard.

## Procedure
1. Once per session call `wallet_info` (or `get_spending_policy`) to learn the remaining on-chain daily cap and the
   owner's rules (weekly limit, max per call, allowed networks, approval threshold).
2. **Quote before paying** when the price is unknown: `quote_payment { url }` → price, network, payee and a verdict
   (`allow` | `requires_approval` | `denied`). Never guess or invent an amount.
3. Pay with `pay_url { url, max_amount_usdc? }`. Set `max_amount_usdc` to the quoted price (a small safety margin is fine).
   The tool fetches the resource, pays the 402 and returns the **paid response body** plus a receipt.
4. Report the result to the user with the receipt: `amountUsdc`, `network`, `txHash`, `explorerUrl`.
5. If `status` is `pending` (Base payments bridge USDC from Stellar via CCTP first, 1–3 min): call
   `payment_status { job_id }` — it waits up to 45 s per call — until the status is `paid` or an error. Never call
   `pay_url` again for the same request; that would pay twice.
6. If `status` is `requires_approval`: stop, tell the user the `approveUrl` (they approve in the dashboard), then retry
   the same call with `approval_id`. If `status` is `denied`: report `reason` and do not retry with the same arguments.
6. If balances are too low, tell the user to add lira from the Pera dashboard (Home, "add lira");
   you cannot fund the wallet yourself.

## Pitfalls
- Amounts are decimal USDC strings ("0.01"). Prices on Stellar are 7-decimal, on Base 6-decimal — the tool converts.
- The on-chain daily cap is enforced by the smart account's policy contract (`#3221 SpendingLimitExceeded`); the router
  rules are enforced by the Pera API. Neither can be bypassed from here.
- A payment on `eip155:84532` may bridge USDC from Stellar with Circle CCTP first (up to ~2 minutes); wait for the tool.
- Never put secrets or the agent token into `headers` of `pay_url`; the tool strips auth/payment headers anyway.
- Use `list_payments` to check whether something was already paid before paying again (payments are not idempotent).

## Verification
- `wallet_info` returns the smart account id and the token scopes; `quote_payment` on a free URL returns `paywalled: false`.
- After `pay_url`, `list_payments` shows an `x402.paid` event with the same `txHash`.
