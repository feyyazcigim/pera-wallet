/** Completes CCTP bridges whose Base Sepolia mint failed (e.g. no gas at the time).  pnpm bridge:resume */
import { loadEnv } from "@pera/core";
import { getBaseEthBalance, getEvmAddress, listPending, resumePendingBridges } from "@pera/cctp";
import { privateKeyToAccount } from "viem/accounts";
import { appendDeployment } from "./lib/deployments";

const env = loadEnv();
if (!env.EVM_SPONSOR_PRIVATE_KEY) throw new Error("EVM_SPONSOR_PRIVATE_KEY missing");
const relayer = { provider: "local" as const, address: privateKeyToAccount(env.EVM_SPONSOR_PRIVATE_KEY as `0x${string}`).address, secret: env.EVM_SPONSOR_PRIVATE_KEY };
const pending = listPending();
if (pending.length === 0) {
  console.log("no pending bridges");
  process.exit(0);
}
console.log(`${pending.length} pending bridge(s); EVM sponsor ${getEvmAddress()} has ${await getBaseEthBalance()} ETH`);
const results = await resumePendingBridges(async () => relayer, (m) => console.log(`  ${m}`));
for (const r of results) {
  if (r.mintTxHash) {
    console.log(`✔ ${r.amountUsdc} USDC minted on Base: ${r.mintExplorerUrl}`);
    appendDeployment({ kind: "tx", label: `CCTP mint ${r.amountUsdc} USDC on Base Sepolia (resumed; burn ${r.burnTxHash})`, id: getEvmAddress(), txHash: r.mintTxHash, network: "eip155:84532", url: r.mintExplorerUrl });
  } else console.log(`✖ ${r.burnTxHash}: ${r.error?.split("\n")[0]}`);
}
process.exit(results.every((r) => r.mintTxHash) ? 0 : 1);
