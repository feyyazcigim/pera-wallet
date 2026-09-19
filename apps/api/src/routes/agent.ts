import type { FastifyInstance } from "fastify";
import { events, loadEnv, stellarTxUrl } from "@pera/core";
import { createAgentToken, updateStellarWallet, upsertAgentRules } from "@pera/db";
import { attemptOverCap, buildAgentRuleTx, buildSetCapTx, getPolicyUsage, resolveNewRuleId, submitPasskeySignedXdr, AGENT_RULE_NAME } from "@pera/smart-account";
import { transferUsdcFrom } from "@pera/evm";
import { ensureSmartAccountBalance } from "@pera/x402-router";
import { addUsdc } from "@pera/core";
import { requireOwner, requireScope } from "../auth";
import { loadContext } from "../context";
import { hermesConnectKit } from "../mcp/hermes";
import { executePayment, listServices, quotePayment, rulesView } from "../services/payments";
import { AuthorizeBuildBody, EvmTransferBody, PayBody, PayBodyV2, PolicyBody, QuoteBody, RulesBody, XdrBody } from "../schemas";

/** Collects the events emitted for this user during `fn` (returned as `timeline`). */
async function withTimeline<T>(userId: string, fn: () => Promise<T>): Promise<T & { timeline: unknown[] }> {
  const timeline: unknown[] = [];
  const unsub = events.subscribe((e) => timeline.push(e), userId);
  try {
    const r = await fn();
    return Object.assign(r as object, { timeline }) as T & { timeline: unknown[] };
  } finally {
    unsub();
  }
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/agent/policy", async (req) => {
    const ctx = await loadContext(requireScope(req, "read").id);
    return getPolicyUsage(ctx);
  });

  /**
   * Step 1 of authorising the agent: build the `add_context_rule` transaction (agent signer + spending_limit
   * policy). Returns the kit-serialised tx: the browser does `kit.wallet.fromJSON.add_context_rule(json)` →
   * `kit.signAdmin(tx)` → POST /agent/authorize { xdr }. Alternatively the browser builds it with
   * `kit.rules.add(...)` using `agentPublicKey` + `dailyCapUsdc` below.
   */
  app.post("/agent/authorize/build", async (req) => {
    const ctx = await loadContext(requireScope(req, "admin").id);
    const { dailyCapUsdc } = AuthorizeBuildBody.parse(req.body ?? {});
    const cap = dailyCapUsdc ?? ctx.dailyCapUsdc;
    const { tx } = await buildAgentRuleTx(ctx, { agentPublicKey: ctx.agentPub, capUsdc: cap });
    if (dailyCapUsdc && dailyCapUsdc !== ctx.dailyCapUsdc) await updateStellarWallet(ctx.userId, { dailyCapUsdc });
    return { json: tx.toJSON(), xdr: tx.toXDR(), agentPublicKey: ctx.agentPub, dailyCapUsdc: cap, ruleName: AGENT_RULE_NAME, smartAccountId: ctx.smartAccountId };
  });

  /** Step 2: submit the passkey-signed transaction sponsored, then record the new rule id. */
  app.post("/agent/authorize", async (req) => {
    const ctx = await loadContext(requireScope(req, "admin").id);
    const { xdr } = XdrBody.parse(req.body);
    const r = await submitPasskeySignedXdr({ xdr, expectContract: ctx.smartAccountId });
    const ruleId = await resolveNewRuleId(ctx);
    await updateStellarWallet(ctx.userId, { agentRuleId: ruleId, status: "ready", statusDetail: null });
    events.emit({ type: "agent.authorized", userId: ctx.userId, network: "stellar:testnet", txHash: r.hash, explorerUrl: stellarTxUrl(r.hash), detail: { ruleId, dailyCapUsdc: ctx.dailyCapUsdc, agentPublicKey: ctx.agentPub } });
    return { ruleId, txHash: r.hash, explorerUrl: r.explorerUrl, dailyCapUsdc: ctx.dailyCapUsdc };
  });

  /** Cap change, same two-step passkey flow. */
  app.post("/agent/policy/build", async (req) => {
    const ctx = await loadContext(requireScope(req, "admin").id);
    const { dailyCapUsdc } = PolicyBody.parse(req.body);
    if (ctx.agentRuleId === undefined) throw Object.assign(new Error("agent not authorised yet"), { statusCode: 409, code: "NOT_AUTHORISED" });
    const { tx } = await buildSetCapTx(ctx, { ruleId: ctx.agentRuleId, dailyCapUsdc });
    return { json: tx.toJSON(), xdr: tx.toXDR(), ruleId: ctx.agentRuleId, dailyCapUsdc };
  });
  app.post("/agent/policy", async (req) => {
    const ctx = await loadContext(requireScope(req, "admin").id);
    const { xdr, dailyCapUsdc } = XdrBody.extend({ dailyCapUsdc: PolicyBody.shape.dailyCapUsdc }).parse(req.body);
    const r = await submitPasskeySignedXdr({ xdr, expectContract: ctx.smartAccountId });
    await updateStellarWallet(ctx.userId, { dailyCapUsdc });
    return { ruleId: ctx.agentRuleId, txHash: r.hash, explorerUrl: r.explorerUrl, dailyCapUsdc };
  });

  /** Generic sponsored submission of any passkey-signed transaction targeting the user's smart account. */
  app.post("/stellar/submit", async (req) => {
    const ctx = await loadContext(requireScope(req, "admin").id);
    const { xdr } = XdrBody.parse(req.body);
    return submitPasskeySignedXdr({ xdr, expectContract: ctx.smartAccountId });
  });

  /**
   * Router-enforced rules next to the on-chain daily cap: weekly x402 limit, max price per call, allowed chains,
   * approval threshold. Checked in the payment service after the 402 is parsed and before anything is signed.
   */
  app.get("/agent/rules", async (req) => rulesView(requireScope(req, "read").id));
  app.put("/agent/rules", async (req) => {
    const user = requireOwner(req);
    const body = RulesBody.parse(req.body);
    await upsertAgentRules(user.id, { ...body, approveAboveUsdc: body.approveAboveUsdc ?? null });
    return rulesView(user.id);
  });

  /** Probe a paywalled URL: price, network, payee and the verdict the rules would give — never pays. */
  app.post("/agent/quote", async (req) => {
    const user = requireScope(req, "read");
    return quotePayment(user.id, QuoteBody.parse(req.body));
  });

  /** Paywalled endpoints the demo resource server advertises. */
  app.get("/agent/services", async (req) => {
    requireScope(req, "read");
    return listServices();
  });

  /** Everything a user needs to plug Hermes (or any MCP client) into their wallet: token, config snippet, deep link. */
  app.post("/agent/connect/hermes", async (req) => {
    const user = requireOwner(req);
    const { token, secret } = await createAgentToken({ userId: user.id, name: "Hermes Agent", scopes: ["read", "pay"], ttlDays: 90 });
    return { tokenId: token.id, scopes: token.scopes, expiresAt: token.expiresAt, ...hermesConnectKit(loadEnv().PUBLIC_API_URL, secret) };
  });

  app.post("/agent/pay", async (req) => {
    const user = requireScope(req, "pay");
    const body = PayBodyV2.safeParse(req.body);
    const p = body.success ? body.data : { ...PayBody.parse(req.body), method: "GET" as const };
    return withTimeline(user.id, () => executePayment(user.id, p));
  });

  /**
   * Attempts a top-up above what the policy allows. The smart account is first funded from the treasury /
   * vault so that the spending_limit policy — not the balance — is the reason for the rejection.
   */
  app.post("/agent/pay/over-cap-demo", async (req) => {
    const ctx = await loadContext(requireScope(req, "pay").id);
    const body = (req.body ?? {}) as { amountUsdc?: string };
    const policy = await getPolicyUsage(ctx);
    const attempt = body.amountUsdc ?? addUsdc(policy.remainingUsdc, "1");
    const funding = await ensureSmartAccountBalance(ctx, { minUsdc: attempt });
    if (funding.shortfallUsdc) {
      throw Object.assign(new Error(`the smart account holds ${funding.smartAccountUsdc} USDC; the demo needs ≥ ${attempt} USDC so that the policy, not the balance, rejects. On-ramp more TRY first.`), { statusCode: 409, code: "INSUFFICIENT_FUNDS_FOR_DEMO" });
    }
    return withTimeline(ctx.userId, async () => ({ ...(await attemptOverCap(ctx, { amountUsdc: attempt })), funding }));
  });

  /** Gasless USDC transfer out of the user's EVM wallet (Privy sponsorship or EIP-3009 relay). */
  app.post("/evm/transfer", async (req) => {
    const ctx = await loadContext(requireOwner(req).id);
    if (!ctx.evmWallet) throw Object.assign(new Error("no EVM wallet"), { statusCode: 409 });
    const { to, amountUsdc } = EvmTransferBody.parse(req.body);
    return transferUsdcFrom(ctx.evmWallet, { to, amountUsdc });
  });
}
