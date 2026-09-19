/** Minimal typed-data shape shared by viem, x402 and Privy. */
export interface TypedDataInput {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

/** A Privy server wallet (app-controlled, attributed to the Privy user created for our user). */
export interface EvmWalletRef {
  provider: "privy";
  walletId: string;
  address: string;
  privyUserId?: string | null;
}

export interface SentCall {
  hash: string;
  explorerUrl: string;
  /** Sponsored transactions are user operations; the id lets us poll for the final hash. */
  transactionId?: string;
  userOperationHash?: string;
  sponsored: boolean;
}
