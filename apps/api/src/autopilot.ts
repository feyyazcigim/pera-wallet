import { childLogger, loadEnv } from "@pera/core";
import { listStellarWallets } from "@pera/db";
import { sweepToTreasury, type SweepResult } from "@pera/smart-account";
import { autoDeposit, type AutoDepositResult } from "@pera/yield";
import { loadContext } from "./context";
import { deriveSweeper } from "./provisioning";

const log = childLogger("api.autopilot");
const lastSweep = new Map<string, number>();
const DEBOUNCE_MS = 45_000;

export type SweepUserResult = AutoDepositResult & { smartAccount?: SweepResult };

/**
 * Idle money goes to work, wherever it landed: (1) smart account → treasury under the `treasury-sweep` rule (keeps
 * one day of agent budget), (2) treasury → vault above YIELD_RESERVE_USDC. Runs on dashboard open (/balances),
 * every minute in the background, and on demand (POST /yield/autopilot). Debounced per user; `force` skips that.
 */
export async function sweepUser(userId: string, opts: { force?: boolean } = {}): Promise<SweepUserResult | null> {
  const now = Date.now();
  if (!opts.force && now - (lastSweep.get(userId) ?? 0) < DEBOUNCE_MS) return null;
  lastSweep.set(userId, now);
  try {
    const ctx = await loadContext(userId);
    if (ctx.status !== "ready") return null;
    let smartAccount: SweepResult | undefined;
    if (ctx.sweepRuleId !== null) {
      try {
        smartAccount = await sweepToTreasury(ctx, { sweeperSecret: deriveSweeper(ctx.credentialId, loadEnv().WALLET_MASTER_KEY).secret, ruleId: ctx.sweepRuleId });
      } catch (err) {
        log.warn({ userId, err: (err as Error).message }, "smart account sweep failed");
      }
    }
    const r = await autoDeposit(ctx);
    if (r.deposited) log.info({ userId, deposited: r.deposited, txHash: r.txHash }, "swept idle USDC into the vault");
    return { ...r, smartAccount };
  } catch (err) {
    log.warn({ userId, err: (err as Error).message }, "sweep failed");
    if (opts.force) throw err;
    return null;
  }
}

/** Background loop over every ready wallet; returns a stop function. */
export function startAutopilotLoop(intervalMs = 60_000): () => void {
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      for (const w of await listStellarWallets("ready")) await sweepUser(w.userId, { force: true }).catch(() => undefined);
    } catch (err) {
      log.warn({ err: (err as Error).message }, "autopilot tick failed");
    } finally {
      inFlight = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  void tick();
  return () => clearInterval(timer);
}
