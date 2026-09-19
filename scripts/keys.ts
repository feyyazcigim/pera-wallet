/**
 * Generates the four keys the project needs (idempotent: existing values are kept) and prints the
 * addresses that need manual funding.
 *
 *   pnpm keys
 */
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { envFilePath, repoRoot, stellarAccountUrl, baseAddressUrl } from "@pera/core";
import { readEnvValue, upsertEnv } from "./lib/deployments";

const envFile = envFilePath();
if (!existsSync(envFile)) {
  copyFileSync(path.join(repoRoot(), ".env.example"), envFile);
  console.log(`created ${envFile} from .env.example`);
}

const stellarKeys = ["OWNER_SECRET", "AGENT_SECRET", "SPONSOR_SECRET"] as const;
const pubs: Record<string, string> = {};
for (const key of stellarKeys) {
  let secret = readEnvValue(key);
  if (!secret) {
    secret = Keypair.random().secret();
    upsertEnv(key, secret);
    console.log(`generated ${key}`);
  }
  pubs[key] = Keypair.fromSecret(secret).publicKey();
}

let evmKey = readEnvValue("EVM_SPONSOR_PRIVATE_KEY");
if (!evmKey) {
  evmKey = generatePrivateKey();
  upsertEnv("EVM_SPONSOR_PRIVATE_KEY", evmKey);
  console.log("generated EVM_SPONSOR_PRIVATE_KEY");
}
const evmAddress = privateKeyToAccount(evmKey as `0x${string}`).address;

console.log(`
Addresses
---------
OWNER   (human, receives anchor USDC, DeFindex depositor)   ${pubs.OWNER_SECRET}
        ${stellarAccountUrl(pubs.OWNER_SECRET)}
AGENT   (restricted smart-account signer + x402 float)       ${pubs.AGENT_SECRET}
        ${stellarAccountUrl(pubs.AGENT_SECRET)}
SPONSOR (backend hot wallet, pays all Stellar fees)          ${pubs.SPONSOR_SECRET}
        ${stellarAccountUrl(pubs.SPONSOR_SECRET)}
EVM     (Base Sepolia gas payer, CCTP mint recipient, x402)  ${evmAddress}
        ${baseAddressUrl(evmAddress)}

Manual funding needed
---------------------
1. Base Sepolia ETH for the EVM address (any Base Sepolia faucet, e.g. https://www.alchemy.com/faucets/base-sepolia).
   ~0.01 ETH is plenty; it pays CCTP receiveMessage gas.
2. Optional: Circle testnet USDC on Base Sepolia for the same address (https://faucet.circle.com) so the
   eip155 paywall can be paid even while a bridge is in flight.

Stellar accounts are funded by friendbot automatically in \`pnpm bootstrap\`; Stellar USDC comes from the anchor.
`);
