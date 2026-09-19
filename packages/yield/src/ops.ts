import { childLogger, derivedKeys, events, loadEnv, stellarContractUrl, stroopsToUsdc, submitSignedXdr, usdcToStroops, withAccountLock, type TxResult } from "@pera/core";
import { describeDefindexError, getDefindex, NET, throttled } from "./client";

const log = childLogger("yield.ops");

function vaultId(): string {
  const id = loadEnv().VAULT_ID;
  if (!id) throw new Error("VAULT_ID missing — run `pnpm bootstrap` with DEFINDEX_API_KEY set");
  return id;
}

export interface YieldTx extends TxResult {
  amountUsdc: string;
  vaultId: string;
}

/** Deposit from the owner G-account (DeFindex builds the XDR; the key never leaves this process). */
export async function deposit(p: { amountUsdc: string }): Promise<YieldTx> {
  const env = loadEnv();
  const { ownerPub } = derivedKeys(env);
  const vault = vaultId();
  const sdk = getDefindex();
  return withAccountLock(ownerPub, async () => {
    let built;
    try {
      built = await throttled(() =>
        sdk.depositToVault(vault, { caller: ownerPub, amounts: [Number(usdcToStroops(p.amountUsdc))], invest: true, slippageBps: 50 }, NET),
      );
    } catch (err) {
      throw new Error(`DeFindex deposit build failed: ${describeDefindexError(err)}`);
    }
    if (!built.xdr) throw new Error("DeFindex returned no XDR for deposit");
    const tx = await submitSignedXdr({ xdr: built.xdr, signerSecrets: [env.OWNER_SECRET] });
    positionCache = undefined;
    events.emit({ type: "yield.deposited", amountUsdc: p.amountUsdc, network: "stellar:testnet", txHash: tx.hash, explorerUrl: tx.explorerUrl, detail: { vaultId: vault } });
    log.info({ amountUsdc: p.amountUsdc, hash: tx.hash }, "deposited");
    return { ...tx, amountUsdc: p.amountUsdc, vaultId: vault };
  });
}

/** Instant withdrawal to the owner G-account. */
export async function withdraw(p: { amountUsdc: string }): Promise<YieldTx> {
  const env = loadEnv();
  const { ownerPub } = derivedKeys(env);
  const vault = vaultId();
  const sdk = getDefindex();
  return withAccountLock(ownerPub, async () => {
    let built;
    try {
      built = await throttled(() =>
        sdk.withdrawFromVault(vault, { caller: ownerPub, amounts: [Number(usdcToStroops(p.amountUsdc))], slippageBps: 50 }, NET),
      );
    } catch (err) {
      throw new Error(`DeFindex withdraw build failed: ${describeDefindexError(err)}`);
    }
    if (!built.xdr) throw new Error("DeFindex returned no XDR for withdraw");
    const tx = await submitSignedXdr({ xdr: built.xdr, signerSecrets: [env.OWNER_SECRET] });
    positionCache = undefined;
    events.emit({ type: "yield.withdrawn", amountUsdc: p.amountUsdc, network: "stellar:testnet", txHash: tx.hash, explorerUrl: tx.explorerUrl, detail: { vaultId: vault } });
    log.info({ amountUsdc: p.amountUsdc, hash: tx.hash }, "withdrawn");
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

let positionCache: { at: number; value: Position } | undefined;

/** Owner's vault position (30 s cache to respect the API rate limit). */
export async function getPosition(opts: { fresh?: boolean } = {}): Promise<Position> {
  if (!opts.fresh && positionCache && Date.now() - positionCache.at < 30_000) return positionCache.value;
  const env = loadEnv();
  const { ownerPub } = derivedKeys(env);
  const vault = vaultId();
  const sdk = getDefindex();
  const bal = await throttled(() => sdk.getVaultBalance(vault, ownerPub, NET));
  let apy: number | null = null;
  try {
    const a = await throttled(() => sdk.getVaultAPY(vault, NET));
    apy = typeof a.apy === "number" && Number.isFinite(a.apy) ? a.apy : null;
  } catch {
    apy = null; // testnet indexer is frequently unhealthy
  }
  const underlying = Array.isArray(bal.underlyingBalance) ? bal.underlyingBalance[0] ?? 0 : 0;
  const value: Position = {
    vaultId: vault,
    owner: ownerPub,
    dfTokens: String(bal.dfTokens ?? 0),
    underlyingUsdc: stroopsToUsdc(BigInt(Math.round(Number(underlying)))),
    apy,
    explorerUrl: stellarContractUrl(vault),
    cachedAt: new Date().toISOString(),
  };
  positionCache = { at: Date.now(), value };
  return value;
}
