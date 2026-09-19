import type { FastifyInstance } from "fastify";
import { childLogger, events, loadEnv, stellarTxUrl } from "@pera/core";
import { getAnchorTx, offrampUsdcToTry, simulateBankTransfer, startOnramp, waitForStatus } from "@pera/anchor";
import { autoDeposit, ensureLiquidity } from "@pera/yield";
import { requireUser } from "../auth";
import { loadContext } from "../context";
import { OfframpBody, OnrampBody } from "../schemas";

const log = childLogger("api.anchor");

export async function anchorRoutes(app: FastifyInstance): Promise<void> {
  /** SEP-6 deposit into the user's treasury account; the sandbox wire is simulated; completion tracked in the background. */
  app.post("/onramp", async (req, reply) => {
    const env = loadEnv();
    const ctx = await loadContext(requireUser(req).id);
    const { amountTry } = OnrampBody.parse(req.body);
    const start = await startOnramp({ accountSecret: ctx.treasurySecret, amountTry, userId: ctx.userId });
    await simulateBankTransfer(start.id, amountTry);
    void waitForStatus({ accountSecret: ctx.treasurySecret, id: start.id })
      .then(async (tx) => {
        events.emit({ type: "onramp.completed", userId: ctx.userId, amountUsdc: tx.amountOut, network: "stellar:testnet", txHash: tx.stellarTransactionId, explorerUrl: tx.stellarTransactionId ? stellarTxUrl(tx.stellarTransactionId) : undefined, detail: { anchorTxId: tx.id, amountTry: tx.amountIn, feeUsdc: tx.amountFee } });
        if (env.AUTOPILOT === "on") await autoDeposit(ctx).catch((e: Error) => log.warn({ err: e.message }, "auto-deposit after onramp failed"));
      })
      .catch((e: Error) => log.warn({ err: e.message, id: start.id }, "onramp did not complete"));
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
