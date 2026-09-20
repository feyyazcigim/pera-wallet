import { childLogger } from "@pera/core";
import { autoDeposit, type AutoDepositResult } from "@pera/yield";
import { loadContext } from "./context";

const log = childLogger("api.autopilot");
const lastSweep = new Map<string, number>();
const DEBOUNCE_MS = 45_000;

/**
 * On-demand sweep of one user's idle treasury USDC into the vault — USDC sent straight to the treasury address shows
 * up here as soon as the user opens the dashboard, instead of waiting for the next background tick. Debounced per
 * user (the dashboard polls /balances every 12 s); `force` skips the debounce (POST /yield/autopilot).
 */
export async function sweepUser(userId: string, opts: { force?: boolean } = {}): Promise<AutoDepositResult | null> {
  const now = Date.now();
  if (!opts.force && now - (lastSweep.get(userId) ?? 0) < DEBOUNCE_MS) return null;
  lastSweep.set(userId, now);
  try {
    const r = await autoDeposit(await loadContext(userId));
    if (r.deposited) log.info({ userId, deposited: r.deposited, txHash: r.txHash }, "swept idle USDC into the vault");
    return r;
  } catch (err) {
    log.warn({ userId, err: (err as Error).message }, "sweep failed");
    if (opts.force) throw err;
    return null;
  }
}
