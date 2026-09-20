import { childLogger, getLatestLedger, SMART_ACCOUNT, stellarContractUrl, stroopsToUsdc, subUsdc, usdcToStroops, type UserWalletContext } from "@pera/core";
import { createSpendingLimitParams } from "smart-account-kit";
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
  /** The weekly window, a second spending_limit instance on the same rule. Null when the rule does not carry it. */
  weekly: WeeklyWindowView | null;
}

export interface WeeklyWindowView {
  policyContract: string;
  policyExplorerUrl: string;
  capUsdc: string;
  periodLedgers: number;
  usedInWindowUsdc: string;
  remainingUsdc: string;
  transfersInWindow: number;
}

type PolicyCtx = Pick<UserWalletContext, "smartAccountId" | "agentSecret" | "agentPub" | "agentRuleId" | "dailyCapUsdc"> & { ownerSecret?: string };

/** One spending_limit instance's window for a rule: cap, and what the rolling history adds up to right now. */
async function readWindow(kit: Awaited<ReturnType<typeof getKitFor>>, policy: string, ruleId: number, latestLedger: number) {
  const data = await kit.policyClients.spendingLimit(policy).getSpendingLimitData(ruleId);
  const windowStart = latestLedger - data.period_ledgers;
  let used = 0n;
  let count = 0;
  for (const e of data.spending_history) {
    if (e.ledger_sequence > windowStart) {
      used += BigInt(e.amount);
      count += 1;
    }
  }
  const capUsdc = stroopsToUsdc(BigInt(data.spending_limit));
  const usedInWindowUsdc = stroopsToUsdc(used);
  return { capUsdc, periodLedgers: data.period_ledgers, usedInWindowUsdc, remainingUsdc: used >= BigInt(data.spending_limit) ? "0" : subUsdc(capUsdc, usedInWindowUsdc), transfersInWindow: count };
}

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
    return { ...base, ruleId: null, ruleName: null, dailyCapUsdc: ctx.dailyCapUsdc, usedInWindowUsdc: "0", remainingUsdc: ctx.dailyCapUsdc, transfersInWindow: 0, latestLedger: 0, onchainAttached: false, authorised: false, weekly: null };
  }
  const kit = await getKitFor(ctx);
  const rule = await getRule(ctx, id);
  const onchainAttached = rule.policies.includes(SMART_ACCOUNT.spendingLimitPolicy);
  const latestLedger = await getLatestLedger();
  const weeklyAttached = rule.policies.includes(SMART_ACCOUNT.weeklySpendingLimitPolicy);
  const [daily, weekly] = await Promise.all([
    readWindow(kit, SMART_ACCOUNT.spendingLimitPolicy, id, latestLedger),
    weeklyAttached ? readWindow(kit, SMART_ACCOUNT.weeklySpendingLimitPolicy, id, latestLedger) : null,
  ]);
  return {
    ...base,
    ruleId: id,
    ruleName: rule.name,
    dailyCapUsdc: daily.capUsdc,
    periodLedgers: daily.periodLedgers,
    windowLabel: `rolling ${daily.periodLedgers} ledgers (~${Math.round((daily.periodLedgers * 5) / 3600)} h)`,
    usedInWindowUsdc: daily.usedInWindowUsdc,
    remainingUsdc: daily.remainingUsdc,
    transfersInWindow: daily.transfersInWindow,
    latestLedger,
    onchainAttached,
    authorised: true,
    weekly: weekly && { policyContract: SMART_ACCOUNT.weeklySpendingLimitPolicy, policyExplorerUrl: stellarContractUrl(SMART_ACCOUNT.weeklySpendingLimitPolicy), ...weekly },
  };
}

/** Builds the policy's `set_spending_limit` call (through the smart account) for passkey signing in the browser. */
export async function buildSetCapTx(ctx: KitCtx, p: { ruleId: number; dailyCapUsdc: string }) {
  const kit = await getKitFor(ctx);
  const rule = await getRule(ctx, p.ruleId);
  const tx = await kit.policyClients.spendingLimit(SMART_ACCOUNT.spendingLimitPolicy).setSpendingLimit(usdcToStroops(p.dailyCapUsdc), rule);
  return { kit, tx };
}

/**
 * Weekly window, for passkey signing in the browser. A rule that already carries the weekly policy gets
 * `set_spending_limit`; an older rule (daily only) gets the policy attached with `add_policy`, which starts its window.
 */
export async function buildSetWeeklyCapTx(ctx: KitCtx, p: { ruleId: number; weeklyCapUsdc: string }) {
  const kit = await getKitFor(ctx);
  const rule = await getRule(ctx, p.ruleId);
  const limit = usdcToStroops(p.weeklyCapUsdc);
  if (rule.policies.includes(SMART_ACCOUNT.weeklySpendingLimitPolicy)) {
    return { kit, method: "set_spending_limit" as const, tx: await kit.policyClients.spendingLimit(SMART_ACCOUNT.weeklySpendingLimitPolicy).setSpendingLimit(limit, rule) };
  }
  const params = kit.convertPolicyParams("spending_limit", createSpendingLimitParams(limit, SMART_ACCOUNT.ledgersPerWeek));
  return { kit, method: "add_policy" as const, tx: await kit.policies.add(p.ruleId, SMART_ACCOUNT.weeklySpendingLimitPolicy, params) };
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
