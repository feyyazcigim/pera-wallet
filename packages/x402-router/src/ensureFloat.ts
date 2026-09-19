import { addUsdc, childLogger, cmpUsdc, derivedKeys, getBalances, getContractUsdcBalance, loadEnv, sacTransfer, subUsdc } from "@pera/core";
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

/**
 * Makes sure the agent float holds `neededUsdc`. Cascade (each hop only if the previous is short):
 * float ← smart account (cap-gated agent transfer) ← owner G ← DeFindex vault (instant withdraw).
 * A `SpendingCapExceededError` from the top-up propagates untouched: the cap is the point.
 */
export async function ensureFloat(p: { neededUsdc: string; bufferUsdc?: string }): Promise<FloatPlan> {
  const env = loadEnv();
  const { agentPub } = derivedKeys(env);
  const buffer = p.bufferUsdc ?? "0.5";
  const floatBefore = (await getBalances(agentPub)).usdc;
  const plan: FloatPlan = { neededUsdc: p.neededUsdc, floatBefore, floatAfter: floatBefore };
  if (cmpUsdc(floatBefore, p.neededUsdc) >= 0) return plan;
  if (!env.SMART_ACCOUNT_ID) throw new Error("SMART_ACCOUNT_ID missing — run `pnpm bootstrap`");

  const shortfall = addUsdc(subUsdc(p.neededUsdc, floatBefore), buffer);
  const smartBal = await getContractUsdcBalance(env.SMART_ACCOUNT_ID);
  if (cmpUsdc(smartBal, shortfall) < 0) {
    // Smart account is short: pull from the vault to the owner G-account, then owner → smart account.
    const refill = addUsdc(subUsdc(shortfall, smartBal), buffer);
    const liq = await ensureLiquidity({ neededUsdc: refill, bufferUsdc: buffer });
    if (liq.withdrewUsdc) {
      plan.withdrewFromVaultUsdc = liq.withdrewUsdc;
      plan.vaultTxHash = liq.txHash;
    }
    const tx = await sacTransfer({ fromSecret: env.OWNER_SECRET, to: env.SMART_ACCOUNT_ID, amountUsdc: refill, sponsorSecret: env.SPONSOR_SECRET });
    plan.refilledSmartAccountUsdc = refill;
    plan.refillTxHash = tx.hash;
    log.info({ refill, hash: tx.hash }, "smart account refilled from owner");
  }

  const top = await topUpFloat({ amountUsdc: shortfall });
  plan.toppedUpUsdc = shortfall;
  plan.topUpTxHash = top.txHash;
  plan.floatAfter = (await getBalances(agentPub)).usdc;
  return plan;
}
