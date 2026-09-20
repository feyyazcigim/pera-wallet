/** Generates openapi.yaml from the API's zod schemas + a hand-written path map.  pnpm gen:openapi */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { stringify } from "yaml";
import { z } from "zod";
import { repoRoot } from "@pera/core";
import { bodySchemas } from "@pera/api/schemas";

const schemas: Record<string, unknown> = {};
for (const [name, schema] of Object.entries(bodySchemas)) {
  const json = z.toJSONSchema(schema, { target: "openapi-3.0" }) as Record<string, unknown>;
  delete json.$schema;
  schemas[name] = json;
}

const bearer = [{ bearerAuth: [] }];
const json = (ref: string) => ({ "application/json": { schema: { $ref: `#/components/schemas/${ref}` } } });
const obj = (description: string) => ({ description, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } });
const err = { description: "Error", content: json("Error") };

const paths = {
  "/status": { get: { summary: "Network, sponsor, smart-account artefacts, vault, EVM provider, facilitator (public)", security: [], responses: { 200: obj("Status") } } },
  "/auth/register": { post: { summary: "Register a passkey-owned smart account (deploy payload from smart-account-kit createWallet) and provision treasury/agent/EVM wallets", security: [], requestBody: { required: true, content: json("RegisterBody") }, responses: { 201: obj("{ token, expiresAt, user, wallets }"), 400: err, 403: err, 409: err } } },
  "/auth/login/options": { post: { summary: "WebAuthn assertion options (challenge, rpId, allowCredentials)", security: [], requestBody: { content: json("LoginOptionsBody") }, responses: { 200: obj("{ challenge, rpId, allowCredentials }") } } },
  "/auth/login/verify": { post: { summary: "Verify the passkey assertion → session token", security: [], requestBody: { required: true, content: json("LoginVerifyBody") }, responses: { 200: obj("{ token, expiresAt, user, wallets }"), 401: err } } },
  "/auth/logout": { post: { summary: "Invalidate the session", security: bearer, responses: { 200: obj("{ ok }") } } },
  "/me": { get: { summary: "User + wallets (smart account, treasury, agent, cap, EVM)", security: bearer, responses: { 200: obj("Me"), 401: err } } },
  "/balances": { get: { summary: "Treasury, float, smart account, vault position, Base USDC", security: bearer, responses: { 200: obj("Balances"), 401: err } } },
  "/onramp": { post: { summary: "SEP-6 TRY deposit into the user's treasury + simulated wire", security: bearer, requestBody: { required: true, content: json("OnrampBody") }, responses: { 202: obj("{ anchorTxId, status, instructions, destination }"), 400: err } } },
  "/onramp/{id}": { get: { summary: "Anchor transaction passthrough", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: obj("Anchor transaction") } } },
  "/offramp": { post: { summary: "SEP-6 withdraw USDC → TRY (vault → treasury first if needed; sponsor pays)", security: bearer, requestBody: { required: true, content: json("OfframpBody") }, responses: { 200: obj("{ anchorTxId, stellarTxHash, status, amountTry }"), 400: err } } },
  "/yield/deposit": { post: { summary: "Manual vault deposit (treasury → vault)", security: bearer, requestBody: { required: true, content: json("AmountBody") }, responses: { 200: obj("{ amountUsdc, txHash, explorerUrl }"), 503: err } } },
  "/yield/withdraw": { post: { summary: "Manual vault withdraw", security: bearer, requestBody: { required: true, content: json("AmountBody") }, responses: { 200: obj("{ amountUsdc, txHash, explorerUrl }"), 503: err } } },
  "/yield/autopilot": { post: { summary: "Sweep idle treasury USDC (above YIELD_RESERVE_USDC) into the vault now — the background autopilot does the same every minute", security: bearer, responses: { 200: obj("{ deposited?, txHash?, treasuryUsdc, skipped? }"), 503: err } } },
  "/yield/position": { get: { summary: "Vault position and APY", security: bearer, parameters: [{ name: "fresh", in: "query", schema: { type: "string", enum: ["1"] } }], responses: { 200: obj("{ vaultId, dfTokens, underlyingUsdc, apy }") } } },
  "/agent/policy": {
    get: { summary: "Cap, used, remaining, rule id — read from the spending_limit policy contract", security: bearer, responses: { 200: obj("PolicyView") } },
    post: { summary: "Submit the passkey-signed cap change (built by /agent/policy/build)", security: bearer, requestBody: { required: true, content: json("XdrBody") }, responses: { 200: obj("{ ruleId, txHash, dailyCapUsdc?, weeklyCapUsdc?, rules? }") } },
  },
  "/onramp/instructions": { post: { summary: "The user's deposit details: anchor IBAN + the reference that routes a bank transfer to their treasury (a SEP-6 order, reused until paid into)", security: bearer, responses: { 200: obj("{ iban, bankName, reference, anchorTxId, minTry, maxTry }") } } },
  "/bank/transfer": { post: { summary: "Sandbox bank rail (public): pay amountTry to an IBAN with a reference — plays the bank for the mock anchor (pnpm bank)", requestBody: { required: true, content: json("BankTransferBody") }, responses: { 202: obj("{ reference, amountTry, status, anchorTxId }"), 404: err, 409: err } } },
  "/agent/rules/options": { post: { summary: "Propose a ruleset: returns a single-use WebAuthn challenge bound to it, to be signed by the passkey that owns the wallet", security: bearer, requestBody: { required: true, content: json("RulesBody") }, responses: { 200: obj("{ challenge, rpId, allowCredentials, rules }") } } },
  "/cli/token": { post: { summary: "Mint a separate session for the CLI (pnpm agent connect <token>); the passkey cannot be used from a terminal", security: bearer, responses: { 200: obj("{ token, expiresAt, connect }") } } },
  "/agent/rules": {
    get: { summary: "Router-enforced agent rules (weekly x402 limit, max price per call, allowed chains) + this week's spend", security: bearer, responses: { 200: obj("{ weeklyCapUsdc, maxPerCallUsdc, allowedNetworks, spentThisWeekUsdc, paymentsThisWeek, enforcedBy }") } },
    put: { summary: "Apply the ruleset approved by the owner's passkey: { challenge, assertion } from /agent/rules/options. Violations make POST /agent/pay answer 409 RULE_VIOLATION before anything is signed", security: bearer, requestBody: { required: true, content: json("RulesApprovalBody") }, responses: { 200: obj("{ weeklyCapUsdc, maxPerCallUsdc, allowedNetworks, spentThisWeekUsdc, paymentsThisWeek, enforcedBy }"), 400: err } },
  },
  "/agent/policy/build": { post: { summary: "Build a cap change for passkey signing: daily or weekly window. method=set_spending_limit → kit.wallet.fromJSON.execute, method=add_policy (weekly window on an older rule) → fromJSON.add_policy; then kit.signAdmin", security: bearer, requestBody: { required: true, content: json("CapBody") }, responses: { 200: obj("{ json, xdr, ruleId, window, method, dailyCapUsdc | weeklyCapUsdc }") } } },
  "/agent/authorize/build": { post: { summary: "Build add_context_rule (agent signer + spending_limit) for passkey signing", security: bearer, requestBody: { content: json("AuthorizeBuildBody") }, responses: { 200: obj("{ json, xdr, agentPublicKey, dailyCapUsdc, ruleName, smartAccountId }") } } },
  "/agent/sweep/build": { post: { summary: "Build add_context_rule for the treasury-sweep rule (server sweeper key, USDC SAC only, no policy) for passkey signing — accounts created before auto-sweep existed", security: bearer, responses: { 200: obj("{ json, xdr, ruleName, sweeperPublicKey, smartAccountId }") } } },
  "/agent/sweep": { post: { summary: "Submit the passkey-signed treasury-sweep rule; idle smart-account USDC then flows to the treasury and vault automatically", security: bearer, requestBody: { required: true, content: json("XdrBody") }, responses: { 200: obj("{ ruleId, txHash, explorerUrl }") } } },
  "/agent/authorize": { post: { summary: "Submit the passkey-signed rule transaction sponsored; records the rule id", security: bearer, requestBody: { required: true, content: json("XdrBody") }, responses: { 200: obj("{ ruleId, txHash, explorerUrl }") } } },
  "/stellar/submit": { post: { summary: "Sponsored submission of any passkey-signed transaction targeting the user's smart account", security: bearer, requestBody: { required: true, content: json("XdrBody") }, responses: { 200: obj("{ hash, explorerUrl, ledger }") } } },
  "/agent/pay": { post: { summary: "Pay a paywalled URL (x402): rules → approval threshold → on-chain cap → settlement; returns the paid body, tx hashes and the event timeline. Scope: pay", security: bearer, requestBody: { required: true, content: json("PayBodyV2") }, responses: { 200: obj("PayResult"), 403: err, 409: { description: "RULE_VIOLATION | SPENDING_CAP_EXCEEDED | APPROVAL_REQUIRED", content: json("Error") }, 502: err } } },
  "/agent/pay/over-cap-demo": { post: { summary: "Fund the smart account then attempt a top-up above the cap; returns the on-chain rejection", security: bearer, responses: { 200: obj("OverCapResult"), 409: err } } },
  "/evm/transfer": { post: { summary: "Gasless USDC transfer from the user's EVM wallet (Privy sponsorship or EIP-3009 relay)", security: bearer, requestBody: { required: true, content: json("EvmTransferBody") }, responses: { 200: obj("{ hash, explorerUrl, sponsored }") } } },
  "/agent/quote": { post: { summary: "Probe a paywalled URL without paying: offers (price/network/payee) and the rules' verdict (allow | requires_approval | denied). Scope: read", security: bearer, requestBody: { required: true, content: json("QuoteBody") }, responses: { 200: obj("Quote + verdict"), 403: err } } },
  "/agent/services": { get: { summary: "Paywalled endpoints the demo resource server advertises. Scope: read", security: bearer, responses: { 200: obj("{ resourceServer, endpoints[] }") } } },
  "/agent/tokens": {
    get: { summary: "List the user's agent tokens (owner session)", security: bearer, responses: { 200: obj("AgentToken[]"), 403: err } },
    post: { summary: "Mint a scoped, revocable agent token (pat_…) for an AI runtime; the secret is returned once (owner session)", security: bearer, requestBody: { required: true, content: json("CreateTokenBody") }, responses: { 201: obj("{ id, name, scopes, expiresAt, token }"), 403: err } },
  },
  "/agent/tokens/{id}": { delete: { summary: "Revoke an agent token (owner session)", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: obj("{ ok }"), 404: err } } },
  "/agent/connect/hermes": { post: { summary: "Mint a read+pay token and return the Hermes config snippet, env line, deep link and Claude Code command (owner session)", security: bearer, responses: { 200: obj("{ tokenId, scopes, expiresAt, mcpUrl, snippetYaml, envLine, deepLink, claudeCode, stdioShim, skill }") } } },
  "/approvals": { get: { summary: "Approvals for payments above the owner's threshold (?status=pending|approved|denied|expired|consumed)", security: bearer, parameters: [{ name: "status", in: "query", schema: { type: "string" } }], responses: { 200: obj("Approval[]") } } },
  "/approvals/{id}": { get: { summary: "One approval", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: obj("Approval"), 404: err } } },
  "/approvals/{id}/approve": { post: { summary: "Owner approves a pending payment (owner session); the agent retries with approval_id", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: obj("Approval"), 409: err } } },
  "/approvals/{id}/deny": { post: { summary: "Owner denies a pending payment (owner session)", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: obj("Approval"), 409: err } } },
  "/mcp": { post: { summary: "MCP server (Streamable HTTP, stateless, JSON responses). Bearer = agent token (pat_…) or passkey session. Tools: wallet_info, get_balances, get_spending_policy, list_services, quote_payment, pay_url, list_payments, request_funding — filtered by the token's scopes", security: bearer, requestBody: { required: true, content: { "application/json": { schema: { type: "object", description: "JSON-RPC 2.0 request (initialize, tools/list, tools/call)" } } } }, responses: { 200: obj("JSON-RPC 2.0 response"), 401: err, 403: err } } },
  "/events": { get: { summary: "User's last 200 events, newest first", security: bearer, responses: { 200: { description: "Events", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Event" } } } } } } } },
  "/events/stream": { get: { summary: "Server-Sent Events feed for the user (?token= accepted)", security: bearer, parameters: [{ name: "token", in: "query", schema: { type: "string" } }], responses: { 200: { description: "text/event-stream" } } } },
  "/admin/events": { get: { summary: "All users' events (admin bearer)", security: bearer, responses: { 200: obj("Event[]"), 403: err } } },
};

const doc = {
  openapi: "3.0.3",
  info: { title: "Pera Agent Wallet API", version: "0.1.0", description: "Multi-user REST + MCP API for the Pera dashboard and for AI agents. Auth: passkey (WebAuthn) → owner session `ps_…` (everything); scoped agent tokens `pat_…` (scopes read | pay | fund | admin) for AI runtimes; the static API_BEARER_TOKEN is the admin credential. All amounts are decimal USDC strings; every mutation returns tx hashes and emits a per-user event." },
  servers: [{ url: "http://localhost:3000" }],
  components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } }, schemas },
  paths,
};
const out = path.join(repoRoot(), "openapi.yaml");
writeFileSync(out, stringify(doc));
console.log(`wrote ${out}`);
