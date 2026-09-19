/**
 * MCP end-to-end: what Hermes / Claude / Cursor do against the running API.
 *   pnpm smoke:mcp            (needs pnpm dev:api + dev:rs and a logged-in device: PERA_HOME/session.json with a ps_ token)
 * Runs: tools/list → wallet_info → get_spending_policy → quote_payment → pay_url (Stellar paywall) → list_payments →
 * approval round-trip (threshold on → requires_approval → owner approves → paid with approval_id) → scope denial → stdio shim.
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadEnv, repoRoot } from "@pera/core";
import { say } from "./lib/steps";

const env = loadEnv();
const api = env.PUBLIC_API_URL.replace(/\/$/, "");
if (!env.RESOURCE_SERVER_URL) throw new Error("RESOURCE_SERVER_URL is required for this script (start the demo resource server: pnpm dev:rs)");
const rs = env.RESOURCE_SERVER_URL.replace(/\/$/, "");
const sessionFile = path.join(process.env.PERA_HOME ?? path.join(os.homedir(), ".pera"), "session.json");
if (!existsSync(sessionFile)) throw new Error(`no device session at ${sessionFile}; run \`pnpm agent register\` or \`pnpm agent login\` first`);
const session = (JSON.parse(readFileSync(sessionFile, "utf8")) as { token: string }).token;
if (!session.startsWith("ps_")) throw new Error("the device session must be a passkey session (ps_…) to mint agent tokens");

const rest = async <T>(method: string, p: string, body?: unknown, token = session): Promise<T> => {
  const res = await fetch(`${api}${p}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
  const json = (await res.json()) as T & { error?: string; code?: string };
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${json.code ?? ""} ${json.error ?? ""}`);
  return json;
};
const client = async (token: string) => {
  const c = new Client({ name: "pera-mcp-smoke", version: "0.1.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${api}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return c;
};
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => {
  const r = (await c.callTool({ name, arguments: args })) as { isError?: boolean; structuredContent?: Record<string, unknown>; content?: Array<{ text?: string }> };
  return { ...r, data: r.structuredContent ?? {}, text: r.content?.[0]?.text ?? "" };
};
const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
};

say("1/8 mint agent tokens (read+pay, read-only)");
const full = await rest<{ id: string; token: string; scopes: string[] }>("POST", "/agent/tokens", { name: "smoke-full", scopes: ["read", "pay"] });
const ro = await rest<{ id: string; token: string }>("POST", "/agent/tokens", { name: "smoke-ro", scopes: ["read"] });
console.log(`  full ${full.token.slice(0, 12)}… scopes ${full.scopes.join(",")}; ro ${ro.token.slice(0, 12)}…`);

say("2/8 tools/list + wallet_info + policy");
const c = await client(full.token);
const tools = (await c.listTools()).tools.map((t) => t.name);
console.log(`  tools: ${tools.join(", ")}`);
assert(tools.includes("pay_url") && tools.includes("quote_payment") && !tools.includes("request_funding"), "read+pay token must list pay_url but not request_funding");
const info = await call(c, "wallet_info");
assert(!info.isError, `wallet_info: ${info.text}`);
console.log(`  ${info.text}`);
const policy = await call(c, "get_spending_policy");
assert(!policy.isError, `get_spending_policy: ${policy.text}`);
console.log(`  ${policy.text}`);

say("3/8 quote_payment (never pays)");
const q = await call(c, "quote_payment", { url: `${rs}/api/stellar/weather` });
assert(!q.isError, `quote: ${q.text}`);
console.log(`  ${q.text}`);
assert((q.data.verdict as { verdict: string }).verdict === "allow", "quote verdict should be allow");

say("4/8 pay_url (Stellar paywall)");
const paid = await call(c, "pay_url", { url: `${rs}/api/stellar/weather`, max_amount_usdc: "0.05" });
assert(!paid.isError && paid.data.status === "paid" && paid.data.txHash, `pay_url: ${paid.text}`);
console.log(`  ${paid.text}`);

say("5/8 list_payments");
const hist = await call(c, "list_payments", { limit: 5 });
assert(!hist.isError, hist.text);
const evs = hist.data.events as Array<{ type: string; txHash?: string }>;
assert(evs.some((e) => e.type === "x402.paid" && e.txHash === paid.data.txHash), "list_payments should contain the payment just made");
console.log(`  ${hist.text}`);

say("6/8 approval round-trip (threshold 0.005 USDC → requires_approval → owner approves → paid)");
const rulesBefore = await rest<{ approveAboveUsdc: string | null; weeklyCapUsdc: string | null; maxPerCallUsdc: string | null; allowedNetworks: string[] }>("GET", "/agent/rules");
await rest("PUT", "/agent/rules", { weeklyCapUsdc: rulesBefore.weeklyCapUsdc, maxPerCallUsdc: rulesBefore.maxPerCallUsdc, allowedNetworks: rulesBefore.allowedNetworks, approveAboveUsdc: "0.005" });
try {
  const need = await call(c, "pay_url", { url: `${rs}/api/any/quote` });
  assert(!need.isError && need.data.status === "requires_approval" && need.data.approvalId, `expected requires_approval, got ${need.text}`);
  console.log(`  ${need.text}`);
  const again = await call(c, "pay_url", { url: `${rs}/api/any/quote` });
  assert(again.data.approvalId === need.data.approvalId, "pending approval should be reused, not duplicated");
  const approvedList = await rest<Array<{ id: string; status: string }>>("GET", "/approvals?status=pending");
  assert(approvedList.some((a) => a.id === need.data.approvalId), "owner should see the pending approval");
  await rest("POST", `/approvals/${need.data.approvalId}/approve`);
  const done = await call(c, "pay_url", { url: `${rs}/api/any/quote`, approval_id: need.data.approvalId });
  assert(!done.isError && done.data.status === "paid", `paid with approval: ${done.text}`);
  console.log(`  ${done.text}`);
  const reuse = await call(c, "pay_url", { url: `${rs}/api/any/quote`, approval_id: need.data.approvalId });
  assert(reuse.isError && reuse.data.rule === "approval", `a consumed approval must not be reusable: ${reuse.text}`);
  console.log(`  consumed approval correctly refused: ${reuse.data.message}`);
} finally {
  await rest("PUT", "/agent/rules", { ...rulesBefore, approveAboveUsdc: rulesBefore.approveAboveUsdc ?? null });
}

say("7/8 scope denial (read-only token)");
const cro = await client(ro.token);
const roTools = (await cro.listTools()).tools.map((t) => t.name);
assert(!roTools.includes("pay_url"), "read-only token must not list pay_url");
const denied = await call(cro, "pay_url", { url: `${rs}/api/stellar/weather` }).catch((e: Error) => ({ isError: true, text: e.message, data: {} as Record<string, unknown> }));
assert(denied.isError, "read-only token must not be able to pay");
console.log(`  denied as expected: ${denied.text.slice(0, 120)}`);
const owner = await rest("PUT", "/agent/rules", rulesBefore, full.token).catch((e: Error) => e.message);
assert(typeof owner === "string" && /403|OWNER_ONLY/.test(owner), "agent token must not change rules");
console.log(`  agent token cannot change rules: ${(owner as string).slice(0, 80)}`);

say("8/8 stdio shim (npx @pera/mcp equivalent)");
const shim = path.join(repoRoot(), "apps/mcp-shim/src/index.ts");
const cs = new Client({ name: "pera-mcp-smoke-stdio", version: "0.1.0" });
await cs.connect(new StdioClientTransport({ command: "node", args: ["--import", "tsx", shim], env: { ...process.env, PERA_API_URL: api, PERA_AGENT_TOKEN: full.token } as Record<string, string>, stderr: "pipe" }));
const shimTools = (await cs.listTools()).tools.map((t) => t.name);
assert(shimTools.join() === tools.join(), `shim tools differ: ${shimTools.join(",")}`);
const shimInfo = await call(cs, "get_balances");
assert(!shimInfo.isError, shimInfo.text);
console.log(`  shim ok: ${shimInfo.text}`);
await cs.close();
await c.close();
await cro.close();

await rest("DELETE", `/agent/tokens/${full.id}`);
await rest("DELETE", `/agent/tokens/${ro.id}`);
console.log("\n✔ MCP smoke passed");
