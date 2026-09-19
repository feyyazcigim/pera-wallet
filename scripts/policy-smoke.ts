/**
 * Checkpoint 2: smart account + agent spending cap.
 *   pnpm smoke:policy
 * Deploys / reuses the smart account, funds it with 20 USDC, tops the float up by 3 USDC (must succeed),
 * then attempts 15 USDC (must be rejected on-chain by the spending_limit policy, error #3221).
 */
import { derivedKeys, getBalances, loadEnv, reloadEnv, stellarContractUrl } from "@pera/core";
import { attemptOverCap, getPolicyUsage, topUpFloat } from "@pera/smart-account";
import { appendDeployment } from "./lib/deployments";
import { ensureAgentRule, ensureKeysFunded, ensureOwnerUsdc, ensureSmartAccount, ensureSmartAccountUsdc, ensureTrustlines, say } from "./lib/steps";

let env = loadEnv();
say("1/6 fund keys + trustlines");
await ensureKeysFunded(env);
await ensureTrustlines(env);

say("2/6 smart account + agent rule");
await ensureSmartAccount(env);
env = reloadEnv();
await ensureAgentRule(env);
env = reloadEnv();

say("3/6 balances");
await ensureOwnerUsdc("25", env);
await ensureSmartAccountUsdc("20", env);
const { agentPub } = derivedKeys(env);
const floatBefore = (await getBalances(agentPub)).usdc;
console.log(`  float (agent) USDC ${floatBefore}`);
const usage0 = await getPolicyUsage();
console.log(`  policy: cap ${usage0.dailyCapUsdc} USDC, used ${usage0.usedInWindowUsdc}, remaining ${usage0.remainingUsdc}, attached=${usage0.onchainAttached}`);

say("4/6 top up float by 3 USDC (within cap)");
const ok = await topUpFloat({ amountUsdc: "3" });
console.log(`  ✔ ${ok.txHash}\n  ${ok.explorerUrl}`);
appendDeployment({ kind: "tx", label: "agent top-up 3 USDC under spending_limit (succeeds)", id: env.SMART_ACCOUNT_ID, txHash: ok.txHash, network: "stellar:testnet", url: ok.explorerUrl });

say("5/6 attempt 15 USDC (above cap) — must be rejected by the policy contract");
const rejected = await attemptOverCap({ amountUsdc: "15" });
console.log(`  ✔ rejected: #${rejected.errorCode} ${rejected.errorName}`);
console.log(`  policy ${rejected.policyExplorerUrl}`);
console.log(`  detail ${rejected.simulationError.slice(0, 200)}`);
appendDeployment({
  kind: "note",
  label: `agent top-up 15 USDC rejected on-chain: policy error #${rejected.errorCode} ${rejected.errorName}`,
  id: rejected.policyContract,
  network: "stellar:testnet",
  url: rejected.policyExplorerUrl,
  notes: `smart account ${env.SMART_ACCOUNT_ID} rule #${rejected.ruleId}; ${stellarContractUrl(env.SMART_ACCOUNT_ID!)}`,
});

say("6/6 usage after");
const usage1 = await getPolicyUsage();
const floatAfter = (await getBalances(agentPub)).usdc;
console.log(`  float USDC ${floatBefore} → ${floatAfter}`);
console.log(`  policy used ${usage1.usedInWindowUsdc} / ${usage1.dailyCapUsdc} (remaining ${usage1.remainingUsdc}, ${usage1.transfersInWindow} transfers in window)`);
if (Number(floatAfter) - Number(floatBefore) < 2.99) throw new Error("float did not increase by 3 USDC");
console.log("\n✔ checkpoint 2 passed");
