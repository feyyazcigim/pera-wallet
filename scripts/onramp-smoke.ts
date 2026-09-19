/**
 * Checkpoint 1: TRY → USDC through the SEP-6 sandbox anchor.
 *   pnpm smoke:onramp [amountTry=200]
 */
import { derivedKeys, ensureFunded, ensureUsdcTrustline, getBalances, loadEnv, stellarTxUrl } from "@pera/core";
import { onrampTryToUsdc } from "@pera/anchor";
import { appendDeployment } from "./lib/deployments";

const env = loadEnv();
const { ownerPub } = derivedKeys(env);
const amountTry = process.argv[2] ?? "200";

console.log(`owner ${ownerPub}`);
await ensureFunded(ownerPub);
const tl = await ensureUsdcTrustline(env.OWNER_SECRET!);
if (tl.created) console.log(`USDC trustline created: ${stellarTxUrl(tl.txHash!)}`);

const before = await getBalances(ownerPub);
console.log(`USDC before: ${before.usdc}`);
console.log(`on-ramping ${amountTry} TRY …`);

const { start, tx } = await onrampTryToUsdc({
  accountSecret: env.OWNER_SECRET!,
  amountTry,
  onStatus: (t) => console.log(`  status → ${t.status}${t.message ? ` (${t.message})` : ""}`),
});
console.log(`anchor tx id      ${start.id}`);
console.log(`bank instructions ${start.instructions.bankName} · IBAN ${start.instructions.iban} · ref ${start.instructions.memo}`);
console.log(`amount_in         ${tx.amountIn} TRY`);
console.log(`amount_out        ${tx.amountOut} USDC (fee ${tx.amountFee})`);
console.log(`stellar tx        ${tx.stellarTransactionId} ${tx.stellarTransactionId ? stellarTxUrl(tx.stellarTransactionId) : ""}`);

const after = await getBalances(ownerPub);
console.log(`USDC after:  ${after.usdc}`);
if (Number(after.usdc) <= Number(before.usdc)) throw new Error("owner USDC balance did not increase");

appendDeployment({
  kind: "tx",
  label: `anchor onramp ${amountTry} TRY → ${tx.amountOut} USDC (anchor tx ${start.id})`,
  id: ownerPub,
  txHash: tx.stellarTransactionId,
  network: "stellar:testnet",
  url: tx.stellarTransactionId ? stellarTxUrl(tx.stellarTransactionId) : undefined,
  notes: "onramp-smoke",
});
console.log("✔ checkpoint 1 passed");
