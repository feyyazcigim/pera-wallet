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
  "/status": { get: { summary: "Network, smart account, vault, agent, cap, Base Sepolia sponsor", security: [], responses: { 200: obj("Status") } } },
  "/balances": { get: { summary: "Owner, float, smart account, vault position, Base USDC", security: bearer, responses: { 200: obj("Balances"), 401: err } } },
  "/onramp": { post: { summary: "Start a SEP-6 TRY deposit and simulate the bank wire", security: bearer, requestBody: { required: true, content: json("OnrampBody") }, responses: { 202: obj("{ anchorTxId, status, instructions }"), 400: err } } },
  "/onramp/{id}": { get: { summary: "Anchor transaction status passthrough", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: obj("Anchor transaction") } } },
  "/offramp": { post: { summary: "SEP-6 withdraw: USDC → TRY (withdraws from the vault if needed)", security: bearer, requestBody: { required: true, content: json("OfframpBody") }, responses: { 200: obj("{ anchorTxId, stellarTxHash, status, amountTry }"), 400: err } } },
  "/yield/deposit": { post: { summary: "Manual vault deposit", security: bearer, requestBody: { required: true, content: json("AmountBody") }, responses: { 200: obj("{ amountUsdc, txHash, explorerUrl }"), 503: err } } },
  "/yield/withdraw": { post: { summary: "Manual vault withdraw", security: bearer, requestBody: { required: true, content: json("AmountBody") }, responses: { 200: obj("{ amountUsdc, txHash, explorerUrl }"), 503: err } } },
  "/yield/position": { get: { summary: "Vault position and APY", security: bearer, parameters: [{ name: "fresh", in: "query", schema: { type: "string", enum: ["1"] } }], responses: { 200: obj("{ vaultId, dfTokens, underlyingUsdc, apy }") } } },
  "/agent/policy": {
    get: { summary: "Cap, period, used, remaining, rule id (read from the policy contract)", security: bearer, responses: { 200: obj("PolicyView") } },
    post: { summary: "Owner updates the daily cap", security: bearer, requestBody: { required: true, content: json("PolicyBody") }, responses: { 200: obj("{ ruleId, txHash, method }") } },
  },
  "/agent/pay": { post: { summary: "Run the x402 router for a URL; returns the paid body and the event timeline", security: bearer, requestBody: { required: true, content: json("PayBody") }, responses: { 200: obj("PayResult"), 409: err, 502: err } } },
  "/agent/pay/over-cap-demo": { post: { summary: "Attempt a top-up above the cap; returns the on-chain rejection", security: bearer, responses: { 200: obj("OverCapResult") } } },
  "/events": { get: { summary: "Last 200 events, newest first", security: bearer, responses: { 200: { description: "Events", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Event" } } } } } } } },
  "/events/stream": { get: { summary: "Server-Sent Events feed (?token= accepted)", security: bearer, parameters: [{ name: "token", in: "query", schema: { type: "string" } }], responses: { 200: { description: "text/event-stream" } } } },
};

const doc = {
  openapi: "3.0.3",
  info: { title: "Pera Agent Wallet API", version: "0.1.0", description: "REST API consumed by the Pera dashboard. All amounts are decimal USDC strings; every mutation returns tx hashes and emits an event." },
  servers: [{ url: "http://localhost:3000" }],
  components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } }, schemas },
  paths,
};
const out = path.join(repoRoot(), "openapi.yaml");
writeFileSync(out, stringify(doc));
console.log(`wrote ${out}`);
