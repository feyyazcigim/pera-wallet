import { addUsdc, childLogger, cmpUsdc, getBalances, getContractUsdcBalance, loadEnv, sacTransfer, subUsdc, type UserWalletContext } from "@pera/core";
import { topUpFloat } from "@pera/smart-account";
import { ensureLiquidity } from "@pera/yield";

const log = childLogger("router.float");

export interface FloatPlan {
  neededUsdc: string;
  floatBefore: string;
  floatAfter: string;
  toppedUpUsdc?: string;
  topUpTxHash?: string;
  refilledSmartAccountUsdc?: string;
  refillTxHash?: string;
  withdrewFromVaultUsdc?: string;
  vaultTxHash?: string;
}

export type FloatCtx = Pick<UserWalletContext, "userId" | "smartAccountId" | "agentSecret" | "agentPub" | "agentRuleId" | "dailyCapUsdc" | "treasurySecret" | "treasuryPub"> & { ownerSecret?: string };

/**
 * Makes sure the user's agent float holds `neededUsdc`. Cascade (each hop only if the previous is short):
 * float ← smart account (cap-gated agent transfer) ← treasury G ← DeFindex vault (instant withdraw).
 * A `SpendingCapExceededError` from the top-up propagates untouched: the cap is the point.
 */
export async function ensureFloat(ctx: FloatCtx, p: { neededUsdc: string; bufferUsdc?: string }): Promise<FloatPlan> {
  const env = loadEnv();
  const buffer = p.bufferUsdc ?? "0.5";
  const floatBefore = (await getBalances(ctx.agentPub)).usdc;
  const plan: FloatPlan = { neededUsdc: p.neededUsdc, floatBefore, floatAfter: floatBefore };
  if (cmpUsdc(floatBefore, p.neededUsdc) >= 0) return plan;

  const shortfall = addUsdc(subUsdc(p.neededUsdc, floatBefore), buffer);
  const smartBal = await getContractUsdcBalance(ctx.smartAccountId);
  if (cmpUsdc(smartBal, shortfall) < 0) {
    const refill = addUsdc(subUsdc(shortfall, smartBal), buffer);
    const liq = await ensureLiquidity(ctx, { neededUsdc: refill, bufferUsdc: buffer });
    if (liq.withdrewUsdc) {
      plan.withdrewFromVaultUsdc = liq.withdrewUsdc;
      plan.vaultTxHash = liq.txHash;
    }
    const tx = await sacTransfer({ fromSecret: ctx.treasurySecret, to: ctx.smartAccountId, amountUsdc: refill, sponsorSecret: env.SPONSOR_SECRET });
    plan.refilledSmartAccountUsdc = refill;
    plan.refillTxHash = tx.hash;
    log.info({ userId: ctx.userId, refill, hash: tx.hash }, "smart account refilled from treasury");
  }

  const top = await topUpFloat(ctx, { amountUsdc: shortfall });
  plan.toppedUpUsdc = shortfall;
  plan.topUpTxHash = top.txHash;
  plan.floatAfter = (await getBalances(ctx.agentPub)).usdc;
  return plan;
}

/**
 * Tops the smart account up to at least `minUsdc` from the treasury (drawing on the vault first if
 * needed). Used before the over-cap demo so the spending-limit policy — not the balance — is what rejects.
 */
export async function ensureSmartAccountBalance(ctx: FloatCtx, p: { minUsdc: string }): Promise<{ smartAccountUsdc: string; refilledUsdc?: string; refillTxHash?: string; shortfallUsdc?: string }> {
  const env = loadEnv();
  const bal = await getContractUsdcBalance(ctx.smartAccountId);
  if (cmpUsdc(bal, p.minUsdc) >= 0) return { smartAccountUsdc: bal };
  const need = subUsdc(p.minUsdc, bal);
  let available = (await getBalances(ctx.treasuryPub)).usdc;
  try {
    const liq = await ensureLiquidity(ctx, { neededUsdc: need, bufferUsdc: "0" });
    available = liq.treasuryUsdcAfter;
  } catch {
    /* no vault or not enough in it: use what the treasury has */
  }
  const amount = cmpUsdc(available, need) >= 0 ? need : available;
  if (cmpUsdc(amount, "0") <= 0) return { smartAccountUsdc: bal, shortfallUsdc: need };
  const tx = await sacTransfer({ fromSecret: ctx.treasurySecret, to: ctx.smartAccountId, amountUsdc: amount, sponsorSecret: env.SPONSOR_SECRET });
  const after = await getContractUsdcBalance(ctx.smartAccountId);
  const shortfall = cmpUsdc(after, p.minUsdc) >= 0 ? undefined : subUsdc(p.minUsdc, after);
  return { smartAccountUsdc: after, refilledUsdc: amount, refillTxHash: tx.hash, shortfallUsdc: shortfall };
}
