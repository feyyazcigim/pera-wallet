/**
 * The bank — sandbox only. Sends a TRY transfer to an IBAN with a reference in the description, exactly what a
 * user does in their banking app on mainnet. The dashboard shows the IBAN + reference; this plays the wire.
 *
 *   pnpm bank <iban> <reference> <amountTry>
 *   pnpm bank                       # asks for the three values
 *
 * No login: like a real bank transfer, anyone who knows the IBAN and the reference can pay in.
 */
import { createInterface } from "node:readline/promises";
import { loadEnv } from "@pera/core";

const env = loadEnv();
const base = env.PUBLIC_API_URL.replace(/\/$/, "");

// IBANs are written in groups ("TR05 0009 …"), so the IBAN may arrive as several arguments
const args = process.argv.slice(2);
let amountTry = args.length >= 3 ? args.pop()! : "";
let reference = args.length >= 2 ? args.pop()! : "";
let iban = args.join("");

if (!iban || !reference || !amountTry) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("TR Mock Bank · new transfer");
  iban ||= (await rl.question("  IBAN          : ")).trim();
  reference ||= (await rl.question("  Description   : ")).trim();
  amountTry ||= (await rl.question("  Amount (TRY)  : ")).trim();
  rl.close();
}
amountTry = amountTry.replace(",", ".");

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `${res.status} ${res.statusText}`);
  return json;
}

try {
  await call("POST", "/bank/transfer", { iban, reference, amountTry });
  console.log(`✔ sent ₺${amountTry} to ${iban.replace(/\s+/g, "")} · "${reference}"`);
  process.stdout.write("  the anchor is converting it to USDC ");
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const tx = await call<{ status: string; amountUsdc?: string; stellarTransactionId?: string }>("GET", `/bank/transfer/${encodeURIComponent(reference)}`);
    if (tx.status === "completed") {
      console.log(`\n✔ +${tx.amountUsdc} USDC arrived  https://stellar.expert/explorer/testnet/tx/${tx.stellarTransactionId}`);
      process.exit(0);
    }
    if (tx.status === "error") throw new Error("the anchor reported an error");
    process.stdout.write(".");
  }
  console.log("\n… still converting — the dashboard updates the moment it lands.");
} catch (err) {
  console.error(`\n✖ ${(err as Error).message}`);
  process.exit(1);
}
