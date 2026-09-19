import { encodeFunctionData, type Hex } from "viem";
import { getEvmWallet, upsertEvmWallet } from "@pera/db";
import { BASE_SEPOLIA, childLogger, loadEnv, usdcToMicro } from "@pera/core";
import { ERC20_ABI, publicClient, sponsorAccount, sponsorWalletClient, waitForReceipt, getBaseUsdcBalance } from "./chain";
import { localProvider } from "./local";
import { isPrivyConfigured, privyProvider } from "./privy";
import type { EvmWalletProvider, EvmWalletRef, SentCall, TypedDataInput } from "./provider";

const log = childLogger("evm.wallets");

export function activeProvider(): EvmWalletProvider {
  return isPrivyConfigured() ? privyProvider : localProvider;
}

export function providerFor(wallet: EvmWalletRef): EvmWalletProvider {
  return wallet.provider === "privy" ? privyProvider : localProvider;
}

/** Creates (or returns) the user's EVM wallet with the active provider. */
export async function ensureUserEvmWallet(p: { userId: string; email?: string }): Promise<EvmWalletRef> {
  const existing = await getEvmWallet(p.userId);
  if (existing) return { provider: existing.provider, address: existing.address, walletId: existing.privyWalletId, secret: existing.secret };
  const provider = activeProvider();
  const created = await provider.createWallet(p);
  const saved = await upsertEvmWallet({ userId: p.userId, provider: created.provider, privyWalletId: created.walletId ?? undefined, address: created.address, secret: created.secret ?? undefined });
  return { provider: saved.provider, address: saved.address, walletId: saved.privyWalletId, secret: saved.secret };
}

export async function loadUserEvmWallet(userId: string): Promise<EvmWalletRef | null> {
  const w = await getEvmWallet(userId);
  return w ? { provider: w.provider, address: w.address, walletId: w.privyWalletId, secret: w.secret } : null;
}

export function signTypedDataFor(wallet: EvmWalletRef, typedData: TypedDataInput): Promise<Hex> {
  return providerFor(wallet).signTypedData(wallet, typedData);
}

export function sendCallFor(wallet: EvmWalletRef, call: { to: Hex; data: Hex; value?: bigint; label?: string }): Promise<SentCall> {
  return providerFor(wallet).sendCall(wallet, call);
}

/**
 * USDC transfer out of the user's wallet without the user paying gas:
 * privy → sponsored `transfer`; local → EIP-3009 `transferWithAuthorization` signed by the user,
 * submitted by the sponsor EOA.
 */
export async function transferUsdcFrom(wallet: EvmWalletRef, p: { to: string; amountUsdc: string }): Promise<SentCall> {
  const value = usdcToMicro(p.amountUsdc);
  if (wallet.provider === "privy") {
    return privyProvider.sendCall(wallet, { to: BASE_SEPOLIA.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [p.to as Hex, value] }), label: `usdc transfer ${p.amountUsdc}` });
  }
  const now = Math.floor(Date.now() / 1000);
  const nonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}` as Hex;
  const domain = { name: "USDC", version: "2", chainId: BASE_SEPOLIA.chainId, verifyingContract: BASE_SEPOLIA.usdc };
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };
  const message = { from: wallet.address, to: p.to, value, validAfter: 0n, validBefore: BigInt(now + 3600), nonce };
  const signature = await localProvider.signTypedData(wallet, { domain, types, primaryType: "TransferWithAuthorization", message });
  const data = encodeFunctionData({ abi: ERC20_ABI, functionName: "transferWithAuthorization", args: [wallet.address as Hex, p.to as Hex, value, 0n, BigInt(now + 3600), nonce, signature] });
  const client = sponsorWalletClient();
  const hash = await client.sendTransaction({ account: sponsorAccount(), to: BASE_SEPOLIA.usdc, data, chain: client.chain });
  const receipt = await waitForReceipt(hash);
  if (receipt.status !== "success") throw new Error(`transferWithAuthorization reverted: ${hash}`);
  log.info({ hash, amountUsdc: p.amountUsdc }, "EIP-3009 transfer relayed");
  return { hash, explorerUrl: `https://sepolia.basescan.org/tx/${hash}`, sponsored: true };
}

export { publicClient, getBaseUsdcBalance };
export function evmProviderName(): "privy" | "local" {
  return loadEnv().PRIVY_APP_ID ? "privy" : "local";
}
