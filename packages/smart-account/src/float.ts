import { addUsdc, childLogger, cmpUsdc, events, loadEnv, maxUsdc, SMART_ACCOUNT, sponsorPublicKey, stellarContractUrl, stellarTxUrl, usdcToKitNumber, USDC_SAC, withAccountLock, type UserWalletContext } from "@pera/core";
import { decodeKitError, SmartAccountOpError, SpendingCapExceededError } from "./errors";
import { getKitFor, selectSigners } from "./kit";
import { getPolicyUsage } from "./policy";
import { getRule } from "./rules";

const log = childLogger("smart-account.float");

export interface TopUpResult {
  txHash: string;
  explorerUrl: string;
  amountUsdc: string;
  ruleId: number;
}

export type FloatCtx = Pick<UserWalletContext, "userId" | "smartAccountId" | "agentSecret" | "agentPub" | "agentRuleId" | "dailyCapUsdc"> & { ownerSecret?: string };

function ruleIdOf(ctx: FloatCtx, ruleId?: number): number {
  const id = ruleId ?? ctx.agentRuleId;
  if (id === undefined || id === null) throw new Error("agent rule not authorised yet (the owner must approve the agent with their passkey)");
  return id;
}

/**
 * The only cap-gated hop: the user's agent Ed25519 key authorises a direct USDC SAC `transfer`
 * from the smart account to the agent float G-account under the `spending_limit` policy.
 * SPONSOR pays the fee. Rejections surface as `SpendingCapExceededError` (policy error #3221).
 */
export async function topUpFloat(ctx: FloatCtx, p: { amountUsdc: string; ruleId?: number; to?: string }): Promise<TopUpResult> {
  const ruleId = ruleIdOf(ctx, p.ruleId);
  const to = p.to ?? ctx.agentPub;
  const kit = await getKitFor(ctx);
  const rule = await getRule(ctx, ruleId);
  const selected = selectSigners(kit, rule.signers, `agent rule ${ruleId}`);
  const sponsorPub = sponsorPublicKey(loadEnv());

  return withAccountLock(sponsorPub, async () => {
    try {
      const res = await kit.multiSigners.transfer(USDC_SAC, to, usdcToKitNumber(p.amountUsdc), selected, {
        resolveContextRuleIds: () => [ruleId],
        forceMethod: "rpc",
      });
      if (!res.success) throw res.error;
      events.emit({ type: "float.topup", userId: ctx.userId, amountUsdc: p.amountUsdc, network: "stellar:testnet", txHash: res.hash, explorerUrl: stellarTxUrl(res.hash), detail: { ruleId, to } });
      log.info({ userId: ctx.userId, amountUsdc: p.amountUsdc, hash: res.hash }, "float topped up");
      return { txHash: res.hash, explorerUrl: stellarTxUrl(res.hash), amountUsdc: p.amountUsdc, ruleId };
    } catch (err) {
      const decoded = decodeKitError(err);
      if (decoded.code === SMART_ACCOUNT.errors.SpendingLimitExceeded) {
        // daily and weekly are the same wasm and reject with the same code; the live windows tell them apart
        const usage = await getPolicyUsage(ctx, ruleId).catch(() => null);
        const weekly = usage?.weekly ?? null;
        const byWeekly = !!weekly && cmpUsdc(p.amountUsdc, weekly.remainingUsdc) > 0 && cmpUsdc(p.amountUsdc, usage!.remainingUsdc) <= 0;
        const policy = byWeekly ? SMART_ACCOUNT.weeklySpendingLimitPolicy : SMART_ACCOUNT.spendingLimitPolicy;
        events.emit({
          type: "float.topup.rejected",
          userId: ctx.userId,
          amountUsdc: p.amountUsdc,
          network: "stellar:testnet",
          explorerUrl: stellarContractUrl(policy),
          detail: { ruleId, errorCode: decoded.code, errorName: "SpendingLimitExceeded", window: byWeekly ? "weekly" : "daily", dailyCapUsdc: usage?.dailyCapUsdc ?? ctx.dailyCapUsdc, weeklyCapUsdc: weekly?.capUsdc ?? null },
        });
        throw new SpendingCapExceededError(p.amountUsdc, usage?.dailyCapUsdc ?? ctx.dailyCapUsdc, decoded.message, byWeekly ? "weekly" : "daily", weekly?.capUsdc ?? null);
      }
      if (err instanceof SmartAccountOpError) throw err;
      throw new SmartAccountOpError(`top-up failed: ${decoded.message}`, decoded);
    }
  });
}

export interface OverCapResult {
  rejected: true;
  attemptedUsdc: string;
  dailyCapUsdc: string;
  window: "daily" | "weekly";
  weeklyCapUsdc: string | null;
  errorCode: number;
  errorName: string;
  policyContract: string;
  policyExplorerUrl: string;
  smartAccountId: string;
  ruleId: number;
  simulationError: string;
  explanation: string;
}

/** Demo helper: attempts a transfer above the daily cap and returns the on-chain policy rejection. */
export async function attemptOverCap(ctx: FloatCtx, p: { amountUsdc?: string; ruleId?: number } = {}): Promise<OverCapResult> {
  const cap = ctx.dailyCapUsdc;
  const attempt = p.amountUsdc ?? maxUsdc(addUsdc(cap, "5"), "15");
  const ruleId = ruleIdOf(ctx, p.ruleId);
  try {
    const ok = await topUpFloat(ctx, { amountUsdc: attempt, ruleId });
    throw new Error(`POLICY_NOT_ENFORCED: over-cap transfer of ${attempt} USDC succeeded (${ok.txHash})`);
  } catch (err) {
    if (!(err instanceof SpendingCapExceededError)) throw err;
    const weekly = err.window === "weekly";
    const policy = weekly ? SMART_ACCOUNT.weeklySpendingLimitPolicy : SMART_ACCOUNT.spendingLimitPolicy;
    return {
      rejected: true,
      attemptedUsdc: attempt,
      dailyCapUsdc: err.dailyCapUsdc,
      window: err.window,
      weeklyCapUsdc: err.weeklyCapUsdc,
      errorCode: err.code,
      errorName: err.errorName,
      policyContract: policy,
      policyExplorerUrl: stellarContractUrl(policy),
      smartAccountId: ctx.smartAccountId,
      ruleId,
      simulationError: err.raw,
      explanation: `The OpenZeppelin spending_limit policy attached to context rule ${ruleId} rejected a ${attempt} USDC transfer because it exceeds the ${weekly ? `${err.weeklyCapUsdc} USDC rolling 7 day` : `${err.dailyCapUsdc} USDC rolling 24h`} cap. The agent key cannot bypass this: the check runs inside the smart account's __check_auth on-chain.`,
    };
  }
}
