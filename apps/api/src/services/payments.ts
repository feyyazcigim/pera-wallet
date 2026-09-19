/**
 * The agent-facing payment pipeline shared by the REST routes and the MCP tools:
 * quote (probe a URL, never pay) and pay (rules → approval threshold → on-chain cap → x402 settlement).
 */
import { addUsdc, cmpUsdc, events, loadEnv, type Caip2Network } from "@pera/core";
import { consumeApproval, getAgentRules, getApproval, listPaidAmountsSince, requestApproval, type AgentRules } from "@pera/db";
import { getPolicyUsage } from "@pera/smart-account";
import { ApprovalRequiredError, payFor, quoteFor, RuleViolationError, type Offer, type PayResult, type Quote } from "@pera/x402-router";
import { loadContext, type ApiUserContext } from "../context";

const WEEK_MS = 7 * 24 * 3600_000;

export interface RulesView extends AgentRules {
  spentThisWeekUsdc: string;
  paymentsThisWeek: number;
  enforcedBy: "router";
}

export async function rulesView(userId: string): Promise<RulesView> {
  const rules = await getAgentRules(userId);
  const paid = await listPaidAmountsSince(userId, new Date(Date.now() - WEEK_MS).toISOString());
  return { ...rules, spentThisWeekUsdc: paid.reduce((a, x) => addUsdc(a, x), "0"), paymentsThisWeek: paid.length, enforcedBy: "router" };
}

export interface PayRequest {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
  prefer?: "auto" | "stellar" | "evm";
  /** Extra ceiling the caller (agent) sets for this call. */
  maxAmountUsdc?: string;
  /** Id of an approved approval for this url+amount. */
  approvalId?: string;
}

const FORBIDDEN_HEADERS = new Set(["payment-signature", "x-payment", "host", "authorization", "cookie", "content-length"]);

function initOf(p: PayRequest): RequestInit | undefined {
  if (!p.method && !p.headers && p.body === undefined) return undefined;
  const headers = Object.fromEntries(Object.entries(p.headers ?? {}).filter(([k]) => !FORBIDDEN_HEADERS.has(k.toLowerCase())));
  const method = p.method ?? "GET";
  return { method, headers, body: method === "GET" || method === "DELETE" ? undefined : p.body };
}

export type Verdict =
  | { verdict: "allow"; warnings: string[] }
  | { verdict: "denied"; rule: string; reason: string; warnings: string[] }
  | { verdict: "requires_approval"; reason: string; warnings: string[] };

/** Evaluates the caller's ceiling, the owner's rules, the approval threshold and (advisory) the on-chain cap for one offer. */
export async function evaluateOffer(ctx: ApiUserContext, rules: RulesView, offer: Offer, p: Pick<PayRequest, "url" | "maxAmountUsdc" | "approvalId">): Promise<Verdict> {
  const warnings: string[] = [];
  if (p.maxAmountUsdc && cmpUsdc(offer.amountUsdc, p.maxAmountUsdc) > 0) return { verdict: "denied", rule: "max_amount", reason: `price ${offer.amountUsdc} USDC exceeds the max_amount_usdc ${p.maxAmountUsdc} set for this call`, warnings };
  if (rules.maxPerCallUsdc && cmpUsdc(offer.amountUsdc, rules.maxPerCallUsdc) > 0) return { verdict: "denied", rule: "max_per_call", reason: `this call costs ${offer.amountUsdc} USDC; the owner's max per call is ${rules.maxPerCallUsdc} USDC`, warnings };
  if (rules.weeklyCapUsdc && cmpUsdc(addUsdc(rules.spentThisWeekUsdc, offer.amountUsdc), rules.weeklyCapUsdc) > 0) return { verdict: "denied", rule: "weekly_limit", reason: `this payment would take the week to ${addUsdc(rules.spentThisWeekUsdc, offer.amountUsdc)} USDC; the owner's weekly limit is ${rules.weeklyCapUsdc} USDC`, warnings };
  if (offer.network === "stellar:testnet") {
    const policy = await getPolicyUsage(ctx).catch(() => null);
    if (policy?.authorised && cmpUsdc(offer.amountUsdc, policy.remainingUsdc) > 0) {
      warnings.push(`price ${offer.amountUsdc} USDC exceeds the remaining on-chain daily cap (${policy.remainingUsdc} USDC): the float top-up would be rejected by the policy contract (#3221) unless the float already holds enough`);
    }
  }
  if (rules.approveAboveUsdc && cmpUsdc(offer.amountUsdc, rules.approveAboveUsdc) > 0) {
    if (p.approvalId) {
      const a = await getApproval(ctx.userId, p.approvalId);
      if (a && a.status === "approved" && a.url === p.url && a.amountUsdc === offer.amountUsdc) return { verdict: "allow", warnings };
      return { verdict: "denied", rule: "approval", reason: `approval ${p.approvalId} is missing, not approved, expired, consumed, or for a different url/amount`, warnings };
    }
    return { verdict: "requires_approval", reason: `price ${offer.amountUsdc} USDC is above the owner's approval threshold (${rules.approveAboveUsdc} USDC)`, warnings };
  }
  return { verdict: "allow", warnings };
}

