import { PrivyClient } from "@privy-io/node";
import { encodeFunctionData, type Hex } from "viem";
import { BASE_SEPOLIA, BASE_SEPOLIA_CAIP2, baseTxUrl, childLogger, loadEnv, usdcToMicro } from "@pera/core";
import { ERC20_ABI, hasCode } from "./chain";
import type { EvmWalletRef, SentCall, TypedDataInput } from "./provider";

const log = childLogger("evm.privy");

let client: PrivyClient | undefined;

export function getPrivy(): PrivyClient {
  const env = loadEnv();
  client ??= new PrivyClient({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET });
  return client;
}

/**
 * The public `PrivyClient` wraps the generated REST client but only re-exposes a subset through its
 * services (`users()` has `get` only). User creation / lookup and wallet-by-address live on the wrapped
 * client, reachable through the (TypeScript-private) `privyApiClient` field — pinned to @privy-io/node 0.34.0.
 */
interface PrivyRawApi {
  users: {
    create(body: { linked_accounts: unknown[] }): Promise<{ id: string }>;
    getByCustomAuthID(body: { custom_user_id: string }): Promise<{ id: string }>;
  };
  wallets: {
    getWalletByAddress(body: { address: string; include_archived?: boolean }): Promise<{ id: string; address: string; chain_type: string }>;
  };
}
function rawApi(): PrivyRawApi {
  const raw = (getPrivy() as unknown as { privyApiClient?: PrivyRawApi }).privyApiClient;
  if (!raw?.users || !raw?.wallets) throw new Error("@privy-io/node internals changed: privyApiClient not found (pin 0.34.0)");
  return raw;
}

/**
 * Creates the Privy identity + wallet for one of our users at sign-up:
 *  - a Privy user linked by `custom_auth` (our user id) and, when known, the email — so the same person
 *    can later claim the wallet through Privy's own login;
 *  - an app-controlled Ethereum server wallet attributed to that user (`entity`) and tagged with our id
 *    (`external_id`, write-once) — app control is what lets the AI agent sign autonomously.
 * Idempotent: re-running for the same user returns the existing wallet.
 */
export async function createPrivyWalletForUser(p: { userId: string; email?: string }): Promise<EvmWalletRef> {
  const privy = getPrivy();
  const externalId = `pera-${p.userId}`.slice(0, 64);

  let privyUserId: string | undefined;
  const api = rawApi();
  try {
    privyUserId = (await api.users.getByCustomAuthID({ custom_user_id: p.userId })).id;
  } catch {
    const linked: Array<{ type: "custom_auth"; custom_user_id: string } | { type: "email"; address: string }> = [{ type: "custom_auth", custom_user_id: p.userId }];
    if (p.email) linked.push({ type: "email", address: p.email });
    privyUserId = (await api.users.create({ linked_accounts: linked })).id;
  }

  const w = await privy.wallets().create({
    chain_type: "ethereum",
    external_id: externalId,
    entity: privyUserId ? { id: privyUserId, type: "user" } : undefined,
    idempotency_key: `pera-evm-${p.userId}`,
  });
  log.info({ userId: p.userId, walletId: w.id, address: w.address, privyUserId }, "privy wallet created for user");
  return { provider: "privy", walletId: w.id, address: w.address, privyUserId };
}

/** App-owned wallet used as the demo merchant (`payTo` of the Base Sepolia paywall) and by legacy scripts. */
export async function ensureAppWallet(tag: string): Promise<EvmWalletRef> {
  const privy = getPrivy();
  const w = await privy.wallets().create({ chain_type: "ethereum", external_id: `pera-${tag}`.slice(0, 64), idempotency_key: `pera-app-${tag}` });
  return { provider: "privy", walletId: w.id, address: w.address };
}

export async function findPrivyWalletByAddress(address: string): Promise<EvmWalletRef | null> {
  try {
    const w = await rawApi().wallets.getWalletByAddress({ address });
    return w.chain_type === "ethereum" ? { provider: "privy", walletId: w.id, address: w.address } : null;
  } catch {
    return null;
  }
}

/** EIP-712 signature (ECDSA, or ERC-1271 mode once the wallet is 7702-delegated by gas sponsorship). */
export async function signTypedDataFor(wallet: EvmWalletRef, typedData: TypedDataInput): Promise<Hex> {
  const privy = getPrivy();
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
}

/** Sends a contract call from the wallet with Privy gas sponsorship (EIP-7702 + paymaster); polls for the final hash. */
export async function sendCallFor(wallet: EvmWalletRef, call: { to: Hex; data: Hex; value?: bigint; label?: string }): Promise<SentCall> {
  const privy = getPrivy();
  const env = loadEnv();
  const sponsor = env.PRIVY_GAS_SPONSORSHIP === "on";
  const res = await privy.wallets().ethereum().sendTransaction(wallet.walletId, {
    caip2: BASE_SEPOLIA_CAIP2,
    params: { transaction: { to: call.to, data: call.data, value: `0x${(call.value ?? 0n).toString(16)}`, chain_id: BASE_SEPOLIA.chainId } },
    sponsor,
  });
  let hash = res.hash;
  if (!hash && res.transaction_id) hash = await waitForPrivyHash(res.transaction_id);
  if (!hash) throw new Error("privy returned neither a hash nor a transaction id");
  log.info({ label: call.label, hash, sponsored: sponsor, userOp: res.user_operation_hash }, "privy call sent");
  return { hash, explorerUrl: baseTxUrl(hash), transactionId: res.transaction_id, userOperationHash: res.user_operation_hash, sponsored: sponsor };
}

/** Gasless USDC transfer out of the wallet (sponsored ERC-20 `transfer`). */
export function transferUsdcFrom(wallet: EvmWalletRef, p: { to: string; amountUsdc: string }): Promise<SentCall> {
  return sendCallFor(wallet, { to: BASE_SEPOLIA.usdc, data: encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [p.to as Hex, usdcToMicro(p.amountUsdc)] }), label: `usdc transfer ${p.amountUsdc}` });
}

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
