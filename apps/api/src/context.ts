import { getEvmWallet, getStellarWallet, type StellarWallet } from "@pera/db";
import type { UserWalletContext } from "@pera/core";
import type { EvmWalletRef } from "@pera/evm";

export type ApiUserContext = UserWalletContext & { evmWallet?: EvmWalletRef; status: StellarWallet["status"] };

export function toContext(w: StellarWallet, evm: EvmWalletRef | undefined): ApiUserContext {
  return {
    userId: w.userId,
    smartAccountId: w.smartAccountId,
    credentialId: w.credentialId,
    treasurySecret: w.treasurySecret,
    treasuryPub: w.treasuryPublicKey,
    agentSecret: w.agentSecret,
    agentPub: w.agentPublicKey,
    agentRuleId: w.agentRuleId ?? undefined,
    dailyCapUsdc: w.dailyCapUsdc,
    evm: evm ? { provider: evm.provider, walletId: evm.walletId, address: evm.address } : undefined,
    evmWallet: evm,
    status: w.status,
  };
}

/** Loads the wallet context for a user; throws a 409-style error when provisioning is incomplete. */
export async function loadContext(userId: string): Promise<ApiUserContext> {
  const [w, e] = await Promise.all([getStellarWallet(userId), getEvmWallet(userId)]);
  if (!w) throw Object.assign(new Error("wallet not provisioned for this user"), { statusCode: 409, code: "NOT_PROVISIONED" });
  const evm: EvmWalletRef | undefined = e ? { provider: "privy", address: e.address, walletId: e.privyWalletId, privyUserId: e.privyUserId } : undefined;
  return toContext(w, evm);
}
