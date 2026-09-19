import { addUsdc, childLogger, cmpUsdc, getBalances, loadEnv, subUsdc } from "@pera/core";
import { isConfigured } from "./client";
import { deposit, getPosition, withdraw, type YieldCtx } from "./ops";

const log = childLogger("yield.autopilot");

export interface AutoDepositResult {
  deposited?: string;
  txHash?: string;
  treasuryUsdc: string;
  skipped?: string;
}

/** Deposit everything above the reserve from the user's treasury into the vault. */
export async function autoDeposit(ctx: YieldCtx, p: { reserveUsdc?: string; minDepositUsdc?: string } = {}): Promise<AutoDepositResult> {
  const env = loadEnv();
  const treasuryUsdc = (await getBalances(ctx.treasuryPub)).usdc;
  if (!isConfigured() || !env.VAULT_ID) return { treasuryUsdc, skipped: "no DEFINDEX_API_KEY / VAULT_ID" };
  const reserve = p.reserveUsdc ?? env.YIELD_RESERVE_USDC;
  const minDeposit = p.minDepositUsdc ?? "1";
  if (cmpUsdc(treasuryUsdc, addUsdc(reserve, minDeposit)) < 0) return { treasuryUsdc, skipped: `idle ${treasuryUsdc} ≤ reserve ${reserve} + min ${minDeposit}` };
  const idle = subUsdc(treasuryUsdc, reserve);
  const tx = await deposit(ctx, { amountUsdc: idle });
  log.info({ userId: ctx.userId, idle, hash: tx.hash }, "auto-deposited idle USDC");
  return { deposited: idle, txHash: tx.hash, treasuryUsdc: subUsdc(treasuryUsdc, idle) };
}

export interface LiquidityResult {
  withdrewUsdc?: string;
  txHash?: string;
  treasuryUsdcAfter: string;
}

/** Ensures the user's treasury holds `neededUsdc` by withdrawing the shortfall from the vault (instant). */
export async function ensureLiquidity(ctx: YieldCtx, p: { neededUsdc: string; bufferUsdc?: string }): Promise<LiquidityResult> {
  const env = loadEnv();
  const before = (await getBalances(ctx.treasuryPub)).usdc;
  if (cmpUsdc(before, p.neededUsdc) >= 0) return { treasuryUsdcAfter: before };
  if (!isConfigured() || !env.VAULT_ID) throw new Error(`treasury holds ${before} USDC < ${p.neededUsdc} needed and no vault is configured to draw from`);
  const shortfall = addUsdc(subUsdc(p.neededUsdc, before), p.bufferUsdc ?? "0.5");
  const pos = await getPosition(ctx, { fresh: true });
  if (cmpUsdc(pos.underlyingUsdc, shortfall) < 0) throw new Error(`insufficient liquidity: need ${shortfall} USDC from the vault but position is ${pos.underlyingUsdc} USDC`);
  const tx = await withdraw(ctx, { amountUsdc: shortfall });
  const after = (await getBalances(ctx.treasuryPub)).usdc;
  if (cmpUsdc(after, p.neededUsdc) < 0) throw new Error(`treasury still short after vault withdrawal: ${after} < ${p.neededUsdc}`);
  return { withdrewUsdc: shortfall, txHash: tx.hash, treasuryUsdcAfter: after };
}

/** Background loop over all users (the API supplies the contexts); returns a stop function. */
export function startAutopilot(listContexts: () => Promise<YieldCtx[]>, p: { intervalMs?: number } = {}): () => void {
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      for (const ctx of await listContexts()) {
        try {
          const r = await autoDeposit(ctx);
          if (r.deposited) log.info({ userId: ctx.userId, ...r }, "autopilot deposit");
        } catch (err) {
          log.warn({ userId: ctx.userId, err: (err as Error).message }, "autopilot deposit failed");
        }
      }
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
