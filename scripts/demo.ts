/**
 * Scripted pitch run with pauses and explorer links. Talks to the API like the dashboard does.
 *   pnpm demo [--fast]
 */
import { loadEnv } from "@pera/core";

const env = loadEnv();
const fast = process.argv.includes("--fast");
const base = env.PUBLIC_API_URL.replace(/\/$/, "");
const rs = env.RESOURCE_SERVER_URL.replace(/\/$/, "");
const headers = { "content-type": "application/json", authorization: `Bearer ${env.API_BEARER_TOKEN}` };
const pause = (ms: number) => new Promise((r) => setTimeout(r, fast ? 200 : ms));
const step = async (title: string) => {
  console.log(`\n═══ ${title}`);
  await pause(1500);
};
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok && res.status !== 409) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};
const show = (o: unknown) => console.log(JSON.stringify(o, null, 2).split("\n").map((l) => `   ${l}`).join("\n"));

await step("0. Status");
const status = (await call("GET", "/status")) as { smartAccount?: { id: string; explorerUrl: string }; vault?: { id?: string } };
console.log(`   smart account ${status.smartAccount?.id}\n   ${status.smartAccount?.explorerUrl}`);

await step("1. Balances before");
show(await call("GET", "/balances"));

await step("2. On-ramp 200 TRY through the SEP-6 anchor (bank wire simulated)");
const on = (await call("POST", "/onramp", { amountTry: "200" })) as { anchorTxId: string };
console.log(`   anchor tx ${on.anchorTxId} — waiting for completion …`);
for (let i = 0; i < 40; i++) {
  await pause(4000);
  const tx = (await call("GET", `/onramp/${on.anchorTxId}`)) as { status: string; amountOut?: string; stellarTransactionId?: string };
  process.stdout.write(`   ${tx.status}`);
  if (tx.status === "completed") {
    console.log(`\n   +${tx.amountOut} USDC  https://stellar.expert/explorer/testnet/tx/${tx.stellarTransactionId}`);
    break;
  }
  if (tx.status === "error") throw new Error("onramp failed");
  process.stdout.write("\r");
}

await step("3. Yield position (autopilot deposits idle USDC into the DeFindex vault)");
if (status.vault?.id) show(await call("GET", "/yield/position?fresh=1"));
else console.log("   (vault not configured — DEFINDEX_API_KEY missing)");

await step("4. Agent policy: on-chain spending cap");
show(await call("GET", "/agent/policy"));

await step("5. Agent pays a Stellar x402 paywall (weather)");
const pay1 = (await call("POST", "/agent/pay", { url: `${rs}/api/stellar/weather` })) as { txHash: string; explorerUrl: string; body: unknown; float?: unknown };
console.log(`   paid → ${pay1.explorerUrl}`);
show(pay1.body);

await step("6. Agent tries to move more than the cap — rejected by the policy contract");
show(await call("POST", "/agent/pay/over-cap-demo", {}));

await step("7. Agent pays a Base Sepolia x402 paywall (CCTP bridge just in time)");
try {
  const pay2 = (await call("POST", "/agent/pay", { url: `${rs}/api/base/summary` })) as { explorerUrl: string; bridged?: unknown; body: unknown };
  console.log(`   paid → ${pay2.explorerUrl}`);
  if (pay2.bridged) show(pay2.bridged);
  show(pay2.body);
} catch (err) {
  console.log(`   skipped: ${(err as Error).message.slice(0, 200)}`);
}

await step("8. Off-ramp 2 USDC back to TRY");
try {
  show(await call("POST", "/offramp", { amountUsdc: "2" }));
} catch (err) {
  console.log(`   skipped: ${(err as Error).message.slice(0, 200)}`);
}

await step("9. Event timeline (newest first)");
const evs = (await call("GET", "/events?limit=12")) as unknown as Array<{ ts: string; type: string; amountUsdc?: string; txHash?: string }>;
for (const e of evs) console.log(`   ${e.ts}  ${e.type.padEnd(22)} ${e.amountUsdc ?? ""} ${e.txHash ?? ""}`);
console.log("\n✔ demo complete");
