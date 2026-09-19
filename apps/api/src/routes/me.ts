import type { FastifyInstance } from "fastify";
import { getBalances, getContractUsdcBalance, stellarAccountUrl, stellarContractUrl, baseAddressUrl } from "@pera/core";
import { createSession, getEvmWallet, getPasskey, getStellarWallet, type User } from "@pera/db";
import { getBaseUsdcBalance } from "@pera/evm";
import { getPosition, isConfigured } from "@pera/yield";
import { requireUser } from "../auth";
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
   * A second session for the same user, meant for the CLI (`pnpm agent connect <token>`): a terminal cannot do
   * the passkey ceremony, and sharing the browser's own session would die with the browser's sign-out.
   */
  app.post("/cli/token", async (req) => {
    const user = requireUser(req);
    const session = await createSession(user.id);
    return { token: session.token, expiresAt: session.expiresAt, connect: `pnpm agent connect ${session.token}` };
  });

  app.get("/balances", async (req) => {
    const user = requireUser(req);
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
