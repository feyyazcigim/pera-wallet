import type { FastifyInstance } from "fastify";
import { childLogger, events, loadEnv, stellarTxUrl } from "@pera/core";
import { getAnchorTx, offrampUsdcToTry, simulateBankTransfer, startOnramp, waitForStatus } from "@pera/anchor";
import { autoDeposit, ensureLiquidity } from "@pera/yield";
import { requireUser } from "../auth";
import { loadContext } from "../context";
import { createDepositOrder, getDepositOrder, getOpenDepositOrder, listUnsettledDepositOrders, markDepositOrderFunded } from "@pera/db";
import { BankTransferBody, OfframpBody, OnrampBody } from "../schemas";

const log = childLogger("api.anchor");

const compact = (s: string) => s.replace(/\s+/g, "").toUpperCase();

export async function anchorRoutes(app: FastifyInstance): Promise<void> {
  /** Background: wait for the anchor to pay out, announce it, move idle USDC into the vault. */
  const track = (ctx: Awaited<ReturnType<typeof loadContext>>, anchorTxId: string) => {
    const env = loadEnv();
    // the sandbox anchor can take a while under load: stay on it for half an hour rather than the default 3 minutes
    void waitForStatus({ accountSecret: ctx.treasurySecret, id: anchorTxId, timeoutMs: 30 * 60_000, intervalMs: 6_000 })
      .then(async (tx) => {
        events.emit({ type: "onramp.completed", userId: ctx.userId, amountUsdc: tx.amountOut, network: "stellar:testnet", txHash: tx.stellarTransactionId, explorerUrl: tx.stellarTransactionId ? stellarTxUrl(tx.stellarTransactionId) : undefined, detail: { anchorTxId: tx.id, amountTry: tx.amountIn, feeUsdc: tx.amountFee } });
        if (env.AUTOPILOT === "on") await autoDeposit(ctx).catch((e: Error) => log.warn({ err: e.message }, "auto-deposit after onramp failed"));
      })
      .catch((e: Error) => log.warn({ err: e.message, id: anchorTxId }, "onramp did not complete"));
  };

  // bank transfers that were still converting when the API last stopped: pick them up again
  void listUnsettledDepositOrders()
    .then(async (orders) => {
      for (const o of orders) track(await loadContext(o.userId), o.anchorTxId);
      if (orders.length) log.info({ count: orders.length }, "resumed tracking unsettled deposits");
    })
    .catch((e: Error) => log.warn({ err: e.message }, "could not resume deposit tracking"));

  /**
   * The user's deposit details: the anchor's IBAN and the reference that routes a bank transfer to this user's
   * treasury. Opens a SEP-6 deposit order once and keeps returning it until it has been paid into.
   */
  app.post("/onramp/instructions", async (req) => {
    const user = requireUser(req);
    const open = await getOpenDepositOrder(user.id);
    if (open) return { iban: open.iban, bankName: open.bankName, reference: open.reference, anchorTxId: open.anchorTxId, minTry: 50, maxTry: 3000, createdAt: open.createdAt };
    const ctx = await loadContext(user.id);
    // the order's own amount is nominal: the anchor converts whatever the bank transfer actually carries
    const start = await startOnramp({ accountSecret: ctx.treasurySecret, amountTry: "3000", userId: ctx.userId, silent: true });
    if (!start.instructions.iban || !start.instructions.memo) throw Object.assign(new Error("the anchor returned no bank instructions"), { statusCode: 502, code: "ANCHOR_ERROR" });
    const order = await createDepositOrder({ reference: start.instructions.memo, userId: user.id, anchorTxId: start.id, iban: start.instructions.iban, bankName: start.instructions.bankName });
    return { iban: order.iban, bankName: order.bankName, reference: order.reference, anchorTxId: order.anchorTxId, minTry: start.minAmountTry ?? 50, maxTry: 3000, createdAt: order.createdAt };
  });

  /**
   * Sandbox bank rail (public, like a real wire): "send `amountTry` to `iban` with `reference` in the description".
   * Plays the bank for the mock anchor, then tracks the payout for the user the reference belongs to.
   */
  app.post("/bank/transfer", async (req, reply) => {
    const { iban, reference, amountTry } = BankTransferBody.parse(req.body);
    const order = await getDepositOrder(reference);
    if (!order || compact(order.iban) !== compact(iban)) return reply.status(404).send({ error: "no open deposit matches this IBAN and reference", code: "UNKNOWN_REFERENCE" });
    if (order.status !== "open") return reply.status(409).send({ error: "this reference has already been paid into — the dashboard shows a fresh one", code: "REFERENCE_USED" });
    const ctx = await loadContext(order.userId);
    await simulateBankTransfer(order.anchorTxId, amountTry);
    await markDepositOrderFunded(order.reference);
    events.emit({ type: "onramp.started", userId: ctx.userId, detail: { anchorTxId: order.anchorTxId, amountTry, iban: order.iban, memo: order.reference } });
    track(ctx, order.anchorTxId);
    return reply.status(202).send({ reference: order.reference, amountTry, status: "pending_anchor", anchorTxId: order.anchorTxId });
  });
  app.get("/bank/transfer/:reference", async (req, reply) => {
    const order = await getDepositOrder((req.params as { reference: string }).reference);
    if (!order) return reply.status(404).send({ error: "unknown reference", code: "UNKNOWN_REFERENCE" });
    const ctx = await loadContext(order.userId);
    const tx = await getAnchorTx({ accountSecret: ctx.treasurySecret, id: order.anchorTxId });
    return { reference: order.reference, status: tx.status, message: tx.message, amountTry: tx.amountIn, amountUsdc: tx.amountOut, stellarTransactionId: tx.stellarTransactionId };
  });

  /** SEP-6 deposit into the user's treasury account; the sandbox wire is simulated; completion tracked in the background. */
  app.post("/onramp", async (req, reply) => {
    const ctx = await loadContext(requireUser(req).id);
    const { amountTry } = OnrampBody.parse(req.body);
    const start = await startOnramp({ accountSecret: ctx.treasurySecret, amountTry, userId: ctx.userId });
    await simulateBankTransfer(start.id, amountTry);
    track(ctx, start.id);
    return reply.status(202).send({ anchorTxId: start.id, amountTry, status: "pending_anchor", instructions: start.instructions, how: start.how, destination: ctx.treasuryPub });
  });

  app.get("/onramp/:id", async (req) => {
    const ctx = await loadContext(requireUser(req).id);
    const { id } = req.params as { id: string };
    return getAnchorTx({ accountSecret: ctx.treasurySecret, id });
  });

  /** SEP-6 withdrawal from the user's treasury (vault → treasury first if needed); SPONSOR pays the payment fee. */
  app.post("/offramp", async (req) => {
    const env = loadEnv();
    const ctx = await loadContext(requireUser(req).id);
    const { amountUsdc } = OfframpBody.parse(req.body);
    const liquidity = await ensureLiquidity(ctx, { neededUsdc: amountUsdc });
    const r = await offrampUsdcToTry({ accountSecret: ctx.treasurySecret, amountUsdc, userId: ctx.userId, sponsorSecret: env.SPONSOR_SECRET });
    return { anchorTxId: r.start.id, stellarTxHash: r.paymentTxHash, explorerUrl: stellarTxUrl(r.paymentTxHash), status: r.tx.status, amountUsdc, amountTry: r.tx.amountOut, liquidity };
  });
}
