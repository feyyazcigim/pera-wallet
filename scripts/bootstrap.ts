/**
 * One-shot, idempotent environment bootstrap (safe to re-run; every step skips when satisfied).
 *   pnpm bootstrap
 *
 * 1. friendbot-fund owner / agent / sponsor      5. on-ramp TRY so the owner holds ≥ 30 USDC
 * 2. USDC trustlines (owner, agent)               6. fund the smart account with 15 USDC
 * 3. deploy the smart account + agent rule        7. auto-deposit idle USDC into the vault
 * 4. resolve / create the DeFindex vault          8. pre-bridge 2 USDC to Base Sepolia (if ETH available)
 */
import { cmpUsdc, derivedKeys, getBalances, loadEnv, reloadEnv, stellarAccountUrl, stellarContractUrl } from "@pera/core";
import { autoDeposit, isConfigured, resolveOrCreateVault } from "@pera/yield";
import { bridgeToBase, getBaseUsdcBalance } from "@pera/cctp";
import { ensureAppWallet } from "@pera/evm";
import { ensureFloat } from "@pera/x402-router";
import { legacyContext } from "@pera/smart-account";
import { appendDeployment, upsertEnv } from "./lib/deployments";
import { ensureAgentRule, ensureKeysFunded, ensureOwnerUsdc, ensureSmartAccount, ensureSmartAccountUsdc, ensureTrustlines, say } from "./lib/steps";

let env = loadEnv();
const keys = derivedKeys(env);
console.log(`owner ${keys.ownerPub}\nagent ${keys.agentPub}\nsponsor ${keys.sponsorPub}`);

say("1/8 fund Stellar keys (friendbot)");
await ensureKeysFunded(env);

say("2/8 USDC trustlines");
await ensureTrustlines(env);

say("3/8 smart account + agent spending-cap rule");
await ensureSmartAccount(env);
env = reloadEnv();
await ensureAgentRule(env);
env = reloadEnv();

say("4/8 DeFindex vault");
if (!isConfigured()) {
  console.log("  ⚠ DEFINDEX_API_KEY not set — skipping vault creation (no yield until a key is added; nothing is mocked).");
} else {
  const v = await resolveOrCreateVault({ ownerSecret: env.OWNER_SECRET!, sponsorSecret: env.SPONSOR_SECRET });
  if (v.created || env.VAULT_ID !== v.vaultId) {
    upsertEnv("VAULT_ID", v.vaultId);
    appendDeployment({ kind: "vault", label: "DeFindex vault on Circle USDC (Pera USDC Vault / pUSDC, 20% of yield to owner)", id: v.vaultId, txHash: v.txHash, network: "stellar:testnet", url: v.explorerUrl, notes: "no Blend strategy for this asset on testnet: idle-only vault" });
    env = reloadEnv();
  }
  console.log(`  vault ${v.vaultId} (${v.created ? "created" : "reused"}) ${stellarContractUrl(v.vaultId)}`);
}

say("5/8 on-ramp TRY → USDC (owner ≥ 30 USDC)");
await ensureOwnerUsdc("30", env);

say("6/8 fund the smart account (≥ 15 USDC)");
await ensureSmartAccountUsdc("15", env);

say("7/8 auto-deposit idle USDC into the vault");
const auto = await autoDeposit(legacyContext());
console.log(auto.deposited ? `  deposited ${auto.deposited} USDC (${auto.txHash})` : `  skipped: ${auto.skipped}`);
if (auto.deposited && auto.txHash) appendDeployment({ kind: "tx", label: `autopilot deposit ${auto.deposited} USDC`, id: env.VAULT_ID, txHash: auto.txHash, network: "stellar:testnet", url: `https://stellar.expert/explorer/testnet/tx/${auto.txHash}` });

say("8/8 pre-bridge 2 USDC to Base Sepolia via CCTP (legacy demo Privy wallet)");
{
  const evmWallet = await ensureAppWallet("legacy-demo");
  const usdc = await getBaseUsdcBalance(evmWallet.address);
  if (cmpUsdc(usdc, "1") >= 0) console.log(`  skipped: ${evmWallet.address} already holds ${usdc} USDC`);
  else {
    const lc = legacyContext();
    await ensureFloat(lc, { neededUsdc: "2" });
    const b = await bridgeToBase({ userId: lc.userId, agentSecret: lc.agentSecret, agentPub: lc.agentPub, evmWallet }, { amountUsdc: "2", onProgress: (m) => console.log(`    ${m}`) });
    appendDeployment({ kind: "tx", label: `CCTP burn ${b.amountUsdc} USDC (Stellar → Base Sepolia)`, id: keys.agentPub, txHash: b.burnTxHash, network: "stellar:testnet", url: b.burnExplorerUrl });
    appendDeployment({ kind: "tx", label: `CCTP mint ${b.amountUsdc} USDC on Base Sepolia (Privy sponsored)`, id: evmWallet.address, txHash: b.mintTxHash, network: "eip155:84532", url: b.mintExplorerUrl });
    console.log(`  bridged ${b.amountUsdc} USDC → Base balance ${b.baseUsdcAfter}`);
  }
}

env = reloadEnv();
const bal = await getBalances(keys.ownerPub);
console.log(`
Done.
  SMART_ACCOUNT_ID=${env.SMART_ACCOUNT_ID}  ${stellarContractUrl(env.SMART_ACCOUNT_ID ?? "")}
  AGENT_RULE_ID=${env.AGENT_RULE_ID}
  VAULT_ID=${env.VAULT_ID ?? "(not created)"}
  owner USDC ${bal.usdc}  ${stellarAccountUrl(keys.ownerPub)}
Copy SMART_ACCOUNT_ID / AGENT_RULE_ID / VAULT_ID into the Dokploy environment of the api app.
`);
