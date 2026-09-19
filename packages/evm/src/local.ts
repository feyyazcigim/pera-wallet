import { encodeFunctionData, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseTxUrl, childLogger } from "@pera/core";
import { sponsorAccount, sponsorWalletClient, waitForReceipt } from "./chain";
import type { EvmWalletProvider, SentCall } from "./provider";

const log = childLogger("evm.local");

/**
 * Fallback when Privy is not configured: a per-user secp256k1 key (encrypted in Postgres). The user
 * wallet still never holds ETH — the backend sponsor EOA relays calls. Only permissionless calls
 * (e.g. CCTP `receiveMessage`) can be relayed this way; USDC moves use EIP-3009 (see transfer.ts).
 */
export const localProvider: EvmWalletProvider = {
  kind: "local",

  async createWallet({ userId }) {
    const secret = generatePrivateKey();
    const address = privateKeyToAccount(secret).address;
    log.info({ userId, address }, "local evm wallet created");
    return { provider: "local", address, secret };
  },

  async signTypedData(wallet, typedData) {
    if (!wallet.secret) throw new Error("local evm wallet secret missing");
    const account = privateKeyToAccount(wallet.secret as Hex);
    return account.signTypedData(typedData as unknown as Parameters<typeof account.signTypedData>[0]);
  },

  async sendCall(_wallet, call): Promise<SentCall> {
    const client = sponsorWalletClient();
    const hash = await client.sendTransaction({ account: sponsorAccount(), to: call.to, data: call.data, value: call.value ?? 0n, chain: client.chain });
    const receipt = await waitForReceipt(hash);
    if (receipt.status !== "success") throw new Error(`relayed call reverted: ${hash}`);
    log.info({ label: call.label, hash }, "call relayed by sponsor EOA");
    return { hash, explorerUrl: baseTxUrl(hash), sponsored: true };
  },
};

export { encodeFunctionData };
