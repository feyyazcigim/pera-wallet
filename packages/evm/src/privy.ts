import { PrivyClient } from "@privy-io/node";
import type { Hex } from "viem";
import { BASE_SEPOLIA, BASE_SEPOLIA_CAIP2, baseTxUrl, childLogger, loadEnv } from "@pera/core";
import { hasCode } from "./chain";
import type { EvmWalletProvider, EvmWalletRef, SentCall, TypedDataInput } from "./provider";

const log = childLogger("evm.privy");

let client: PrivyClient | undefined;

export function isPrivyConfigured(): boolean {
  const env = loadEnv();
  return Boolean(env.PRIVY_APP_ID && env.PRIVY_APP_SECRET);
}

export function getPrivy(): PrivyClient {
  const env = loadEnv();
  if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) throw new Error("PRIVY_APP_ID / PRIVY_APP_SECRET missing");
  client ??= new PrivyClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET });
  return client;
}

/**
 * Privy server wallets (TEE) with Privy gas sponsorship on Base Sepolia (EIP-7702 + paymaster).
 * Dashboard prerequisites: TEE execution, Fee sponsorship → Sponsor gas fees, Base Sepolia in
 * Supported chains, billing. Sponsored sends return a user-operation id; we poll for the hash.
 */
export const privyProvider: EvmWalletProvider = {
  kind: "privy",

  async createWallet({ userId }) {
    const privy = getPrivy();
    const w = await privy.wallets().create({
      chain_type: "ethereum",
      external_id: `pera-${userId}`.slice(0, 64),
      idempotency_key: `pera-evm-${userId}`,
    });
    log.info({ userId, walletId: w.id, address: w.address }, "privy wallet created");
    return { provider: "privy", address: w.address, walletId: w.id };
  },

  async signTypedData(wallet, typedData) {
    const privy = getPrivy();
    if (!wallet.walletId) throw new Error("privy wallet id missing");
    // Once gas-sponsored the wallet is 7702-delegated (has code): EIP-712 must be ERC-1271 style.
    const delegated = await hasCode(wallet.address);
    const res = await privy.wallets().ethereum().signTypedData(wallet.walletId, {
      params: {
        typed_data: {
          domain: typedData.domain as never,
          types: typedData.types as never,
          primary_type: typedData.primaryType,
          message: typedData.message as never,
        },
      },
      ...(delegated ? { signature_options: { type: "erc1271" as const } } : {}),
    });
    return res.signature as Hex;
  },

  async sendCall(wallet, call): Promise<SentCall> {
    const privy = getPrivy();
    const env = loadEnv();
    if (!wallet.walletId) throw new Error("privy wallet id missing");
    const sponsor = env.PRIVY_GAS_SPONSORSHIP === "on";
    const res = await privy.wallets().ethereum().sendTransaction(wallet.walletId, {
      caip2: BASE_SEPOLIA_CAIP2,
      params: {
        transaction: {
          to: call.to,
          data: call.data,
          value: `0x${(call.value ?? 0n).toString(16)}`,
          chain_id: BASE_SEPOLIA.chainId,
        },
      },
      sponsor,
    });
    let hash = res.hash;
    if (!hash && res.transaction_id) hash = await waitForPrivyHash(res.transaction_id);
    if (!hash) throw new Error("privy returned neither a hash nor a transaction id");
    log.info({ label: call.label, hash, sponsored: sponsor, userOp: res.user_operation_hash }, "privy call sent");
    return { hash, explorerUrl: baseTxUrl(hash), transactionId: res.transaction_id, userOperationHash: res.user_operation_hash, sponsored: sponsor };
  },
};

/** Sponsored EVM transactions report `hash: ""` until confirmed; poll the transaction record. */
async function waitForPrivyHash(transactionId: string, timeoutMs = 180_000): Promise<string> {
  const privy = getPrivy();
  const started = Date.now();
  for (;;) {
    const tx = await privy.transactions().get(transactionId);
    if (tx.transaction_hash) return tx.transaction_hash;
    if (String(tx.status).toLowerCase().includes("fail")) throw new Error(`privy transaction ${transactionId} failed (${tx.status})`);
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for privy transaction ${transactionId} (${tx.status})`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
