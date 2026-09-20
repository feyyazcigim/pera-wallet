import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BASE_SEPOLIA_CAIP2, getBalances, getContractUsdcBalance, loadEnv, STELLAR_CAIP2, stellarAccountUrl, stellarContractUrl, baseAddressUrl } from "@pera/core";
import { listAgentTokens, listEvents, type AgentScope, type User } from "@pera/db";
import { getBaseUsdcBalance } from "@pera/evm";
import { getPolicyUsage } from "@pera/smart-account";
import { getPosition, isConfigured } from "@pera/yield";
import { ApprovalRequiredError, PaywallError, RuleViolationError } from "@pera/x402-router";
import { SpendingCapExceededError } from "@pera/smart-account";
import { loadContext } from "../context";
import { executePayment, listServices, quotePayment, rulesView } from "../services/payments";

const DecimalUsdc = z.string().regex(/^\d+(\.\d{1,7})?$/).describe("decimal USDC amount, e.g. \"0.25\"");
const Network = z.enum(["stellar:testnet", "eip155:84532"]);

export interface McpPrincipal {
  user: User;
  scopes: AgentScope[];
  isOwnerSession: boolean;
  tokenId?: string;
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

// The text block carries the data too: MCP clients (Hermes included) hand the model `content`, not `structuredContent`,
// so a pay_url result with the paid body only in structuredContent reads as "paid, no data".
const ok = (summary: string, data: Record<string, unknown>): ToolResult => ({ content: [{ type: "text", text: `${summary}\n${JSON.stringify(data)}` }], structuredContent: data });
const fail = (code: string, message: string, data: Record<string, unknown> = {}): ToolResult => ({ content: [{ type: "text", text: `${code}: ${message}` }], structuredContent: { error: code, message, ...data }, isError: true });

function truncate(body: unknown, max = 8_000): unknown {
  if (typeof body === "string") return body.length > max ? `${body.slice(0, max)}… [truncated ${body.length - max} chars]` : body;
  const s = JSON.stringify(body);
  return s && s.length > max ? `${s.slice(0, max)}… [truncated]` : body;
}

/** Maps pipeline errors to structured, non-throwing tool results the model can reason about. */
function toolError(err: unknown): ToolResult {
  if (err instanceof ApprovalRequiredError) {
    return ok(`Payment of ${err.amountUsdc} USDC needs the owner's approval. Ask them to open ${err.approveUrl}; retry with approval_id="${err.approvalId}" once approved (expires ${err.expiresAt}).`, {
      status: "requires_approval",
      approvalId: err.approvalId,
      approveUrl: err.approveUrl,
      amountUsdc: err.amountUsdc,
      network: err.network,
      url: err.url,
      expiresAt: err.expiresAt,
    });
  }
  if (err instanceof RuleViolationError) return fail("RULE_VIOLATION", err.message, { status: "denied", rule: err.rule, ...err.detail });
  if (err instanceof SpendingCapExceededError) return fail("SPENDING_CAP_EXCEEDED", err.message, { status: "denied", rule: "onchain_daily_cap", attemptedUsdc: err.attemptedUsdc, dailyCapUsdc: err.dailyCapUsdc, errorCode: err.code });
  if (err instanceof PaywallError) return fail("PAYWALL_ERROR", err.message, { httpStatus: err.status, body: truncate(err.body, 2000) });
  const e = err as Error & { code?: string; statusCode?: number };
  return fail(typeof e.code === "string" ? e.code : "ERROR", e.message ?? String(err));
}

/** One McpServer per request (stateless transport), bound to the authenticated user and their token scopes. */
export function buildMcpServer(principal: McpPrincipal): McpServer {
  const env = loadEnv();
  const server = new McpServer({ name: "pera-wallet", version: "0.3.0" }, { instructions: INSTRUCTIONS });
  const userId = principal.user.id;
  const has = (scope: AgentScope) => principal.isOwnerSession || principal.scopes.includes(scope);
  const guard = (scope: AgentScope) => (has(scope) ? null : fail("INSUFFICIENT_SCOPE", `this agent token lacks the "${scope}" scope; the owner can mint one with it in the dashboard`, { scope }));

  const reg = (scope: AgentScope, fn: () => void) => {
    if (has(scope)) fn();
  };

  reg("read", () => server.registerTool(
    "wallet_info",
    {
      title: "Wallet overview",
      description: "The user's Pera wallet: smart account, treasury/agent addresses, networks, on-chain daily cap usage, owner rules and what this token may do. Call this first.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const denied = guard("read");
      if (denied) return denied;
      try {
        const ctx = await loadContext(userId);
        const [policy, rules, tokens] = await Promise.all([getPolicyUsage(ctx).catch(() => null), rulesView(userId), principal.isOwnerSession ? Promise.resolve([]) : listAgentTokens(userId)]);
        const me = tokens.find((t) => t.id === principal.tokenId);
        return ok(`Pera wallet of ${principal.user.displayName}: smart account ${ctx.smartAccountId} (cap ${policy?.dailyCapUsdc ?? ctx.dailyCapUsdc} USDC/day, remaining ${policy?.remainingUsdc ?? "?"}), EVM ${ctx.evmWallet?.address ?? "none"}. Token scopes: ${principal.scopes.join(", ")}.`, {
          user: { id: userId, displayName: principal.user.displayName },
          stellar: { network: STELLAR_CAIP2, smartAccountId: ctx.smartAccountId, smartAccountUrl: stellarContractUrl(ctx.smartAccountId), treasury: ctx.treasuryPub, agentFloat: ctx.agentPub, agentFloatUrl: stellarAccountUrl(ctx.agentPub) },
          evm: ctx.evmWallet ? { network: BASE_SEPOLIA_CAIP2, address: ctx.evmWallet.address, explorerUrl: baseAddressUrl(ctx.evmWallet.address), provider: "privy", gasSponsored: true } : null,
          onchainDailyCap: policy ? { dailyCapUsdc: policy.dailyCapUsdc, usedInWindowUsdc: policy.usedInWindowUsdc, remainingUsdc: policy.remainingUsdc, window: policy.windowLabel, authorised: policy.authorised, policyContract: policy.policyContract } : null,
          rules,
          token: me ? { name: me.name, scopes: me.scopes, expiresAt: me.expiresAt } : { scopes: principal.scopes },
          resourceServer: env.RESOURCE_SERVER_URL ?? null,
        });
      } catch (err) {
        return toolError(err);
      }
    },
  ));

  reg("read", () => server.registerTool(
    "get_balances",
    { title: "Balances", description: "USDC balances: treasury, agent float, smart account, DeFindex vault position, Base Sepolia wallet.", inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: false } },
    async () => {
      const denied = guard("read");
      if (denied) return denied;
      try {
        const ctx = await loadContext(userId);
        const [treasury, float, smart, position, base] = await Promise.all([
          getBalances(ctx.treasuryPub),
          getBalances(ctx.agentPub),
          getContractUsdcBalance(ctx.smartAccountId),
          isConfigured() && env.VAULT_ID ? getPosition(ctx).catch(() => null) : Promise.resolve(null),
          ctx.evmWallet ? getBaseUsdcBalance(ctx.evmWallet.address).catch(() => null) : Promise.resolve(null),
        ]);
        const data = {
          treasuryUsdc: treasury.usdc,
          agentFloatUsdc: float.usdc,
          smartAccountUsdc: smart,
          vaultUsdc: position?.underlyingUsdc ?? null,
          baseUsdc: base,
          at: new Date().toISOString(),
        };
        return ok(`treasury ${data.treasuryUsdc} · float ${data.agentFloatUsdc} · smart account ${data.smartAccountUsdc} · vault ${data.vaultUsdc ?? "n/a"} · Base ${data.baseUsdc ?? "n/a"} USDC`, data);
      } catch (err) {
        return toolError(err);
      }
    },
  ));

