/**
 * Checkpoint 3: DeFindex vault deposit / position / withdraw (requires DEFINDEX_API_KEY).
 *   pnpm smoke:yield
 */
import { derivedKeys, getBalances, loadEnv, reloadEnv, stellarContractUrl } from "@pera/core";
import { deposit, getPosition, getVaultInfo, isConfigured, resolveOrCreateVault, withdraw } from "@pera/yield";
import { legacyContext } from "@pera/smart-account";
import { appendDeployment, upsertEnv } from "./lib/deployments";
import { ensureKeysFunded, ensureOwnerUsdc, ensureTrustlines, say } from "./lib/steps";

let env = loadEnv();
if (!isConfigured()) {
  console.error("DEFINDEX_API_KEY is not set. Create one at https://console.defindex.io → API Keys and add it to .env.");
  process.exit(2);
}

say("1/5 keys, trustlines, owner USDC ≥ 15");
await ensureKeysFunded(env);
await ensureTrustlines(env);
await ensureOwnerUsdc("15", env);

say("2/5 vault");
const v = await resolveOrCreateVault({ ownerSecret: env.OWNER_SECRET!, sponsorSecret: env.SPONSOR_SECRET });
if (v.created || env.VAULT_ID !== v.vaultId) {
  upsertEnv("VAULT_ID", v.vaultId);
  appendDeployment({ kind: "vault", label: "DeFindex vault on Circle USDC (Pera USDC Vault, pUSDC, fee 20% of yield)", id: v.vaultId, txHash: v.txHash, network: "stellar:testnet", url: v.explorerUrl, notes: `asset ${v.vaultAsset}, strategies: none on testnet` });
  env = reloadEnv();
}
const info = await getVaultInfo(v.vaultId);
console.log(`  vault ${v.vaultId} (${v.created ? "created" : "reused"}) ${info.name}/${info.symbol} asset ${info.assets[0]}\n  ${stellarContractUrl(v.vaultId)}`);

const { ownerPub } = derivedKeys(env);
const ctx = legacyContext();
say("3/5 deposit 10 USDC");
const p0 = await getPosition(ctx, { fresh: true });
console.log(`  position before: ${p0.underlyingUsdc} USDC (${p0.dfTokens} shares), apy ${p0.apy ?? "n/a"}`);
const d = await deposit(ctx, { amountUsdc: "10" });
console.log(`  ✔ ${d.hash}\n  ${d.explorerUrl}`);
appendDeployment({ kind: "tx", label: "vault deposit 10 USDC", id: v.vaultId, txHash: d.hash, network: "stellar:testnet", url: d.explorerUrl });
const p1 = await getPosition(ctx, { fresh: true });
console.log(`  position after deposit: ${p1.underlyingUsdc} USDC (${p1.dfTokens} shares)`);

say("4/5 withdraw 4 USDC");
const w = await withdraw(ctx, { amountUsdc: "4" });
console.log(`  ✔ ${w.hash}\n  ${w.explorerUrl}`);
appendDeployment({ kind: "tx", label: "vault withdraw 4 USDC", id: v.vaultId, txHash: w.hash, network: "stellar:testnet", url: w.explorerUrl });
const p2 = await getPosition(ctx, { fresh: true });
console.log(`  position after withdraw: ${p2.underlyingUsdc} USDC (${p2.dfTokens} shares)`);

say("5/5 verify");
console.log(`  owner USDC ${(await getBalances(ownerPub)).usdc}`);
const delta = Number(p1.underlyingUsdc) - Number(p2.underlyingUsdc);
if (Number(p1.underlyingUsdc) < Number(p0.underlyingUsdc) + 9.9) throw new Error("deposit did not increase the position by ~10");
if (delta < 3.9) throw new Error(`withdraw did not decrease the position by ~4 (delta ${delta})`);
console.log("\n✔ checkpoint 3 passed");
