import { Keypair } from "@stellar/stellar-sdk";
import { createCallContractContext, createEd25519Signer as createKitEd25519Signer, createSpendingLimitParams, type ContextRule } from "smart-account-kit";
import { childLogger, SMART_ACCOUNT, stellarTxUrl, USDC_SAC, usdcToStroops, type UserWalletContext } from "@pera/core";
import { getKitFor, ownerSelected, unwrapResult } from "./kit";

const log = childLogger("smart-account.rules");

/** ≤ 20 UTF-8 bytes (contract limit). */
export const AGENT_RULE_NAME = "agent-usdc-float";

export type KitCtx = Pick<UserWalletContext, "smartAccountId" | "agentSecret"> & { ownerSecret?: string };

export interface AgentRuleResult {
  ruleId: number;
  txHash: string;
  explorerUrl: string;
  capUsdc: string;
  periodLedgers: number;
  weeklyCapUsdc: string | null;
}

/**
 * Builds (but does not submit) the `add_context_rule` transaction for the agent: `CallContract(USDC_SAC)`
 * with the agent's Ed25519 signer and a `spending_limit` policy for the daily window, plus a second one for the
 * weekly window when `weeklyCapUsdc` is given. The browser signs it with the passkey
 * (`kit.signAdmin`) and posts the XDR to `/stellar/submit`; or, in the legacy demo, the local owner key signs.
 */
export async function buildAgentRuleTx(ctx: KitCtx, p: { agentPublicKey: string; capUsdc: string; weeklyCapUsdc?: string | null }) {
  const kit = await getKitFor(ctx);
  const agentSigner = createKitEd25519Signer(SMART_ACCOUNT.ed25519Verifier, Keypair.fromPublicKey(p.agentPublicKey).rawPublicKey());
  const params = kit.convertPolicyParams("spending_limit", createSpendingLimitParams(usdcToStroops(p.capUsdc), SMART_ACCOUNT.ledgersPerDay));
  const policies = new Map<string, unknown>([[SMART_ACCOUNT.spendingLimitPolicy, params]]);
  if (p.weeklyCapUsdc) {
    policies.set(SMART_ACCOUNT.weeklySpendingLimitPolicy, kit.convertPolicyParams("spending_limit", createSpendingLimitParams(usdcToStroops(p.weeklyCapUsdc), SMART_ACCOUNT.ledgersPerWeek)));
  }
  const tx = await kit.rules.add(createCallContractContext(USDC_SAC), AGENT_RULE_NAME, [agentSigner], policies);
  return { kit, tx };
}

/** Legacy demo: owner is a local Ed25519 key, so we can sign and submit here. */
export async function addAgentRule(ctx: KitCtx, p: { agentPublicKey: string; capUsdc: string; weeklyCapUsdc?: string | null }): Promise<AgentRuleResult> {
  const { kit, tx } = await buildAgentRuleTx(ctx, p);
  const before = await kit.rules.count();
  const res = await kit.multiSigners.adminOperation(tx, await ownerSelected(kit), { resolveContextRuleIds: () => [0], forceMethod: "rpc" });
  const { hash } = unwrapResult(res, "add_context_rule");
  const ruleId = await resolveNewRuleId(ctx, before);
  log.info({ ruleId, hash }, "agent rule created");
  return { ruleId, txHash: hash, explorerUrl: stellarTxUrl(hash), capUsdc: p.capUsdc, periodLedgers: SMART_ACCOUNT.ledgersPerDay, weeklyCapUsdc: p.weeklyCapUsdc ?? null };
}

/** After a submitted add_context_rule: rule ids are a monotonic counter, so the new rule is `count - 1`. */
export async function resolveNewRuleId(ctx: KitCtx, countBefore?: number): Promise<number> {
  const kit = await getKitFor(ctx);
  const after = await kit.rules.count();
  const candidate = after - 1;
  const { result } = await kit.rules.get(candidate);
  if (result.name === AGENT_RULE_NAME && (countBefore === undefined || after === countBefore + 1)) return candidate;
  const found = await findAgentRuleId(ctx);
  if (found === null) throw new Error(`could not identify the agent rule (count ${countBefore} → ${after})`);
  return found;
}

/** Highest-id active rule named `agent-usdc-float`, or null. */
export async function findAgentRuleId(ctx: KitCtx): Promise<number | null> {
  const kit = await getKitFor(ctx);
  const rules = await kit.rules.list();
  const mine = rules.filter((r) => r.name === AGENT_RULE_NAME).sort((a, b) => b.id - a.id);
  return mine[0]?.id ?? null;
}

export async function getRule(ctx: KitCtx, ruleId: number): Promise<ContextRule> {
  const kit = await getKitFor(ctx);
  return (await kit.rules.get(ruleId)).result;
}

export async function buildRemoveRuleTx(ctx: KitCtx, ruleId: number) {
  const kit = await getKitFor(ctx);
  return { kit, tx: await kit.rules.remove(ruleId) };
}

/** Legacy demo (local owner key). */
export async function removeRule(ctx: KitCtx, ruleId: number): Promise<{ txHash: string }> {
  const { kit, tx } = await buildRemoveRuleTx(ctx, ruleId);
  const res = await kit.multiSigners.adminOperation(tx, await ownerSelected(kit), { resolveContextRuleIds: () => [0], forceMethod: "rpc" });
  const { hash } = unwrapResult(res, "remove_context_rule");
  log.info({ ruleId, hash }, "rule removed");
  return { txHash: hash };
}

/** Removes a temporary Ed25519 co-signer from rule 0 (signed by that same signer under the threshold policy). */
export async function removeInstallerSigner(ctx: KitCtx, installerPublicKey: string): Promise<{ txHash: string }> {
  const kit = await getKitFor(ctx);
  const signer = createKitEd25519Signer(SMART_ACCOUNT.ed25519Verifier, Keypair.fromPublicKey(installerPublicKey).rawPublicKey());
  const tx = await kit.signers.remove(0, signer);
  const res = await kit.multiSigners.adminOperation(tx, await ownerSelected(kit), { resolveContextRuleIds: () => [0], forceMethod: "rpc" });
  const { hash } = unwrapResult(res, "remove_signer(installer)");
  log.info({ hash }, "installer signer removed; passkey is the sole owner");
  return { txHash: hash };
}
