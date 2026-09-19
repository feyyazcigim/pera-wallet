import { childLogger, derivedKeys, loadEnv, stellarContractUrl, submitSignedXdr, USDC_SAC } from "@pera/core";
import { describeDefindexError, getDefindex, NET, throttled } from "./client";

const log = childLogger("yield.vault");

export interface VaultInfo {
  vaultId: string;
  name: string;
  symbol: string;
  assets: string[];
  roles: Record<string, string>;
  feesBps: unknown;
  totalManagedFunds: unknown;
  apy: number | null;
  explorerUrl: string;
}

export async function getVaultInfo(vaultId: string): Promise<VaultInfo> {
  const sdk = getDefindex();
  const info = await throttled(() => sdk.getVaultInfo(vaultId, NET));
  return {
    vaultId,
    name: info.name,
    symbol: info.symbol,
    assets: (info.assets ?? []).map((a) => (a as { address: string }).address),
    roles: info.roles as unknown as Record<string, string>,
    feesBps: info.feesBps,
    totalManagedFunds: info.totalManagedFunds,
    apy: typeof info.apy === "number" && Number.isFinite(info.apy) ? info.apy : null,
    explorerUrl: stellarContractUrl(vaultId),
  };
}

export interface ResolveVaultResult {
  vaultId: string;
  created: boolean;
  txHash?: string;
  explorerUrl: string;
  vaultAsset: string;
}

/**
 * Reuses `VAULT_ID` when it exists and is denominated in our USDC; otherwise deploys a new DeFindex
 * vault on the Circle/anchor USDC SAC through the factory (owner G = manager / fee receiver / caller).
 * No Blend strategy exists for this asset on testnet, so the asset is registered with an empty
 * strategy set (accepted by the vault contract; deposits stay idle = zero yield on testnet).
 */
export async function resolveOrCreateVault(p: { ownerSecret: string; sponsorSecret?: string }): Promise<ResolveVaultResult> {
  const env = loadEnv();
  const { ownerPub } = derivedKeys(env);
  if (env.VAULT_ID) {
    try {
      const info = await getVaultInfo(env.VAULT_ID);
      if (info.assets[0] === USDC_SAC) {
        return { vaultId: env.VAULT_ID, created: false, explorerUrl: info.explorerUrl, vaultAsset: info.assets[0] };
      }
      log.warn({ vault: env.VAULT_ID, asset: info.assets[0] }, "configured vault is not denominated in our USDC; creating a new one");
    } catch (err) {
      log.warn({ err: describeDefindexError(err) }, "configured VAULT_ID unreadable; creating a new vault");
    }
  }
  const sdk = getDefindex();
  let res;
  try {
    res = await throttled(() =>
      sdk.createVault(
        {
          caller: ownerPub,
          roles: { emergencyManager: ownerPub, rebalanceManager: ownerPub, feeReceiver: ownerPub, manager: ownerPub },
          vaultFeeBps: 2000,
          name: "Pera USDC Vault",
          symbol: "pUSDC",
          assets: [{ address: USDC_SAC, strategies: [] }],
          upgradable: true,
        },
        NET,
      ),
    );
  } catch (err) {
    throw new Error(`DeFindex createVault failed: ${describeDefindexError(err)}`);
  }
  if (!res.xdr) throw new Error(`DeFindex returned no XDR for createVault: ${JSON.stringify(res).slice(0, 300)}`);
  const tx = await submitSignedXdr({ xdr: res.xdr, signerSecrets: [p.ownerSecret] });
  const vaultId = extractVaultId(tx.returnValue);
  if (!vaultId) throw new Error(`could not read the new vault id from the factory return value: ${JSON.stringify(tx.returnValue)}`);
  log.info({ vaultId, hash: tx.hash }, "vault created");
  return { vaultId, created: true, txHash: tx.hash, explorerUrl: stellarContractUrl(vaultId), vaultAsset: USDC_SAC };
}

function extractVaultId(v: unknown): string | undefined {
  if (typeof v === "string" && v.startsWith("C")) return v;
  if (v && typeof v === "object") {
    for (const x of Object.values(v as Record<string, unknown>)) {
      const found = extractVaultId(x);
      if (found) return found;
    }
  }
  return undefined;
}
