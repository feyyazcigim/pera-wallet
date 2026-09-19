/** Completes CCTP bridges whose Base Sepolia mint failed (mint from the recipient's Privy wallet).  pnpm bridge:resume */
import { loadEnv } from "@pera/core";
import { listPending, resumePendingBridges } from "@pera/cctp";
import { appendDeployment } from "./lib/deployments";

loadEnv();
const pending = listPending();
if (pending.length === 0) {
  console.log("no pending bridges");
  process.exit(0);
}
console.log(`${pending.length} pending bridge(s)`);
const results = await resumePendingBridges((m) => console.log(`  ${m}`));
for (const r of results) {
  if (r.mintTxHash) {
    console.log(`✔ ${r.amountUsdc} USDC minted on Base: ${r.mintExplorerUrl}`);
    appendDeployment({ kind: "tx", label: `CCTP mint ${r.amountUsdc} USDC on Base Sepolia (resumed; burn ${r.burnTxHash})`, id: r.recipient, txHash: r.mintTxHash, network: "eip155:84532", url: r.mintExplorerUrl });
  } else console.log(`✖ ${r.burnTxHash}: ${r.error?.split("\n")[0]}`);
}
process.exit(results.every((r) => r.mintTxHash) ? 0 : 1);
