import type { Hex } from "viem";

/** Minimal typed-data shape shared by viem, x402 and Privy. */
export interface TypedDataInput {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface EvmWalletRef {
  provider: "privy" | "local";
  address: string;
  walletId?: string | null;
  /** local provider only */
  secret?: string | null;
}

export interface SentCall {
  hash: string;
  explorerUrl: string;
  /** Privy sponsored transactions are user operations; the id lets us poll for the final hash. */
  transactionId?: string;
  userOperationHash?: string;
  sponsored: boolean;
}

/**
 * How a user's EVM wallet is created, signs and sends. `privy` = Privy server wallet with Privy's
 * gas sponsorship (EIP-7702 + paymaster). `local` = key generated here, sponsor EOA relays
 * permissionless calls and EIP-3009 transfers; the user wallet never holds ETH in either case.
 */
export interface EvmWalletProvider {
  readonly kind: "privy" | "local";
  createWallet(p: { userId: string; email?: string }): Promise<EvmWalletRef>;
  signTypedData(wallet: EvmWalletRef, typedData: TypedDataInput): Promise<Hex>;
  /** Sends a contract call from the user's wallet (sponsored). */
  sendCall(wallet: EvmWalletRef, call: { to: Hex; data: Hex; value?: bigint; label?: string }): Promise<SentCall>;
}
