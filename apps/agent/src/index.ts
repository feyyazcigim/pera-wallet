#!/usr/bin/env tsx
/**
 * Pera agent CLI — plays a user's AI agent for the demo and doubles as the headless test harness for the
 * passkey flow (a software passkey in ~/.pera acts as the device authenticator).
 *
 *   pnpm agent register --name "Ayşe"     # passkey + smart account (sponsored) + treasury/agent/EVM wallets
 *   pnpm agent login                       # passkey assertion → session
 *   pnpm agent connect <token>             # use a dashboard account: token from the dashboard's "Connect the CLI"
 *   pnpm agent authorize [--cap 10]        # owner approves the agent rule with the passkey (sponsored submit)
 *   pnpm agent onramp 200                  # TRY → USDC into the treasury
 *   pnpm agent run --task "istanbul weather and a summary"
 *   pnpm agent pay <url> [--prefer stellar|evm]
 *   pnpm agent over-cap | policy [--cap] | balances | me | events
 */
import { Command } from "commander";
import { api } from "./api";
import { devicePasskey, loadDevice, saveDevice, saveSession } from "./device";
import { attachDevice, browserLikeKit } from "./kit";
import { planTask } from "./planner";

const program = new Command().name("pera-agent").description("Pera agent wallet CLI").version("0.2.0");

type PayResult = {
  paid: boolean;
  network?: string;
  amountUsdc?: string;
  txHash?: string;
  explorerUrl?: string;
  body: unknown;
  float?: Record<string, unknown>;
  bridged?: { burnTxHash: string; mintTxHash: string; amountUsdc: string };
  timeline?: Array<{ type: string }>;
};

