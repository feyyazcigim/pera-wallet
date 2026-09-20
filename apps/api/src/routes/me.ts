import type { FastifyInstance } from "fastify";
import { getBalances, getContractUsdcBalance, stellarAccountUrl, stellarContractUrl, baseAddressUrl } from "@pera/core";
import { createAgentToken, getEvmWallet, getPasskey, getStellarWallet, ALL_SCOPES, type User } from "@pera/db";
import { getBaseUsdcBalance } from "@pera/evm";
import { getPosition, isConfigured } from "@pera/yield";
import { requireOwner, requireScope, requireUser } from "../auth";
import { sweepUser } from "../autopilot";
import { loadContext } from "../context";

export async function meView(user: User) {
  const [w, e] = await Promise.all([getStellarWallet(user.id), getEvmWallet(user.id)]);
  const pk = w ? await getPasskey(w.credentialId) : null;
  return {
    user: { id: user.id, displayName: user.displayName, email: user.email, createdAt: user.createdAt },
    wallets: {
      stellar: w
        ? {
            smartAccountId: w.smartAccountId,
            smartAccountUrl: stellarContractUrl(w.smartAccountId),
            credentialId: w.credentialId,
            passkeyPublicKey: pk ? Buffer.from(pk.publicKey).toString("base64url") : null,
            treasury: w.treasuryPublicKey,
            treasuryUrl: stellarAccountUrl(w.treasuryPublicKey),
            agent: w.agentPublicKey,
            agentUrl: stellarAccountUrl(w.agentPublicKey),
            agentRuleId: w.agentRuleId,
            agentAuthorised: w.agentRuleId !== null,
            sweepRuleId: w.sweepRuleId,
            autoSweep: w.sweepRuleId !== null,
            dailyCapUsdc: w.dailyCapUsdc,
            status: w.status,
            statusDetail: w.statusDetail,
            deployTxHash: w.deployTxHash,
          }
        : null,
      evm: e ? { provider: "privy", walletId: e.privyWalletId, privyUserId: e.privyUserId, address: e.address, explorerUrl: baseAddressUrl(e.address), network: "eip155:84532" } : null,
    },
  };
}

export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.get("/me", async (req) => meView(requireUser(req)));

  /**
   * Token for the CLI (`pnpm agent connect <token>`): a scoped agent token with every scope (the CLI is the
   * user's own device), 90 days, revocable from /agent/tokens. Owner session only.
   */
  app.post("/cli/token", async (req) => {
    const user = requireOwner(req);
    const { token, secret } = await createAgentToken({ userId: user.id, name: "pera-agent CLI", scopes: [...ALL_SCOPES], ttlDays: 90 });
    return { token: secret, expiresAt: token.expiresAt, id: token.id, scopes: token.scopes, connect: `pnpm agent connect ${secret}` };
  });

  app.get("/balances", async (req) => {
    const user = requireScope(req, "read");
    void sweepUser(user.id); // idle USDC (e.g. sent straight to the treasury) goes to the vault without waiting for the next tick
    const ctx = await loadContext(user.id);
    const [treasury, float, smart, position, baseUsdc] = await Promise.all([
      getBalances(ctx.treasuryPub),
      getBalances(ctx.agentPub),
      getContractUsdcBalance(ctx.smartAccountId),
      isConfigured() && process.env.VAULT_ID ? getPosition(ctx).catch(() => null) : Promise.resolve(null),
      ctx.evmWallet ? getBaseUsdcBalance(ctx.evmWallet.address).catch(() => null) : Promise.resolve(null),
    ]);
    return {
      treasury: { publicKey: ctx.treasuryPub, usdc: treasury.usdc, xlm: treasury.xlm },
      agentFloat: { publicKey: ctx.agentPub, usdc: float.usdc, xlm: float.xlm },
      smartAccount: { id: ctx.smartAccountId, usdc: smart },
      vault: position ? { id: position.vaultId, shares: position.dfTokens, underlyingUsdc: position.underlyingUsdc, apy: position.apy } : { id: process.env.VAULT_ID ?? null, shares: null, underlyingUsdc: null, apy: null },
      base: ctx.evmWallet ? { provider: ctx.evmWallet.provider, address: ctx.evmWallet.address, usdc: baseUsdc } : null,
      at: new Date().toISOString(),
    };
  });
}
