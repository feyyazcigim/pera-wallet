import type { FastifyInstance } from "fastify";
import { deposit, getPosition, isConfigured, withdraw } from "@pera/yield";
import { AmountBody } from "../schemas";

export async function yieldRoutes(app: FastifyInstance): Promise<void> {
  const guard = () => {
    if (!isConfigured()) throw Object.assign(new Error("DeFindex not configured (DEFINDEX_API_KEY / VAULT_ID missing)"), { statusCode: 503 });
  };
  app.post("/yield/deposit", async (req) => {
    guard();
    const { amountUsdc } = AmountBody.parse(req.body);
    const tx = await deposit({ amountUsdc });
    return { amountUsdc, txHash: tx.hash, explorerUrl: tx.explorerUrl, vaultId: tx.vaultId };
  });
  app.post("/yield/withdraw", async (req) => {
    guard();
    const { amountUsdc } = AmountBody.parse(req.body);
    const tx = await withdraw({ amountUsdc });
    return { amountUsdc, txHash: tx.hash, explorerUrl: tx.explorerUrl, vaultId: tx.vaultId };
  });
  app.get("/yield/position", async (req) => {
    guard();
    const fresh = (req.query as { fresh?: string }).fresh === "1";
    return getPosition({ fresh });
  });
}