export interface QuoteResult extends Quote {
  verdict: Verdict;
  rules: { maxPerCallUsdc: string | null; weeklyCapUsdc: string | null; spentThisWeekUsdc: string; allowedNetworks: string[]; approveAboveUsdc: string | null };
}

export async function quotePayment(userId: string, p: PayRequest): Promise<QuoteResult> {
  const ctx = await loadContext(userId);
  const rules = await rulesView(userId);
  const q = await quoteFor(ctx, p.url, { prefer: p.prefer, init: initOf(p), allowedNetworks: rules.allowedNetworks });
  const { paymentRequired: _pr, probeBody: _pb, ...quote } = q;
  let verdict: Verdict = { verdict: "allow", warnings: [] };
  if (q.paywalled) {
    if (!q.offer) verdict = { verdict: "denied", rule: "allowed_chains", reason: `this paywall only accepts ${q.excludedNetworks.join(", ")}, which the owner's rules do not allow`, warnings: [] };
    else verdict = await evaluateOffer(ctx, rules, q.offer, p);
  }
  return {
    ...quote,
    offer: undefined,
    verdict,
    rules: { maxPerCallUsdc: rules.maxPerCallUsdc, weeklyCapUsdc: rules.weeklyCapUsdc, spentThisWeekUsdc: rules.spentThisWeekUsdc, allowedNetworks: rules.allowedNetworks, approveAboveUsdc: rules.approveAboveUsdc ?? null },
  };
}

export function approveUrlFor(approvalId: string): string {
  const env = loadEnv();
  const origin = env.PASSKEY_ORIGINS.split(",")[0]?.trim() || env.PUBLIC_API_URL;
  return `${origin.replace(/\/$/, "")}/approvals/${approvalId}`;
}

/**
 * Pays `url` for the user. Order of checks (all before anything is signed): allowed chains → caller's
 * max_amount → owner's max per call → weekly limit → approval threshold; the on-chain cap is enforced by the
 * policy contract during the float top-up. Emits `x402.rejected` / `approval.requested` on refusals.
 */
export async function executePayment(userId: string, p: PayRequest): Promise<PayResult> {
  const ctx = await loadContext(userId);
  const rules = await rulesView(userId);
  const reject = (err: RuleViolationError, amountUsdc?: string, network?: Caip2Network) => {
    events.emit({ type: "x402.rejected", userId: ctx.userId, amountUsdc, network, detail: { url: p.url, rule: err.rule, reason: err.message } });
    return err;
  };
  let approvedId: string | undefined;
  try {
    const result = await payFor(ctx, p.url, {
      prefer: p.prefer,
      init: initOf(p),
      allowedNetworks: rules.allowedNetworks,
      beforePay: async (offer) => {
        const v = await evaluateOffer(ctx, rules, offer, p);
        if (v.verdict === "denied") throw reject(new RuleViolationError(v.reason, v.rule as "max_per_call", { priceUsdc: offer.amountUsdc }), offer.amountUsdc, offer.network);
        if (v.verdict === "requires_approval") {
          const { approval, created } = await requestApproval({ userId: ctx.userId, url: p.url, method: p.method ?? "GET", offers: [{ network: offer.network, amountUsdc: offer.amountUsdc, payTo: offer.payTo }], amountUsdc: offer.amountUsdc, network: offer.network });
          if (created) events.emit({ type: "approval.requested", userId: ctx.userId, amountUsdc: offer.amountUsdc, network: offer.network, detail: { approvalId: approval.id, url: p.url, approveUrl: approveUrlFor(approval.id) } });
          throw new ApprovalRequiredError(approval.id, approveUrlFor(approval.id), offer.amountUsdc, offer.network, approval.expiresAt, p.url);
        }
        if (p.approvalId) approvedId = p.approvalId;
      },
    });
    if (approvedId && result.paid) await consumeApproval(ctx.userId, approvedId);
    return result;
  } catch (err) {
    if (err instanceof RuleViolationError && err.rule === "allowed_chains") reject(err);
    throw err;
  }
}

/** Paywalled endpoints the demo resource server advertises (`GET /` discovery document). */
export async function listServices(): Promise<{ resourceServer: string | null; endpoints: Array<{ url: string; route: string; description?: string; accepts: unknown }>; note?: string }> {
  const env = loadEnv();
  if (!env.RESOURCE_SERVER_URL) return { resourceServer: null, endpoints: [], note: "no demo resource server configured; quote_payment / pay_url work with any x402 URL" };
  const base = env.RESOURCE_SERVER_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw Object.assign(new Error(`resource server discovery failed (${res.status})`), { statusCode: 502, code: "DISCOVERY_FAILED" });
  const doc = (await res.json()) as { endpoints?: Array<{ route: string; description?: string; accepts?: unknown }> };
  return {
    resourceServer: base,
    endpoints: (doc.endpoints ?? []).map((e) => ({ url: `${base}${e.route.replace(/^GET\s+/, "")}`, route: e.route, description: e.description, accepts: e.accepts })),
  };
}
