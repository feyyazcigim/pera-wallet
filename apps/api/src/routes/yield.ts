import type { FastifyInstance } from "fastify";
import { deposit, getPosition, isConfigured, withdraw } from "@pera/yield";
import { requireUser } from "../auth";
import { loadContext } from "../context";
import { AmountBody } from "../schemas";

export async function yieldRoutes(app: FastifyInstance): Promise<void> {
  const guard = () => {
    if (!isConfigured() || !process.env.VAULT_ID) throw Object.assign(new Error("DeFindex not configured (DEFINDEX_API_KEY / VAULT_ID missing)"), { statusCode: 503, code: "YIELD_UNAVAILABLE" });
  };
  app.post("/yield/deposit", async (req) => {
    guard();
    const ctx = await loadContext(requireUser(req).id);
    const { amountUsdc } = AmountBody.parse(req.body);
    const tx = await deposit(ctx, { amountUsdc });
    return { amountUsdc, txHash: tx.hash, explorerUrl: tx.explorerUrl, vaultId: tx.vaultId };
  });
  app.post("/yield/withdraw", async (req) => {
    guard();
    const ctx = await loadContext(requireUser(req).id);
    const { amountUsdc } = AmountBody.parse(req.body);
    const tx = await withdraw(ctx, { amountUsdc });
    return { amountUsdc, txHash: tx.hash, explorerUrl: tx.explorerUrl, vaultId: tx.vaultId };
  });
  app.get("/yield/position", async (req) => {
    guard();
    const ctx = await loadContext(requireUser(req).id);
    return getPosition(ctx, { fresh: (req.query as { fresh?: string }).fresh === "1" });
  });
}
