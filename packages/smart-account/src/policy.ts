import { childLogger, derivedKeys, getLatestLedger, loadEnv, SMART_ACCOUNT, stellarContractUrl, stroopsToUsdc, subUsdc, usdcToStroops } from "@pera/core";
import { getKit, ownerSelected, unwrapResult } from "./kit";
import { addAgentRule, getRule, removeRule } from "./rules";

const log = childLogger("smart-account.policy");

export interface PolicyView {
  smartAccountId: string;
  ruleId: number;
  ruleName: string;
  policyContract: string;
  policyExplorerUrl: string;
  agentPublicKey: string;
  dailyCapUsdc: string;
  periodLedgers: number;
  windowLabel: string;
  usedInWindowUsdc: string;
  remainingUsdc: string;
  transfersInWindow: number;
  latestLedger: number;
  onchainAttached: boolean;
}

/** Reads the live `SpendingLimitData` from the policy contract (limit, rolling history). */
export async function getPolicyUsage(ruleId?: number): Promise<PolicyView> {
  const env = loadEnv();
  const id = ruleId ?? env.AGENT_RULE_ID;
  if (id === undefined || !env.SMART_ACCOUNT_ID) throw new Error("not bootstrapped");
  const kit = await getKit();
  const rule = await getRule(id);
  const onchainAttached = rule.policies.includes(SMART_ACCOUNT.spendingLimitPolicy);
  const data = await kit.policyClients.spendingLimit(SMART_ACCOUNT.spendingLimitPolicy).getSpendingLimitData(id);
  const latestLedger = await getLatestLedger();
  const windowStart = latestLedger - data.period_ledgers;
  let used = 0n;
  let count = 0;
  for (const e of data.spending_history) {
    if (e.ledger_sequence > windowStart) {
      used += BigInt(e.amount);
      count += 1;
    }
  }
  const cap = stroopsToUsdc(BigInt(data.spending_limit));
  const usedUsdc = stroopsToUsdc(used);
  return {
    smartAccountId: env.SMART_ACCOUNT_ID,
    ruleId: id,
    ruleName: rule.name,
    policyContract: SMART_ACCOUNT.spendingLimitPolicy,
    policyExplorerUrl: stellarContractUrl(SMART_ACCOUNT.spendingLimitPolicy),
    agentPublicKey: derivedKeys(env).agentPub,
    dailyCapUsdc: cap,
    periodLedgers: data.period_ledgers,
    windowLabel: `rolling ${data.period_ledgers} ledgers (~${Math.round((data.period_ledgers * 5) / 3600)} h)`,
    usedInWindowUsdc: usedUsdc,
    remainingUsdc: used >= BigInt(data.spending_limit) ? "0" : subUsdc(cap, usedUsdc),
    transfersInWindow: count,
    latestLedger,
    onchainAttached,
  };
}

export interface UpdateCapResult {
  ruleId: number;
  txHash: string;
  method: "set_spending_limit" | "recreate_rule";
  dailyCapUsdc: string;
}

/**
 * Owner changes the cap. Preferred path: the policy's `set_spending_limit` through the smart
 * account (`execute`, owner-signed). Fallback: remove and re-create the rule (resets the window).
 */
export async function updateDailyCap(p: { dailyCapUsdc: string; ruleId?: number }): Promise<UpdateCapResult> {
  const env = loadEnv();
  const id = p.ruleId ?? env.AGENT_RULE_ID;
  if (id === undefined) throw new Error("not bootstrapped");
  const kit = await getKit();
  const rule = await getRule(id);
  try {
    const tx = await kit.policyClients.spendingLimit(SMART_ACCOUNT.spendingLimitPolicy).setSpendingLimit(usdcToStroops(p.dailyCapUsdc), rule);
    const res = await kit.multiSigners.adminOperation(tx, await ownerSelected(kit), { resolveContextRuleIds: () => [0], forceMethod: "rpc" });
    const { hash } = unwrapResult(res, "set_spending_limit");
    log.info({ ruleId: id, hash, cap: p.dailyCapUsdc }, "cap updated in place");
    return { ruleId: id, txHash: hash, method: "set_spending_limit", dailyCapUsdc: p.dailyCapUsdc };
  } catch (err) {
    log.warn({ err: (err as Error).message }, "set_spending_limit failed; recreating the rule");
    await removeRule(id);
    const created = await addAgentRule({ agentPublicKey: derivedKeys(env).agentPub, capUsdc: p.dailyCapUsdc });
    return { ruleId: created.ruleId, txHash: created.txHash, method: "recreate_rule", dailyCapUsdc: p.dailyCapUsdc };
  }
}
