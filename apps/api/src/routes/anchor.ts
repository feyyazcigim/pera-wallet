import type { FastifyInstance } from "fastify";
import { childLogger, loadEnv } from "@pera/core";
import { getAnchorTx, offrampUsdcToTry, simulateBankTransfer, startOnramp, waitForStatus } from "@pera/anchor";
import { autoDeposit, ensureLiquidity } from "@pera/yield";
import { OfframpBody, OnrampBody } from "../schemas";

const log = childLogger("api.anchor");

export async function anchorRoutes(app: FastifyInstance): Promise<void> {
  /** Starts a SEP-6 deposit and immediately simulates the bank wire; completion is tracked in the background. */
  app.post("/onramp", async (req, reply) => {
    const env = loadEnv();
    const { amountTry } = OnrampBody.parse(req.body);
    const start = await startOnramp({ accountSecret: env.OWNER_SECRET, amountTry });
    await simulateBankTransfer(start.id, amountTry);
    void waitForStatus({ accountSecret: env.OWNER_SECRET, id: start.id })
      .then(async (tx) => {
        const { events, stellarTxUrl } = await import("@pera/core");
        events.emit({
          type: "onramp.completed",
          amountUsdc: tx.amountOut,
          network: "stellar:testnet",
          txHash: tx.stellarTransactionId,
          explorerUrl: tx.stellarTransactionId ? stellarTxUrl(tx.stellarTransactionId) : undefined,
          detail: { anchorTxId: tx.id, amountTry: tx.amountIn, feeUsdc: tx.amountFee },
        });
        if (env.AUTOPILOT === "on") await autoDeposit().catch((e: Error) => log.warn({ err: e.message }, "auto-deposit after onramp failed"));
      })
      .catch((e: Error) => log.warn({ err: e.message, id: start.id }, "onramp did not complete"));
    return reply.status(202).send({ anchorTxId: start.id, amountTry, status: "pending_anchor", instructions: start.instructions, how: start.how });
  });

  app.get("/onramp/:id", async (req) => {
    const env = loadEnv();
    const { id } = req.params as { id: string };
    return getAnchorTx({ accountSecret: env.OWNER_SECRET, id });
  });

  /** SEP-6 withdrawal: pulls liquidity from the vault if needed, pays the anchor, waits for completion. */
  app.post("/offramp", async (req) => {
    const env = loadEnv();
    const { amountUsdc } = OfframpBody.parse(req.body);
    const liquidity = await ensureLiquidity({ neededUsdc: amountUsdc });
    const r = await offrampUsdcToTry({ accountSecret: env.OWNER_SECRET, amountUsdc });
    return {
      anchorTxId: r.start.id,
      stellarTxHash: r.paymentTxHash,
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${r.paymentTxHash}`,
      status: r.tx.status,
      amountUsdc,
      amountTry: r.tx.amountOut,
      liquidity,
    };
  });
}
