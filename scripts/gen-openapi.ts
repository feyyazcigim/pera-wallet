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
  "/yield/position": { get: { summary: "Vault position and APY", security: bearer, parameters: [{ name: "fresh", in: "query", schema: { type: "string", enum: ["1"] } }], responses: { 200: obj("{ vaultId, dfTokens, underlyingUsdc, apy }") } } },
  "/agent/policy": {
    get: { summary: "Cap, used, remaining, rule id — read from the spending_limit policy contract", security: bearer, responses: { 200: obj("PolicyView") } },
    post: { summary: "Submit the passkey-signed cap change (built by /agent/policy/build)", security: bearer, requestBody: { required: true, content: json("XdrBody") }, responses: { 200: obj("{ ruleId, txHash, dailyCapUsdc }") } },
  },
  "/agent/policy/build": { post: { summary: "Build set_spending_limit for passkey signing (kit.wallet.fromJSON.execute → kit.signAdmin)", security: bearer, requestBody: { required: true, content: json("PolicyBody") }, responses: { 200: obj("{ json, xdr, ruleId, dailyCapUsdc }") } } },
  "/agent/authorize/build": { post: { summary: "Build add_context_rule (agent signer + spending_limit) for passkey signing", security: bearer, requestBody: { content: json("AuthorizeBuildBody") }, responses: { 200: obj("{ json, xdr, agentPublicKey, dailyCapUsdc, ruleName, smartAccountId }") } } },
  "/agent/authorize": { post: { summary: "Submit the passkey-signed rule transaction sponsored; records the rule id", security: bearer, requestBody: { required: true, content: json("XdrBody") }, responses: { 200: obj("{ ruleId, txHash, explorerUrl }") } } },
  "/stellar/submit": { post: { summary: "Sponsored submission of any passkey-signed transaction targeting the user's smart account", security: bearer, requestBody: { required: true, content: json("XdrBody") }, responses: { 200: obj("{ hash, explorerUrl, ledger }") } } },
  "/agent/pay": { post: { summary: "Run the x402 router for a URL; returns the paid body, tx hashes and the event timeline", security: bearer, requestBody: { required: true, content: json("PayBody") }, responses: { 200: obj("PayResult"), 409: err, 502: err } } },
  "/agent/pay/over-cap-demo": { post: { summary: "Fund the smart account then attempt a top-up above the cap; returns the on-chain rejection", security: bearer, responses: { 200: obj("OverCapResult"), 409: err } } },
  "/evm/transfer": { post: { summary: "Gasless USDC transfer from the user's EVM wallet (Privy sponsorship or EIP-3009 relay)", security: bearer, requestBody: { required: true, content: json("EvmTransferBody") }, responses: { 200: obj("{ hash, explorerUrl, sponsored }") } } },
  "/events": { get: { summary: "User's last 200 events, newest first", security: bearer, responses: { 200: { description: "Events", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Event" } } } } } } } },
  "/events/stream": { get: { summary: "Server-Sent Events feed for the user (?token= accepted)", security: bearer, parameters: [{ name: "token", in: "query", schema: { type: "string" } }], responses: { 200: { description: "text/event-stream" } } } },
  "/admin/events": { get: { summary: "All users' events (admin bearer)", security: bearer, responses: { 200: obj("Event[]"), 403: err } } },
};

const doc = {
  openapi: "3.0.3",
  info: { title: "Pera Agent Wallet API", version: "0.1.0", description: "Multi-user REST API for the Pera dashboard. Auth: passkey (WebAuthn) → session bearer `ps_…`; the static API_BEARER_TOKEN is the admin credential. All amounts are decimal USDC strings; every mutation returns tx hashes and emits a per-user event." },
  servers: [{ url: "http://localhost:3000" }],
  components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } }, schemas },
  paths,
};
const out = path.join(repoRoot(), "openapi.yaml");
writeFileSync(out, stringify(doc));
console.log(`wrote ${out}`);
