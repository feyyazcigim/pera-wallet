import { Keypair } from "@stellar/stellar-sdk";
import { createCallContractContext, createEd25519Signer as createKitEd25519Signer, createSpendingLimitParams, type ContextRule } from "smart-account-kit";
import { childLogger, SMART_ACCOUNT, stellarTxUrl, USDC_SAC, usdcToStroops } from "@pera/core";
import { getKit, ownerSelected, unwrapResult } from "./kit";

const log = childLogger("smart-account.rules");

/** ≤ 20 UTF-8 bytes (contract limit). */
export const AGENT_RULE_NAME = "agent-usdc-float";

export interface AgentRuleResult {
  ruleId: number;
  txHash: string;
  explorerUrl: string;
  capUsdc: string;
  periodLedgers: number;
}

/**
 * Adds the agent's context rule: `CallContract(USDC_SAC)` with the agent's Ed25519 signer and a
 * `spending_limit` policy (cap in stroops per rolling ~24 h). Signer and policy must be created in
 * the same call because the policy's `install()` requires a CallContract rule.
 */
export async function addAgentRule(p: { agentPublicKey: string; capUsdc: string }): Promise<AgentRuleResult> {
  const kit = await getKit();
  const agentSigner = createKitEd25519Signer(SMART_ACCOUNT.ed25519Verifier, Keypair.fromPublicKey(p.agentPublicKey).rawPublicKey());
  const params = kit.convertPolicyParams(
    "spending_limit",
    createSpendingLimitParams(usdcToStroops(p.capUsdc), SMART_ACCOUNT.ledgersPerDay),
  );
  const policies = new Map<string, unknown>([[SMART_ACCOUNT.spendingLimitPolicy, params]]);
  const before = await kit.rules.count();

  const tx = await kit.rules.add(createCallContractContext(USDC_SAC), AGENT_RULE_NAME, [agentSigner], policies);
  const res = await kit.multiSigners.adminOperation(tx, await ownerSelected(kit), {
    resolveContextRuleIds: () => [0],
    forceMethod: "rpc",
  });
  const { hash } = unwrapResult(res, "add_context_rule");

  // Rule ids are a monotonic counter: the new rule is `count - 1`. Verify by name.
  const after = await kit.rules.count();
  let ruleId = after - 1;
  if (after !== before + 1) {
    const found = await findAgentRuleId();
    if (found === null) throw new Error(`rule count moved ${before} → ${after}; could not identify the new rule`);
    ruleId = found;
  }
  const { result } = await kit.rules.get(ruleId);
  if (result.name !== AGENT_RULE_NAME) throw new Error(`rule ${ruleId} is named "${result.name}", expected "${AGENT_RULE_NAME}"`);
  log.info({ ruleId, hash }, "agent rule created");
  return { ruleId, txHash: hash, explorerUrl: stellarTxUrl(hash), capUsdc: p.capUsdc, periodLedgers: SMART_ACCOUNT.ledgersPerDay };
}

/** Highest-id active rule named `agent-usdc-float`, or null. */
export async function findAgentRuleId(): Promise<number | null> {
  const kit = await getKit();
  const rules = await kit.rules.list();
  const mine = rules.filter((r) => r.name === AGENT_RULE_NAME).sort((a, b) => b.id - a.id);
  return mine[0]?.id ?? null;
}

export async function getRule(ruleId: number): Promise<ContextRule> {
  const kit = await getKit();
  return (await kit.rules.get(ruleId)).result;
}

export async function removeRule(ruleId: number): Promise<{ txHash: string }> {
  const kit = await getKit();
  const tx = await kit.rules.remove(ruleId);
  const res = await kit.multiSigners.adminOperation(tx, await ownerSelected(kit), { resolveContextRuleIds: () => [0], forceMethod: "rpc" });
  const { hash } = unwrapResult(res, "remove_context_rule");
  log.info({ ruleId, hash }, "rule removed");
  return { txHash: hash };
}
