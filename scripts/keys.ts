/**
 * Generates the four keys the project needs (idempotent: existing values are kept) and prints the
 * addresses that need manual funding.
 *
 *   pnpm keys
 */
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { envFilePath, repoRoot, stellarAccountUrl } from "@pera/core";
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

console.log(`
Addresses
---------
OWNER   (human, receives anchor USDC, DeFindex depositor)   ${pubs.OWNER_SECRET}
        ${stellarAccountUrl(pubs.OWNER_SECRET)}
AGENT   (restricted smart-account signer + x402 float)       ${pubs.AGENT_SECRET}
        ${stellarAccountUrl(pubs.AGENT_SECRET)}
SPONSOR (backend hot wallet, pays all Stellar fees)          ${pubs.SPONSOR_SECRET}
        ${stellarAccountUrl(pubs.SPONSOR_SECRET)}

Still needed in .env
--------------------
1. PRIVY_APP_ID / PRIVY_APP_SECRET (dashboard.privy.io → App settings → Basics). Enable TEE execution and
   Fee sponsorship (Base Sepolia) so user wallets are created and gas is sponsored at sign-up.
2. WALLET_MASTER_KEY (any long random string) — encrypts custodial Stellar keys at rest.
3. Optional: DEFINDEX_API_KEY, DATABASE_URL (Postgres; embedded PGlite otherwise).

Stellar accounts are funded by friendbot automatically in \`pnpm bootstrap\`; Stellar USDC comes from the anchor;
EVM gas is sponsored by Privy — no ETH faucet needed.
`);
