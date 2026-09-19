#!/usr/bin/env tsx
/**
 * Pera agent CLI — plays the AI agent for the demo. Every action goes through the API so the
 * dashboard timeline (SSE) mirrors what happens here.
 *
 *   pnpm agent run --task "get istanbul weather and a summary"
 *   pnpm agent pay <url> [--prefer stellar|evm]
 *   pnpm agent over-cap
 *   pnpm agent policy [--cap 10]
 *   pnpm agent balances
 */
import { Command } from "commander";
import { api } from "./api";
import { planTask } from "./planner";

const program = new Command().name("pera-agent").description("Pera agent wallet CLI").version("0.1.0");

type PayResult = {
  paid: boolean;
  network?: string;
  amountUsdc?: string;
  txHash?: string;
  explorerUrl?: string;
  body: unknown;
  float?: Record<string, unknown>;
  bridged?: { burnTxHash: string; mintTxHash: string; amountUsdc: string };
  timeline?: Array<{ type: string; amountUsdc?: string; txHash?: string }>;
};

function printPay(r: PayResult): void {
  if (!r.paid) {
    console.log("  no payment required");
  } else {
    console.log(`  paid     ${r.amountUsdc} USDC on ${r.network}`);
    console.log(`  tx       ${r.txHash}`);
    console.log(`  explorer ${r.explorerUrl}`);
    if (r.float?.toppedUpUsdc) console.log(`  float    topped up ${r.float.toppedUpUsdc} USDC from the smart account (tx ${r.float.topUpTxHash})`);
    if (r.float?.withdrewFromVaultUsdc) console.log(`  vault    withdrew ${r.float.withdrewFromVaultUsdc} USDC just in time (tx ${r.float.vaultTxHash})`);
    if (r.bridged) console.log(`  bridge   CCTP ${r.bridged.amountUsdc} USDC burn ${r.bridged.burnTxHash} → mint ${r.bridged.mintTxHash}`);
  }
  console.log(`  result   ${JSON.stringify(r.body).slice(0, 300)}`);
  if (r.timeline?.length) console.log(`  timeline ${r.timeline.map((e) => e.type).join(" → ")}`);
}

function fail(err: unknown): never {
  const e = err as Error & { status?: number; body?: { code?: string } };
  if (e.body?.code === "SPENDING_CAP_EXCEEDED") {
    console.error(`✖ SPENDING_CAP_EXCEEDED — ${e.message}`);
    process.exit(2);
  }
  console.error(`✖ ${e.message}`);
  process.exit(1);
}

program
  .command("run")
  .description("plan a task and pay for the endpoints it needs")
  .requiredOption("--task <text>", "what the agent should do")
  .option("--prefer <net>", "auto | stellar | evm", "auto")
  .action(async (o: { task: string; prefer: "auto" | "stellar" | "evm" }) => {
    const client = api();
    console.log(`task: "${o.task}"`);
    const plans = planTask(o.task, o.prefer);
    for (const p of plans) {
      console.log(`\n▶ ${p.skill}: ${p.url}  (${p.reason})`);
      try {
        printPay(await client.post<PayResult>("/agent/pay", { url: p.url, prefer: p.prefer }));
      } catch (err) {
        fail(err);
      }
    }
  });

program
  .command("pay")
  .argument("<url>")
  .option("--prefer <net>", "auto | stellar | evm", "auto")
  .action(async (url: string, o: { prefer: "auto" | "stellar" | "evm" }) => {
    try {
      console.log(`▶ pay ${url}`);
      printPay(await api().post<PayResult>("/agent/pay", { url, prefer: o.prefer }));
    } catch (err) {
      fail(err);
    }
  });

program
  .command("over-cap")
  .description("attempt a float top-up above the daily cap; expect the on-chain rejection")
  .option("--amount <usdc>", "amount to attempt")
  .action(async (o: { amount?: string }) => {
    try {
      const r = await api().post<{ attemptedUsdc: string; dailyCapUsdc: string; errorCode: number; errorName: string; policyExplorerUrl: string; explanation: string }>("/agent/pay/over-cap-demo", o.amount ? { amountUsdc: o.amount } : {});
      console.log(`▶ attempted ${r.attemptedUsdc} USDC against a ${r.dailyCapUsdc} USDC daily cap`);
      console.log(`✖ rejected on-chain: policy error #${r.errorCode} ${r.errorName}`);
      console.log(`  policy   ${r.policyExplorerUrl}`);
      console.log(`  ${r.explanation}`);
      process.exit(2);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("policy")
  .option("--cap <usdc>", "set a new daily cap (owner action)")
  .action(async (o: { cap?: string }) => {
    try {
      const client = api();
      if (o.cap) console.log(JSON.stringify(await client.post("/agent/policy", { dailyCapUsdc: o.cap }), null, 2));
      console.log(JSON.stringify(await client.get("/agent/policy"), null, 2));
    } catch (err) {
      fail(err);
    }
  });

program.command("balances").action(async () => {
  try {
    console.log(JSON.stringify(await api().get("/balances"), null, 2));
  } catch (err) {
    fail(err);
  }
});

await program.parseAsync(process.argv);
