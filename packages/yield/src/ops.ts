import { childLogger, events, loadEnv, stellarContractUrl, stroopsToUsdc, submitSignedXdr, usdcToStroops, withAccountLock, type TxResult, type UserWalletContext } from "@pera/core";
import { describeDefindexError, getDefindex, NET, throttled } from "./client";

const log = childLogger("yield.ops");

export type YieldCtx = Pick<UserWalletContext, "userId" | "treasurySecret" | "treasuryPub">;

export function vaultId(): string {
  const id = loadEnv().VAULT_ID;
  if (!id) throw new Error("VAULT_ID missing — run `pnpm bootstrap` with DEFINDEX_API_KEY set");
  return id;
}

export interface YieldTx extends TxResult {
  amountUsdc: string;
  vaultId: string;
}

/** Deposit from the user's treasury G-account (DeFindex builds the XDR; SPONSOR pays the fee). */
export async function deposit(ctx: YieldCtx, p: { amountUsdc: string }): Promise<YieldTx> {
  const env = loadEnv();
  const vault = vaultId();
  const sdk = getDefindex();
  return withAccountLock(ctx.treasuryPub, async () => {
    let built;
    try {
      built = await throttled(() => sdk.depositToVault(vault, { caller: ctx.treasuryPub, amounts: [Number(usdcToStroops(p.amountUsdc))], invest: true, slippageBps: 50 }, NET));
    } catch (err) {
      throw new Error(`DeFindex deposit build failed: ${describeDefindexError(err)}`);
    }
    if (!built.xdr) throw new Error("DeFindex returned no XDR for deposit");
    const tx = await submitSignedXdr({ xdr: built.xdr, signerSecrets: [ctx.treasurySecret], sponsorSecret: env.SPONSOR_SECRET });
    invalidate(ctx.userId);
    events.emit({ type: "yield.deposited", userId: ctx.userId, amountUsdc: p.amountUsdc, network: "stellar:testnet", txHash: tx.hash, explorerUrl: tx.explorerUrl, detail: { vaultId: vault } });
    log.info({ userId: ctx.userId, amountUsdc: p.amountUsdc, hash: tx.hash }, "deposited");
    return { ...tx, amountUsdc: p.amountUsdc, vaultId: vault };
  });
}

/** Instant withdrawal to the user's treasury G-account. */
export async function withdraw(ctx: YieldCtx, p: { amountUsdc: string }): Promise<YieldTx> {
  const env = loadEnv();
  const vault = vaultId();
  const sdk = getDefindex();
  return withAccountLock(ctx.treasuryPub, async () => {
    let built;
    try {
      built = await throttled(() => sdk.withdrawFromVault(vault, { caller: ctx.treasuryPub, amounts: [Number(usdcToStroops(p.amountUsdc))], slippageBps: 50 }, NET));
    } catch (err) {
      throw new Error(`DeFindex withdraw build failed: ${describeDefindexError(err)}`);
    }
    if (!built.xdr) throw new Error("DeFindex returned no XDR for withdraw");
    const tx = await submitSignedXdr({ xdr: built.xdr, signerSecrets: [ctx.treasurySecret], sponsorSecret: env.SPONSOR_SECRET });
    invalidate(ctx.userId);
    events.emit({ type: "yield.withdrawn", userId: ctx.userId, amountUsdc: p.amountUsdc, network: "stellar:testnet", txHash: tx.hash, explorerUrl: tx.explorerUrl, detail: { vaultId: vault } });
    log.info({ userId: ctx.userId, amountUsdc: p.amountUsdc, hash: tx.hash }, "withdrawn");
    return { ...tx, amountUsdc: p.amountUsdc, vaultId: vault };
  });
}

export interface Position {
  vaultId: string;
  owner: string;
  dfTokens: string;
  underlyingUsdc: string;
  apy: number | null;
  explorerUrl: string;
  cachedAt: string;
}

const cache = new Map<string, { at: number; value: Position }>();
const invalidate = (userId: string) => cache.delete(userId);

/** User's vault position (30 s cache to respect the API rate limit). */
export async function getPosition(ctx: YieldCtx, opts: { fresh?: boolean } = {}): Promise<Position> {
  const hit = cache.get(ctx.userId);
  if (!opts.fresh && hit && Date.now() - hit.at < 30_000) return hit.value;
  const vault = vaultId();
  const sdk = getDefindex();
  // DeFindex simulates the share → asset conversion; on an empty vault (total supply 0) or for an address without
  // shares the contract answers VaultErrors.AmountOverTotalSupply (#124) — that is simply a zero position.
  let bal: { dfTokens?: unknown; underlyingBalance?: unknown } = { dfTokens: 0, underlyingBalance: [0] };
  try {
    bal = (await throttled(() => sdk.getVaultBalance(vault, ctx.treasuryPub, NET))) as typeof bal;
  } catch (err) {
    const msg = describeDefindexError(err);
    if (!/AmountOverTotalSupply|errorCode[^0-9]*124/.test(msg)) throw new Error(`DeFindex balance failed: ${msg}`);
  }
  let apy: number | null = null;
  try {
    const a = await throttled(() => sdk.getVaultAPY(vault, NET));
    apy = typeof a.apy === "number" && Number.isFinite(a.apy) ? a.apy : null;
  } catch {
    apy = null;
  }
  const underlying = Array.isArray(bal.underlyingBalance) ? (bal.underlyingBalance[0] ?? 0) : 0;
  const value: Position = {
    vaultId: vault,
    owner: ctx.treasuryPub,
    dfTokens: String(bal.dfTokens ?? 0),
    underlyingUsdc: stroopsToUsdc(BigInt(Math.round(Number(underlying)))),
    apy,
    explorerUrl: stellarContractUrl(vault),
    cachedAt: new Date().toISOString(),
  };
  cache.set(ctx.userId, { at: Date.now(), value });
  return value;
}
