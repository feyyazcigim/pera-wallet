import type { FastifyInstance } from "fastify";
import { BASE_SEPOLIA, CCTP, getBalances, loadEnv, SMART_ACCOUNT, sponsorPublicKey, stellarAccountUrl, stellarContractUrl, USDC_ISSUER, USDC_SAC } from "@pera/core";
import { countUsers, getDb } from "@pera/db";

import { getVaultInfo, isConfigured } from "@pera/yield";

const startedAt = new Date().toISOString();

export async function statusRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ ok: true, service: "pera-api", startedAt }));

  app.get("/status", async () => {
    const env = loadEnv();
    const sponsorPub = sponsorPublicKey(env);
    const [sponsor, vault, users, db] = await Promise.all([
      getBalances(sponsorPub).catch(() => null),
      env.VAULT_ID && isConfigured() ? getVaultInfo(env.VAULT_ID).catch((e: Error) => ({ error: e.message })) : Promise.resolve(null),
      countUsers().catch(() => null),
      getDb().then((d) => d.kind).catch(() => "unavailable"),
    ]);
    return {
      network: "stellar:testnet",
      networkPassphrase: "Test SDF Network ; September 2015",
      usdc: { sac: USDC_SAC, issuer: USDC_ISSUER, decimals: 7 },
      anchor: { homeDomain: "tr-mock-anchor.fly.dev" },
      auth: { method: "passkey", rpId: env.PASSKEY_RP_ID, origins: env.PASSKEY_ORIGINS.split(",") },
      users,
      database: db,
      sponsor: { publicKey: sponsorPub, explorerUrl: stellarAccountUrl(sponsorPub), xlm: sponsor?.xlm ?? null, lowXlm: sponsor ? Number(sponsor.xlm) < 50 : null },
      smartAccount: { accountWasmHash: SMART_ACCOUNT.accountWasmHash, webauthnVerifier: SMART_ACCOUNT.webauthnVerifier, ed25519Verifier: SMART_ACCOUNT.ed25519Verifier, spendingLimitPolicy: SMART_ACCOUNT.spendingLimitPolicy, policyExplorerUrl: stellarContractUrl(SMART_ACCOUNT.spendingLimitPolicy), defaultDailyCapUsdc: env.AGENT_DAILY_CAP_USDC },
      vault: env.VAULT_ID ? { id: env.VAULT_ID, explorerUrl: stellarContractUrl(env.VAULT_ID), configured: isConfigured(), info: vault } : { id: null, configured: isConfigured() },
      evm: { provider: "privy", privyAppId: env.PRIVY_APP_ID, gasSponsorship: env.PRIVY_GAS_SPONSORSHIP, network: "eip155:84532", usdc: BASE_SEPOLIA.usdc, messageTransmitterV2: BASE_SEPOLIA.messageTransmitterV2, cctpDomain: CCTP.baseSepoliaDomain },
      x402: { facilitator: env.X402_FACILITATOR_URL, resourceServerUrl: env.RESOURCE_SERVER_URL },
      autopilot: env.AUTOPILOT,
      startedAt,
    };
  });
}
