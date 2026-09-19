import { childLogger, cmpUsdc, derivedKeys, getBalances, loadEnv, subUsdc, addUsdc } from "@pera/core";
import { isConfigured } from "./client";
import { deposit, getPosition, withdraw } from "./ops";

const log = childLogger("yield.autopilot");

export interface AutoDepositResult {
  deposited?: string;
  txHash?: string;
  ownerUsdc: string;
  skipped?: string;
}

/**
 * Deposit everything above `reserveUsdc` (default env YIELD_RESERVE_USDC) from the owner G-account
 * into the vault. Runs after each on-ramp and on the API's 60 s interval.
 */
export async function autoDeposit(p: { reserveUsdc?: string; minDepositUsdc?: string } = {}): Promise<AutoDepositResult> {
  const env = loadEnv();
  const { ownerPub } = derivedKeys(env);
  const ownerUsdc = (await getBalances(ownerPub)).usdc;
  if (!isConfigured() || !env.VAULT_ID) return { ownerUsdc, skipped: "no DEFINDEX_API_KEY / VAULT_ID" };
  const reserve = p.reserveUsdc ?? env.YIELD_RESERVE_USDC;
  const minDeposit = p.minDepositUsdc ?? "1";
  if (cmpUsdc(ownerUsdc, addUsdc(reserve, minDeposit)) < 0) return { ownerUsdc, skipped: `idle ${ownerUsdc} ≤ reserve ${reserve} + min ${minDeposit}` };
  const idle = subUsdc(ownerUsdc, reserve);
  const tx = await deposit({ amountUsdc: idle });
  log.info({ idle, hash: tx.hash }, "auto-deposited idle USDC");
  return { deposited: idle, txHash: tx.hash, ownerUsdc: subUsdc(ownerUsdc, idle) };
}

export interface LiquidityResult {
  withdrewUsdc?: string;
  txHash?: string;
  ownerUsdcAfter: string;
}

/**
 * Makes sure the owner G-account holds at least `neededUsdc` by withdrawing the shortfall (plus a
 * small buffer) from the vault. DeFindex withdrawals are synchronous, so this runs inline in the
 * payment path.
 */
export async function ensureLiquidity(p: { neededUsdc: string; bufferUsdc?: string }): Promise<LiquidityResult> {
  const env = loadEnv();
  const { ownerPub } = derivedKeys(env);
  const before = (await getBalances(ownerPub)).usdc;
  if (cmpUsdc(before, p.neededUsdc) >= 0) return { ownerUsdcAfter: before };
  if (!isConfigured() || !env.VAULT_ID) {
    throw new Error(`owner holds ${before} USDC < ${p.neededUsdc} needed and no vault is configured to draw from`);
  }
  const shortfall = addUsdc(subUsdc(p.neededUsdc, before), p.bufferUsdc ?? "0.5");
  const pos = await getPosition({ fresh: true });
  if (cmpUsdc(pos.underlyingUsdc, shortfall) < 0) {
    throw new Error(`insufficient liquidity: need ${shortfall} USDC from the vault but position is ${pos.underlyingUsdc} USDC`);
  }
  const tx = await withdraw({ amountUsdc: shortfall });
  const after = (await getBalances(ownerPub)).usdc;
  if (cmpUsdc(after, p.neededUsdc) < 0) throw new Error(`owner still short after vault withdrawal: ${after} < ${p.neededUsdc}`);
  return { withdrewUsdc: shortfall, txHash: tx.hash, ownerUsdcAfter: after };
}

/** Background loop used by the API; returns a stop function. */
export function startAutopilot(p: { intervalMs?: number } = {}): () => void {
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const r = await autoDeposit();
      if (r.deposited) log.info(r, "autopilot deposit");
    } catch (err) {
      log.warn({ err: (err as Error).message }, "autopilot tick failed");
    } finally {
      inFlight = false;
    }
  };
  const timer = setInterval(tick, p.intervalMs ?? 60_000);
  void tick();
  return () => clearInterval(timer);
}
