import { applyVaultId, childLogger, loadEnv } from "@pera/core";
import { getSetting, setSetting } from "@pera/db";
import { getVaultInfo, isConfigured, resolveOrCreateVault } from "@pera/yield";

const log = childLogger("api.vault");
const KEY = "vault_id";

/**
 * Makes the DeFindex vault exist without a manual bootstrap step: with DEFINDEX_API_KEY set and no VAULT_ID in the
 * environment, reuse the id stored in the database or create a vault (sponsor = manager / fee receiver) and store it.
 * Runs in the background at boot; yield routes answer 503 YIELD_UNAVAILABLE until it is done.
 */
export async function provisionVault(): Promise<void> {
  const env = loadEnv();
  if (!isConfigured()) return log.info("DEFINDEX_API_KEY not set — yield disabled");
  if (env.VAULT_ID) return log.info({ vaultId: env.VAULT_ID }, "vault from environment");
  const stored = await getSetting(KEY);
  if (stored) {
    applyVaultId(stored);
    log.info({ vaultId: stored }, "vault from database");
    void getVaultInfo(stored).catch((err: Error) => log.warn({ err: err.message, vaultId: stored }, "stored vault unreadable via DeFindex"));
    return;
  }
  log.info("no vault yet — creating one through the DeFindex factory (sponsor = manager)");
  const v = await resolveOrCreateVault({ ownerSecret: env.SPONSOR_SECRET, sponsorSecret: env.SPONSOR_SECRET });
  await setSetting(KEY, v.vaultId);
  applyVaultId(v.vaultId);
  log.info({ vaultId: v.vaultId, txHash: v.txHash, explorerUrl: v.explorerUrl }, "vault created and stored");
}
