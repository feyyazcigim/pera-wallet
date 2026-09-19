import { getEvmWallet, getEvmWalletByAddress, upsertEvmWallet } from "@pera/db";
import { createPrivyWalletForUser, findPrivyWalletByAddress } from "./privy";
import type { EvmWalletRef } from "./provider";

/** Creates (or returns) the user's Privy wallet; called from sign-up. */
export async function ensureUserEvmWallet(p: { userId: string; email?: string }): Promise<EvmWalletRef> {
  const existing = await getEvmWallet(p.userId);
  if (existing) return { provider: "privy", walletId: existing.privyWalletId, address: existing.address, privyUserId: existing.privyUserId };
  const created = await createPrivyWalletForUser(p);
  const saved = await upsertEvmWallet({ userId: p.userId, privyWalletId: created.walletId, privyUserId: created.privyUserId ?? undefined, address: created.address });
  return { provider: "privy", walletId: saved.privyWalletId, address: saved.address, privyUserId: saved.privyUserId };
}

export async function loadUserEvmWallet(userId: string): Promise<EvmWalletRef | null> {
  const w = await getEvmWallet(userId);
  return w ? { provider: "privy", walletId: w.privyWalletId, address: w.address, privyUserId: w.privyUserId } : null;
}

/** Resolves a wallet ref for an address we manage (DB first, then Privy). */
export async function walletForAddress(address: string): Promise<EvmWalletRef | null> {
  const w = await getEvmWalletByAddress(address);
  if (w) return { provider: "privy", walletId: w.privyWalletId, address: w.address, privyUserId: w.privyUserId };
  return findPrivyWalletByAddress(address);
}
