import { addUsdc, childLogger, events, loadEnv, maxUsdc, SMART_ACCOUNT, sponsorPublicKey, stellarContractUrl, stellarTxUrl, usdcToKitNumber, USDC_SAC, withAccountLock, type UserWalletContext } from "@pera/core";
import { decodeKitError, SmartAccountOpError, SpendingCapExceededError } from "./errors";
import { getKitFor, selectSigners } from "./kit";
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
        events.emit({
          type: "float.topup.rejected",
          userId: ctx.userId,
          amountUsdc: p.amountUsdc,
          network: "stellar:testnet",
          explorerUrl: stellarContractUrl(SMART_ACCOUNT.spendingLimitPolicy),
          detail: { ruleId, errorCode: decoded.code, errorName: "SpendingLimitExceeded", dailyCapUsdc: ctx.dailyCapUsdc },
        });
        throw new SpendingCapExceededError(p.amountUsdc, ctx.dailyCapUsdc, decoded.message);
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
    return {
      rejected: true,
      attemptedUsdc: attempt,
      dailyCapUsdc: cap,
      errorCode: err.code,
      errorName: err.errorName,
      policyContract: SMART_ACCOUNT.spendingLimitPolicy,
      policyExplorerUrl: stellarContractUrl(SMART_ACCOUNT.spendingLimitPolicy),
      smartAccountId: ctx.smartAccountId,
      ruleId,
      simulationError: err.raw,
      explanation: `The OpenZeppelin spending_limit policy attached to context rule ${ruleId} rejected a ${attempt} USDC transfer because it exceeds the ${cap} USDC rolling 24h cap. The agent key cannot bypass this: the check runs inside the smart account's __check_auth on-chain.`,
    };
  }
}