function printPay(r: PayResult): void {
  if (!r.paid) console.log("  no payment required");
  else {
    console.log(`  paid     ${r.amountUsdc} USDC on ${r.network}`);
    console.log(`  tx       ${r.txHash}`);
    console.log(`  explorer ${r.explorerUrl}`);
    if (r.float?.toppedUpUsdc) console.log(`  float    topped up ${r.float.toppedUpUsdc} USDC from the smart account (tx ${r.float.topUpTxHash})`);
    if (r.float?.refilledSmartAccountUsdc) console.log(`  refill   treasury → smart account ${r.float.refilledSmartAccountUsdc} USDC (tx ${r.float.refillTxHash})`);
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
  .command("register")
  .description("one passkey ceremony: smart account + agent rule + sponsored accounts + EVM wallet")
  .requiredOption("--name <displayName>")
  .option("--email <email>")
  .option("--cap <usdc>", "daily cap for the agent")
  .action(async (o: { name: string; email?: string; cap?: string }) => {
    try {
      const existing = loadDevice();
      if (existing?.contractId) {
        console.log(`device already registered: smart account ${existing.contractId} (credential ${existing.credentialId}). Use \`login\`.`);
        return;
      }
      const { passkey, record } = devicePasskey();
      const anon = api({ token: "" });
      const opts = await anon.post<{ challenge: string }>("/auth/register/options", { displayName: o.name });
      console.log(`▶ creating passkey (rpId ${passkey.rpId}, origin ${passkey.origin}) …`);
      const registration = await passkey.startRegistration({ optionsJSON: opts });
      console.log(`  credential ${passkey.credentialId}; API deploys smart account + agent rule (sponsored) …`);
      const r = await anon.post<{ token: string; expiresAt: string; user: { id: string }; wallets: { stellar: { smartAccountId: string } } }>("/auth/register", {
        displayName: o.name,
        email: o.email,
        challenge: opts.challenge,
        registration,
        dailyCapUsdc: o.cap,
      });
      saveDevice({ ...record, contractId: r.wallets.stellar.smartAccountId, displayName: o.name });
      saveSession({ token: r.token, expiresAt: r.expiresAt, userId: r.user.id });
      console.log(`✔ registered user ${r.user.id}`);
      console.log(JSON.stringify(r.wallets, null, 2));
    } catch (err) {
      fail(err);
    }
  });

program
  .command("connect")
  .argument("<token>", "CLI token from the dashboard (Home → Connect the CLI)")
  .description("act for a dashboard (browser-passkey) account: stores the CLI session minted by POST /cli/token")
  .action(async (token: string) => {
    try {
      const me = await api({ token }).get<{ user: { id: string; displayName: string }; wallets: { stellar: { status: string } | null } }>("/me");
      saveSession({ token, expiresAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(), userId: me.user.id });
      console.log(`✔ connected as ${me.user.displayName} (wallet ${me.wallets.stellar?.status ?? "not provisioned"})`);
      console.log("  next: pnpm agent onramp 3000");
    } catch (err) {
      fail(err);
    }
  });

program
  .command("login")
  .description("passkey assertion → API session")
  .action(async () => {
    try {
      const { passkey } = devicePasskey();
      const anon = api({ token: "" });
      const opts = await anon.post<{ challenge: string }>("/auth/login/options", { credentialId: passkey.credentialId });
      const assertion = await passkey.assert(opts.challenge);
      const r = await anon.post<{ token: string; expiresAt: string; user: { id: string; displayName: string } }>("/auth/login/verify", { challenge: opts.challenge, assertion });
      saveSession({ token: r.token, expiresAt: r.expiresAt, userId: r.user.id });
      console.log(`✔ logged in as ${r.user.displayName} (${r.user.id})`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("authorize")
  .description("(re-)approve the agent rule with the passkey — normally done automatically at sign-up")
  .option("--cap <usdc>")
  .action(async (o: { cap?: string }) => {
    try {
      const { passkey, record } = devicePasskey();
      const client = api();
      const build = await client.post<{ json: string; agentPublicKey: string; dailyCapUsdc: string; smartAccountId: string }>("/agent/authorize/build", o.cap ? { dailyCapUsdc: o.cap } : {});
      console.log(`▶ approving agent ${build.agentPublicKey} with a ${build.dailyCapUsdc} USDC/day cap on ${build.smartAccountId}`);
      const kit = browserLikeKit(passkey);
      await attachDevice(kit, passkey, { ...record, contractId: build.smartAccountId });
      const tx = kit.wallet!.fromJSON.add_context_rule(build.json);
      const signed = await kit.signAdmin(tx, { resolveContextRuleIds: () => [0] });
      const r = await client.post<{ ruleId: number; txHash: string; explorerUrl: string }>("/agent/authorize", { xdr: signed.toXDR() });
      console.log(`✔ agent rule #${r.ruleId} created — ${r.explorerUrl}`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("set-cap")
  .argument("<usdc>")
  .description("owner changes the agent's daily cap (passkey-signed, sponsored)")
  .action(async (cap: string) => {
    try {
      const { passkey, record } = devicePasskey();
      const client = api();
      const build = await client.post<{ json: string; ruleId: number }>("/agent/policy/build", { dailyCapUsdc: cap });
      const kit = browserLikeKit(passkey);
      await attachDevice(kit, passkey, record);
      const tx = kit.wallet!.fromJSON.execute(build.json);
      const signed = await kit.signAdmin(tx, { resolveContextRuleIds: () => [0] });
      const r = await client.post<{ txHash: string; explorerUrl: string }>("/agent/policy", { xdr: signed.toXDR(), dailyCapUsdc: cap });
      console.log(`✔ cap set to ${cap} USDC — ${r.explorerUrl}`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("onramp")
  .argument("[amountTry]", "TRY amount", "200")
  .action(async (amountTry: string) => {
    try {
      const client = api();
      const r = await client.post<{ anchorTxId: string; destination: string }>("/onramp", { amountTry });
      console.log(`▶ anchor tx ${r.anchorTxId} → treasury ${r.destination}; waiting …`);
      for (let i = 0; i < 40; i++) {
        await new Promise((res) => setTimeout(res, 4000));
        const tx = await client.get<{ status: string; amountOut?: string; stellarTransactionId?: string }>(`/onramp/${r.anchorTxId}`);
        process.stdout.write(`  ${tx.status}\r`);
        if (tx.status === "completed") {
          console.log(`\n✔ +${tx.amountOut} USDC  https://stellar.expert/explorer/testnet/tx/${tx.stellarTransactionId}`);
          return;
        }
        if (tx.status === "error") throw new Error("onramp failed");
      }
      throw new Error("timeout");
    } catch (err) {
      fail(err);
    }
  });

program
  .command("run")
  .requiredOption("--task <text>")
  .option("--prefer <net>", "auto | stellar | evm", "auto")
  .action(async (o: { task: string; prefer: "auto" | "stellar" | "evm" }) => {
    const client = api();
    console.log(`task: "${o.task}"`);
    for (const p of planTask(o.task, o.prefer)) {
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
  .option("--amount <usdc>")
  .action(async (o: { amount?: string }) => {
    try {
      const r = await api().post<{ attemptedUsdc: string; dailyCapUsdc: string; errorCode: number; errorName: string; policyExplorerUrl: string; explanation: string }>("/agent/pay/over-cap-demo", o.amount ? { amountUsdc: o.amount } : {});
      console.log(`▶ attempted ${r.attemptedUsdc} USDC against a ${r.dailyCapUsdc} USDC daily cap`);
      console.log(`✖ rejected on-chain: policy error #${r.errorCode} ${r.errorName}\n  policy ${r.policyExplorerUrl}\n  ${r.explanation}`);
      process.exit(2);
    } catch (err) {
      fail(err);
    }
  });

for (const [name, path] of [
  ["policy", "/agent/policy"],
  ["balances", "/balances"],
  ["me", "/me"],
  ["events", "/events?limit=20"],
] as const) {
  program.command(name).action(async () => {
    try {
      console.log(JSON.stringify(await api().get(path), null, 2));
    } catch (err) {
      fail(err);
    }
  });
}

await program.parseAsync(process.argv);
