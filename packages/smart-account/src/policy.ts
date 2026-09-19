import { childLogger, getLatestLedger, SMART_ACCOUNT, stellarContractUrl, stroopsToUsdc, subUsdc, usdcToStroops, type UserWalletContext } from "@pera/core";
import { getKitFor, ownerSelected, unwrapResult } from "./kit";
import { addAgentRule, getRule, removeRule, type KitCtx } from "./rules";

const log = childLogger("smart-account.policy");

export interface PolicyView {
  smartAccountId: string;
  ruleId: number | null;
  ruleName: string | null;
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
  authorised: boolean;
}

type PolicyCtx = Pick<UserWalletContext, "smartAccountId" | "agentSecret" | "agentPub" | "agentRuleId" | "dailyCapUsdc"> & { ownerSecret?: string };

/** Reads the live `SpendingLimitData` from the policy contract (limit, rolling history). */
export async function getPolicyUsage(ctx: PolicyCtx, ruleId?: number): Promise<PolicyView> {
  const id = ruleId ?? ctx.agentRuleId;
  const base = {
    smartAccountId: ctx.smartAccountId,
    policyContract: SMART_ACCOUNT.spendingLimitPolicy,
    policyExplorerUrl: stellarContractUrl(SMART_ACCOUNT.spendingLimitPolicy),
    agentPublicKey: ctx.agentPub,
    periodLedgers: SMART_ACCOUNT.ledgersPerDay,
    windowLabel: `rolling ${SMART_ACCOUNT.ledgersPerDay} ledgers (~24 h)`,
  };
  if (id === undefined || id === null) {
    return { ...base, ruleId: null, ruleName: null, dailyCapUsdc: ctx.dailyCapUsdc, usedInWindowUsdc: "0", remainingUsdc: ctx.dailyCapUsdc, transfersInWindow: 0, latestLedger: 0, onchainAttached: false, authorised: false };
  }
  const kit = await getKitFor(ctx);
  const rule = await getRule(ctx, id);
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
    ...base,
    ruleId: id,
    ruleName: rule.name,
    dailyCapUsdc: cap,
    periodLedgers: data.period_ledgers,
    windowLabel: `rolling ${data.period_ledgers} ledgers (~${Math.round((data.period_ledgers * 5) / 3600)} h)`,
    usedInWindowUsdc: usedUsdc,
    remainingUsdc: used >= BigInt(data.spending_limit) ? "0" : subUsdc(cap, usedUsdc),
    transfersInWindow: count,
    latestLedger,
    onchainAttached,
    authorised: true,
  };
}

/** Builds the policy's `set_spending_limit` call (through the smart account) for passkey signing in the browser. */
export async function buildSetCapTx(ctx: KitCtx, p: { ruleId: number; dailyCapUsdc: string }) {
  const kit = await getKitFor(ctx);
  const rule = await getRule(ctx, p.ruleId);
  const tx = await kit.policyClients.spendingLimit(SMART_ACCOUNT.spendingLimitPolicy).setSpendingLimit(usdcToStroops(p.dailyCapUsdc), rule);
  return { kit, tx };
}

export interface UpdateCapResult {
  ruleId: number;
  txHash: string;
  method: "set_spending_limit" | "recreate_rule";
  dailyCapUsdc: string;
}

/** Legacy demo (local owner key): set the cap in place, or recreate the rule as a fallback. */
export async function updateDailyCap(ctx: PolicyCtx, p: { dailyCapUsdc: string; ruleId?: number }): Promise<UpdateCapResult> {
  const id = p.ruleId ?? ctx.agentRuleId;
  if (id === undefined || id === null) throw new Error("agent rule missing");
  const kit = await getKitFor(ctx);
  try {
    const { tx } = await buildSetCapTx(ctx, { ruleId: id, dailyCapUsdc: p.dailyCapUsdc });
    const res = await kit.multiSigners.adminOperation(tx, await ownerSelected(kit), { resolveContextRuleIds: () => [0], forceMethod: "rpc" });
    const { hash } = unwrapResult(res, "set_spending_limit");
    log.info({ ruleId: id, hash, cap: p.dailyCapUsdc }, "cap updated in place");
    return { ruleId: id, txHash: hash, method: "set_spending_limit", dailyCapUsdc: p.dailyCapUsdc };
  } catch (err) {
    log.warn({ err: (err as Error).message }, "set_spending_limit failed; recreating the rule");
    await removeRule(ctx, id);
    const created = await addAgentRule(ctx, { agentPublicKey: ctx.agentPub, capUsdc: p.dailyCapUsdc });
    return { ruleId: created.ruleId, txHash: created.txHash, method: "recreate_rule", dailyCapUsdc: p.dailyCapUsdc };
  }
}