  reg("read", () => server.registerTool(
    "get_spending_policy",
    { title: "Spending policy", description: "What the agent is allowed to spend: on-chain daily cap (enforced by the smart account's policy contract), owner rules (weekly limit, max per call, allowed networks, approval threshold) and this week's usage.", inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: false } },
    async () => {
      const denied = guard("read");
      if (denied) return denied;
      try {
        const ctx = await loadContext(userId);
        const [policy, rules] = await Promise.all([getPolicyUsage(ctx).catch(() => null), rulesView(userId)]);
        return ok(`on-chain cap ${policy?.dailyCapUsdc ?? "?"} USDC/day (remaining ${policy?.remainingUsdc ?? "?"}); rules: weekly ${rules.weeklyCapUsdc ?? "none"}, per call ${rules.maxPerCallUsdc ?? "none"}, networks ${rules.allowedNetworks.join("/")}, approval above ${rules.approveAboveUsdc ?? "never"}; spent this week ${rules.spentThisWeekUsdc}`, { onchain: policy, rules });
      } catch (err) {
        return toolError(err);
      }
    },
  ));

  reg("read", () => server.registerTool(
    "list_services",
    { title: "Paid services", description: "Paywalled endpoints the demo resource server advertises (URL, description, accepted networks/prices). Use quote_payment on one before paying.", inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: true } },
    async () => {
      const denied = guard("read");
      if (denied) return denied;
      try {
        const s = await listServices();
        return ok(`${s.endpoints.length} paid endpoint(s) at ${s.resourceServer}`, s);
      } catch (err) {
        return toolError(err);
      }
    },
  ));

  const requestShape = {
    url: z.string().url().describe("absolute http(s) URL of the resource (usually returns HTTP 402)"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET").describe("HTTP method (default GET)"),
    headers: z.record(z.string(), z.string()).optional().describe("extra request headers (never put secrets here)"),
    body: z.string().optional().describe("request body for POST/PUT/PATCH"),
    prefer: z.enum(["auto", "stellar", "evm"]).default("auto").describe("network preference when the paywall accepts several; auto = Stellar first"),
  };

  reg("read", () => server.registerTool(
    "quote_payment",
    {
      title: "Quote a paywall",
      description: "Probe a URL WITHOUT paying: returns the price, network and payee the paywall asks for, plus the verdict the owner's rules would give (allow | requires_approval | denied). Always quote before pay_url when the price is unknown.",
      inputSchema: { ...requestShape, max_amount_usdc: DecimalUsdc.optional().describe("your own ceiling for this call") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const denied = guard("read");
      if (denied) return denied;
      try {
        const q = await quotePayment(userId, { url: args.url, method: args.method, headers: args.headers, body: args.body, prefer: args.prefer, maxAmountUsdc: args.max_amount_usdc });
        const summary = q.paywalled ? `${q.url} costs ${q.offers.map((o) => `${o.amountUsdc} USDC on ${o.network}`).join(" or ")} → ${q.verdict.verdict}${"reason" in q.verdict ? ` (${q.verdict.reason})` : ""}` : `${q.url} is free (HTTP ${q.status})`;
        return ok(summary, { ...q, body: truncate(q.body) });
      } catch (err) {
        return toolError(err);
      }
    },
  ));

  reg("pay", () => server.registerTool(
    "pay_url",
    {
      title: "Pay a paywall and fetch the resource",
      description: "Fetch a URL and, if it answers HTTP 402 (x402), pay it from the user's wallet and return the paid response. Payment goes through the owner's rules, the approval threshold and the smart account's on-chain daily cap; a refused payment returns status \"denied\" or \"requires_approval\" (then ask the human to approve at approveUrl and retry with approval_id). Cite txHash/explorerUrl from the receipt.",
      inputSchema: {
        ...requestShape,
        max_amount_usdc: DecimalUsdc.optional().describe("refuse to pay more than this for this call"),
        approval_id: z.string().optional().describe("id of an approval the owner granted for this exact url and amount"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) => {
      const denied = guard("pay");
      if (denied) return denied;
      try {
        const r = await executePayment(userId, { url: args.url, method: args.method, headers: args.headers, body: args.body, prefer: args.prefer, maxAmountUsdc: args.max_amount_usdc, approvalId: args.approval_id });
        const receipt = {
          status: r.paid ? "paid" : "free",
          url: r.url,
          httpStatus: r.status,
          network: r.network ?? null,
          amountUsdc: r.amountUsdc ?? null,
          payTo: r.payTo ?? null,
          payer: r.payer ?? null,
          txHash: r.txHash ?? null,
          explorerUrl: r.explorerUrl ?? null,
          float: r.float ?? null,
          bridged: r.bridged ?? null,
          body: truncate(r.body),
        };
        return ok(r.paid ? `Paid ${r.amountUsdc} USDC on ${r.network} for ${r.url} — tx ${r.txHash} (${r.explorerUrl})` : `${r.url} was free (HTTP ${r.status})`, receipt);
      } catch (err) {
        return toolError(err);
      }
    },
  ));

  reg("read", () => server.registerTool(
    "list_payments",
    { title: "Payment history", description: "Recent x402 payments and refusals for this wallet (newest first), with tx hashes.", inputSchema: { limit: z.number().int().min(1).max(200).default(20) }, annotations: { readOnlyHint: true, openWorldHint: false } },
    async ({ limit }) => {
      const denied = guard("read");
      if (denied) return denied;
      try {
        const all = await listEvents({ userId, limit: 500 });
        const wanted = new Set(["x402.paid", "x402.rejected", "x402.402", "float.topup", "float.topup.rejected", "approval.requested", "approval.resolved", "bridge.minted"]);
        const items = all.filter((e) => wanted.has(e.type)).slice(0, limit);
        return ok(`${items.length} payment event(s)`, { events: items });
      } catch (err) {
        return toolError(err);
      }
    },
  ));

  void Network;
  return server;
}

const INSTRUCTIONS = `Pera is the user's crypto wallet on Stellar (+ Base Sepolia) with an AI-agent allowance. Money is real testnet USDC.
Rules of engagement: (1) call wallet_info once per session; (2) never guess prices — quote_payment first when the price is unknown;
(3) pay_url pays only within the owner's rules and the on-chain daily cap; if it returns status=requires_approval, tell the human to open approveUrl, then retry with approval_id;
(4) if status=denied, do not retry with the same arguments — report the reason; (5) cite txHash and explorerUrl for every payment;
(6) the agent cannot fund the wallet or change its rules: only the owner can, from the dashboard. Amounts are decimal USDC strings.`;
