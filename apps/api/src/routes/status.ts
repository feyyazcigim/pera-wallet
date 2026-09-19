import type { FastifyInstance } from "fastify";
import { BASE_SEPOLIA, CCTP, derivedKeys, getBalances, getContractUsdcBalance, loadEnv, SMART_ACCOUNT, stellarAccountUrl, stellarContractUrl, USDC_ISSUER, USDC_SAC, baseAddressUrl } from "@pera/core";
import { getPolicyUsage } from "@pera/smart-account";
import { getBaseEthBalance, getBaseUsdcBalance, getEvmAddress } from "@pera/cctp";
import { getPosition, getVaultInfo, isConfigured } from "@pera/yield";
import { getTryUsdcPrice } from "@pera/anchor";
import { state } from "../state";

export async function statusRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ ok: true, service: "pera-api", startedAt: state.startedAt }));

  app.get("/status", async () => {
    const env = loadEnv();
    const keys = derivedKeys(env);
    const evm = getEvmAddress();
    const [policy, vault, price, sponsor] = await Promise.all([
      state.kitReady ? getPolicyUsage().catch((e: Error) => ({ error: e.message })) : Promise.resolve({ error: state.kitError ?? "kit not ready" }),
      state.vaultId && isConfigured() ? getVaultInfo(state.vaultId).catch((e: Error) => ({ error: e.message })) : Promise.resolve(null),
      getTryUsdcPrice(env.OWNER_SECRET).catch(() => null),
      getBalances(keys.sponsorPub).catch(() => null),
    ]);
    return {
      network: "stellar:testnet",
      networkPassphrase: "Test SDF Network ; September 2015",
      usdc: { sac: USDC_SAC, issuer: USDC_ISSUER, decimals: 7 },
      anchor: { homeDomain: "tr-mock-anchor.fly.dev", tryPerUsdc: price?.tryPerUsdc ?? null },
      owner: { publicKey: keys.ownerPub, explorerUrl: stellarAccountUrl(keys.ownerPub) },
      agent: { publicKey: keys.agentPub, explorerUrl: stellarAccountUrl(keys.agentPub) },
      sponsor: { publicKey: keys.sponsorPub, xlm: sponsor?.xlm ?? null, lowXlm: sponsor ? Number(sponsor.xlm) < 50 : null },
      smartAccount: state.smartAccountId ? { id: state.smartAccountId, explorerUrl: stellarContractUrl(state.smartAccountId), ready: state.kitReady, error: state.kitError } : null,
      policy: { ...(policy as object), policyContract: SMART_ACCOUNT.spendingLimitPolicy, configuredCapUsdc: state.dailyCapUsdc },
      vault: state.vaultId ? { id: state.vaultId, explorerUrl: stellarContractUrl(state.vaultId), configured: isConfigured(), info: vault } : { id: null, configured: isConfigured() },
      base: evm ? { network: "eip155:84532", sponsorAddress: evm, explorerUrl: baseAddressUrl(evm), usdc: BASE_SEPOLIA.usdc, messageTransmitterV2: BASE_SEPOLIA.messageTransmitterV2, cctpDomain: CCTP.baseSepoliaDomain } : null,
      x402: { facilitator: env.X402_FACILITATOR_URL, resourceServerUrl: env.RESOURCE_SERVER_URL, payer: keys.agentPub, evmPayer: evm ?? null },
      autopilot: env.AUTOPILOT,
      startedAt: state.startedAt,
    };
  });

  app.get("/balances", async () => {
    const env = loadEnv();
    const keys = derivedKeys(env);
    const [owner, agent, smart, position, baseUsdc, baseEth] = await Promise.all([
      getBalances(keys.ownerPub),
      getBalances(keys.agentPub),
      state.smartAccountId ? getContractUsdcBalance(state.smartAccountId) : Promise.resolve(null),
      state.vaultId && isConfigured() ? getPosition().catch(() => null) : Promise.resolve(null),
      getEvmAddress() ? getBaseUsdcBalance().catch(() => null) : Promise.resolve(null),
      getEvmAddress() ? getBaseEthBalance().catch(() => null) : Promise.resolve(null),
    ]);
    return {
      owner: { publicKey: keys.ownerPub, usdc: owner.usdc, xlm: owner.xlm },
      agentFloat: { publicKey: keys.agentPub, usdc: agent.usdc, xlm: agent.xlm },
      smartAccount: { id: state.smartAccountId ?? null, usdc: smart },
      vault: position ? { id: position.vaultId, shares: position.dfTokens, underlyingUsdc: position.underlyingUsdc, apy: position.apy } : { id: state.vaultId ?? null, shares: null, underlyingUsdc: null, apy: null },
      base: { address: getEvmAddress() ?? null, usdc: baseUsdc, eth: baseEth },
      at: new Date().toISOString(),
    };
  });
}
