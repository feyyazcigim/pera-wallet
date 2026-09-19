import { addUsdc, childLogger, derivedKeys, events, loadEnv, maxUsdc, SMART_ACCOUNT, stellarContractUrl, stellarTxUrl, usdcToKitNumber, USDC_SAC, withAccountLock } from "@pera/core";
import { decodeKitError, SmartAccountOpError, SpendingCapExceededError } from "./errors";
import { getKit, selectSigners } from "./kit";
import { getRule } from "./rules";

const log = childLogger("smart-account.float");

export interface TopUpResult {
  txHash: string;
  explorerUrl: string;
  amountUsdc: string;
  ruleId: number;
}

function currentRuleId(ruleId?: number): number {
  const env = loadEnv();
  const id = ruleId ?? env.AGENT_RULE_ID;
  if (id === undefined) throw new Error("AGENT_RULE_ID missing — run `pnpm bootstrap`");
  return id;
}

/**
 * The only cap-gated hop: the agent's Ed25519 key authorises a direct USDC SAC `transfer`
 * from the smart account to its own float G-account under the `spending_limit` policy.
 * SPONSOR pays the fee. Rejections surface as `SpendingCapExceededError` (policy error #3221).
 */
export async function topUpFloat(p: { amountUsdc: string; ruleId?: number; to?: string }): Promise<TopUpResult> {
  const env = loadEnv();
  const { agentPub, sponsorPub } = derivedKeys(env);
  const ruleId = currentRuleId(p.ruleId);
  const to = p.to ?? agentPub;
  const kit = await getKit();
  const rule = await getRule(ruleId);
  const selected = selectSigners(kit, rule.signers, `agent rule ${ruleId}`);

  return withAccountLock(sponsorPub, async () => {
    try {
      const res = await kit.multiSigners.transfer(USDC_SAC, to, usdcToKitNumber(p.amountUsdc), selected, {
        resolveContextRuleIds: () => [ruleId],
        forceMethod: "rpc",
      });
      if (!res.success) throw res.error;
      events.emit({ type: "float.topup", amountUsdc: p.amountUsdc, network: "stellar:testnet", txHash: res.hash, explorerUrl: stellarTxUrl(res.hash), detail: { ruleId, to } });
      log.info({ amountUsdc: p.amountUsdc, hash: res.hash }, "float topped up");
      return { txHash: res.hash, explorerUrl: stellarTxUrl(res.hash), amountUsdc: p.amountUsdc, ruleId };
    } catch (err) {
      const decoded = decodeKitError(err);
      if (decoded.code === SMART_ACCOUNT.errors.SpendingLimitExceeded) {
        events.emit({
          type: "float.topup.rejected",
          amountUsdc: p.amountUsdc,
          network: "stellar:testnet",
          explorerUrl: stellarContractUrl(SMART_ACCOUNT.spendingLimitPolicy),
          detail: { ruleId, errorCode: decoded.code, errorName: "SpendingLimitExceeded", dailyCapUsdc: env.AGENT_DAILY_CAP_USDC },
        });
        throw new SpendingCapExceededError(p.amountUsdc, env.AGENT_DAILY_CAP_USDC, decoded.message);
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

/**
 * Demo helper: attempts a transfer above the daily cap and returns the on-chain policy rejection.
 * Soroban evaluates the policy during simulation against live ledger state, so the failure is the
 * policy contract's own `SpendingLimitExceeded` error, not a backend check.
 */
export async function attemptOverCap(p: { amountUsdc?: string; ruleId?: number } = {}): Promise<OverCapResult> {
  const env = loadEnv();
  const cap = env.AGENT_DAILY_CAP_USDC;
  const attempt = p.amountUsdc ?? maxUsdc(addUsdc(cap, "5"), "15");
  const ruleId = currentRuleId(p.ruleId);
  try {
    const ok = await topUpFloat({ amountUsdc: attempt, ruleId });
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
      smartAccountId: env.SMART_ACCOUNT_ID ?? "",
      ruleId,
      simulationError: err.raw,
      explanation: `The OpenZeppelin spending_limit policy attached to context rule ${ruleId} rejected a ${attempt} USDC transfer because it exceeds the ${cap} USDC rolling 24h cap. The agent key cannot bypass this: the check runs inside the smart account's __check_auth on-chain.`,
    };
  }
}
