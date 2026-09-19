/**
 * Checkpoint 4: x402 payments through the router.
 *   pnpm smoke:pay [--stellar-only]
 * Requires the resource server (pnpm dev:rs) reachable at RESOURCE_SERVER_URL.
 */
import { getBalances, derivedKeys, loadEnv, stellarContractUrl } from "@pera/core";
import { payFor } from "@pera/x402-router";
import { getBaseUsdcBalance } from "@pera/cctp";
import { ensureAppWallet } from "@pera/evm";
import { legacyContext } from "@pera/smart-account";
import { appendDeployment } from "./lib/deployments";
import { say } from "./lib/steps";

const env = loadEnv();
const rs = env.RESOURCE_SERVER_URL.replace(/\/$/, "");
const stellarOnly = process.argv.includes("--stellar-only");
const { agentPub } = derivedKeys(env);
const evmWallet = await ensureAppWallet("legacy-demo");
const ctx = { ...legacyContext(), evmWallet };

const health = await fetch(`${rs}/health`).then((r) => r.json() as Promise<{ routes: string[]; payToStellar: string; payToEvm?: string }>);
console.log(`resource server ${rs} routes ${health.routes.join(", ")}`);
console.log(`float (agent) USDC before: ${(await getBalances(agentPub)).usdc}`);

say("1/3 pay the Stellar paywall (native x402, agent float pays, facilitator sponsors fees)");
const a = await payFor(ctx, `${rs}/api/stellar/weather`);
console.log(`  paid ${a.amountUsdc} USDC on ${a.network} → tx ${a.txHash}\n  ${a.explorerUrl}`);
console.log(`  float plan: ${JSON.stringify(a.float)}`);
console.log(`  body: ${JSON.stringify(a.body)}`);
appendDeployment({ kind: "tx", label: `x402 payment ${a.amountUsdc} USDC (stellar:testnet) for ${a.url}`, id: agentPub, txHash: a.txHash, network: "stellar:testnet", url: a.explorerUrl, notes: `payTo ${a.payTo}` });

say("2/3 dual-network paywall — router should prefer Stellar");
const c = await payFor(ctx, `${rs}/api/any/quote`);
console.log(`  offers ${JSON.stringify(c.offers)} → paid on ${c.network} tx ${c.txHash}\n  ${c.explorerUrl}\n  body: ${JSON.stringify(c.body)}`);
appendDeployment({ kind: "tx", label: `x402 payment ${c.amountUsdc} USDC (dual-offer route, Stellar chosen)`, id: agentPub, txHash: c.txHash, network: "stellar:testnet", url: c.explorerUrl });

if (stellarOnly || !health.payToEvm) {
  console.log("\n(skipping Base Sepolia leg)");
} else {
  say("3/3 pay the Base Sepolia paywall (CCTP bridge if the Base balance is short)");
  const usdc = await getBaseUsdcBalance(evmWallet.address);
  console.log(`  legacy demo Privy wallet ${evmWallet.address}: ${usdc} USDC (gas sponsored by Privy)`);
  {
    const b = await payFor(ctx, `${rs}/api/base/summary`);
    console.log(`  paid ${b.amountUsdc} USDC on ${b.network} → tx ${b.txHash}\n  ${b.explorerUrl}`);
    if (b.bridged) console.log(`  bridged ${b.bridged.amountUsdc} USDC: burn ${b.bridged.burnTxHash} → mint ${b.bridged.mintTxHash}`);
    console.log(`  body: ${JSON.stringify(b.body).slice(0, 200)}`);
    appendDeployment({ kind: "tx", label: `x402 payment ${b.amountUsdc} USDC (eip155:84532) for ${b.url}`, id: health.payToEvm, txHash: b.txHash, network: "eip155:84532", url: b.explorerUrl });
    if (b.bridged) {
      appendDeployment({ kind: "tx", label: `CCTP burn ${b.bridged.amountUsdc} USDC on Stellar`, id: agentPub, txHash: b.bridged.burnTxHash, network: "stellar:testnet", url: `https://stellar.expert/explorer/testnet/tx/${b.bridged.burnTxHash}` });
      appendDeployment({ kind: "tx", label: `CCTP mint ${b.bridged.amountUsdc} USDC on Base Sepolia`, id: health.payToEvm, txHash: b.bridged.mintTxHash, network: "eip155:84532", url: `https://sepolia.basescan.org/tx/${b.bridged.mintTxHash}` });
    }
  }
}
console.log(`\nfloat USDC after: ${(await getBalances(agentPub)).usdc}  (smart account ${stellarContractUrl(env.SMART_ACCOUNT_ID ?? "")})`);
console.log("✔ checkpoint 4 (stellar leg) passed");
