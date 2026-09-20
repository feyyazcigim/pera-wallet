import { Keypair } from "@stellar/stellar-sdk";
import { createCallContractContext, createEd25519Signer as createKitEd25519Signer } from "smart-account-kit";
import { addUsdc, childLogger, cmpUsdc, events, getContractUsdcBalance, loadEnv, SMART_ACCOUNT, sponsorPublicKey, stellarTxUrl, subUsdc, usdcToKitNumber, USDC_SAC, withAccountLock, type UserWalletContext } from "@pera/core";
import { decodeKitError, SmartAccountOpError } from "./errors";
import { getKitFor, ownerSelected, selectSigners, unwrapResult } from "./kit";
import type { KitCtx } from "./rules";

const log = childLogger("smart-account.sweep");

/** ≤ 20 UTF-8 bytes (contract limit). */
export const SWEEP_RULE_NAME = "treasury-sweep";

/**
 * "Money sent to the wallet goes to work": a second context rule on the smart account, `CallContract(USDC_SAC)`
 * with one server-held Ed25519 signer and no policy, lets the API move idle USDC from the smart account to the
 * user's treasury (and from there into the vault) without a passkey prompt. It is added by the installer during
 * sign-up, or later by the owner (POST /agent/sweep/build → passkey → POST /agent/sweep).
 */
export async function buildSweepRuleTx(ctx: KitCtx, sweeperPublicKey: string) {
  const kit = await getKitFor(ctx);
  const signer = createKitEd25519Signer(SMART_ACCOUNT.ed25519Verifier, Keypair.fromPublicKey(sweeperPublicKey).rawPublicKey());
  const tx = await kit.rules.add(createCallContractContext(USDC_SAC), SWEEP_RULE_NAME, [signer], new Map<string, unknown>());
  return { kit, tx };
}

/** Sign-up path: the installer co-signer (rule 0) submits it. */
export async function addSweepRule(ctx: KitCtx, sweeperPublicKey: string): Promise<{ ruleId: number; txHash: string }> {
  const { kit, tx } = await buildSweepRuleTx(ctx, sweeperPublicKey);
  const res = await kit.multiSigners.adminOperation(tx, await ownerSelected(kit), { resolveContextRuleIds: () => [0], forceMethod: "rpc" });
  const { hash } = unwrapResult(res, "add_context_rule(treasury-sweep)");
  const ruleId = await findSweepRuleId(ctx);
  if (ruleId === null) throw new Error("treasury-sweep rule not found after add_context_rule");
  log.info({ ruleId, hash }, "sweep rule created");
  return { ruleId, txHash: hash };
}

/** Highest-id rule named `treasury-sweep`, or null. */
export async function findSweepRuleId(ctx: KitCtx): Promise<number | null> {
  const kit = await getKitFor(ctx);
  const rules = await kit.rules.list();
  const mine = rules.filter((r) => r.name === SWEEP_RULE_NAME).sort((a, b) => b.id - a.id);
  return mine[0]?.id ?? null;
}

export type SweepCtx = Pick<UserWalletContext, "userId" | "smartAccountId" | "agentSecret" | "treasuryPub" | "dailyCapUsdc">;

export interface SweepResult {
  swept?: string;
  txHash?: string;
  explorerUrl?: string;
  /** smart account USDC after the sweep (or now, when skipped) */
  smartAccountUsdc: string;
  skipped?: string;
}

/**
 * Moves everything above `keepUsdc` (default: the agent's daily cap, so one day of budget stays on hand) from the
 * smart account to the treasury, signed by the sweeper key under the `treasury-sweep` rule. SPONSOR pays the fee.
 */
export async function sweepToTreasury(ctx: SweepCtx, p: { sweeperSecret: string; ruleId: number; keepUsdc?: string; minUsdc?: string }): Promise<SweepResult> {
  const balance = await getContractUsdcBalance(ctx.smartAccountId);
  const keep = p.keepUsdc ?? ctx.dailyCapUsdc;
  const min = p.minUsdc ?? "1";
  if (cmpUsdc(balance, addUsdc(keep, min)) < 0) return { smartAccountUsdc: balance, skipped: `smart account ${balance} ≤ keep ${keep} + min ${min}` };
  const amount = subUsdc(balance, keep);
  const kit = await getKitFor(ctx);
  const rule = (await kit.rules.get(p.ruleId)).result;
  // the kit is cached per smart account with the agent key only; register the sweeper key when it is missing
  if (kit.multiSigners.buildSelectedSigners(rule.signers).length !== rule.signers.length) kit.externalSigners.addEd25519FromSecret(p.sweeperSecret);
  const selected = selectSigners(kit, rule.signers, `sweep rule ${p.ruleId}`);
  return withAccountLock(sponsorPublicKey(loadEnv()), async () => {
    const res = await kit.multiSigners.transfer(USDC_SAC, ctx.treasuryPub, usdcToKitNumber(amount), selected, { resolveContextRuleIds: () => [p.ruleId], forceMethod: "rpc" });
    if (!res.success) {
      const d = decodeKitError(res.error);
      throw new SmartAccountOpError(`sweep failed: ${d.message}`, d);
    }
    events.emit({ type: "treasury.swept", userId: ctx.userId, amountUsdc: amount, network: "stellar:testnet", txHash: res.hash, explorerUrl: stellarTxUrl(res.hash), detail: { ruleId: p.ruleId, keepUsdc: keep, to: ctx.treasuryPub } });
    log.info({ userId: ctx.userId, amount, hash: res.hash }, "idle USDC swept from the smart account to the treasury");
    return { swept: amount, txHash: res.hash, explorerUrl: stellarTxUrl(res.hash), smartAccountUsdc: keep };
  });
}
