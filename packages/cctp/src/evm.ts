import { createPublicClient, createWalletClient, formatUnits, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { BASE_SEPOLIA, baseTxUrl, childLogger, loadEnv, microToUsdc } from "@pera/core";

const log = childLogger("cctp.evm");

const MESSAGE_TRANSMITTER_V2_ABI = [
  {
    type: "function",
    name: "receiveMessage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

function makeClients(privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  const transport = http();
  return {
    account,
    wallet: createWalletClient({ account, chain: baseSepolia, transport }),
    pub: createPublicClient({ chain: baseSepolia, transport }),
  };
}

let cached: ReturnType<typeof makeClients> | undefined;

export function getEvmClients(): ReturnType<typeof makeClients> {
  if (cached) return cached;
  const env = loadEnv();
  if (!env.EVM_SPONSOR_PRIVATE_KEY) throw new Error("EVM_SPONSOR_PRIVATE_KEY missing");
  cached = makeClients(env.EVM_SPONSOR_PRIVATE_KEY as Hex);
  return cached;
}

export function getEvmAddress(): string | undefined {
  const env = loadEnv();
  return env.EVM_SPONSOR_PRIVATE_KEY ? privateKeyToAccount(env.EVM_SPONSOR_PRIVATE_KEY as Hex).address : undefined;
}

export async function getBaseUsdcBalance(address?: string): Promise<string> {
  const { pub, account } = getEvmClients();
  const raw = await pub.readContract({ address: BASE_SEPOLIA.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [(address ?? account.address) as Hex] });
  return microToUsdc(raw);
}

export async function getBaseEthBalance(address?: string): Promise<string> {
  const { pub, account } = getEvmClients();
  return formatUnits(await pub.getBalance({ address: (address ?? account.address) as Hex }), 18);
}

/** Submits the attested CCTP message to MessageTransmitterV2 on Base Sepolia (mints USDC). */
export async function receiveOnBase(p: { message: Hex; attestation: Hex }): Promise<{ txHash: string; explorerUrl: string; relayedByOther?: boolean }> {
  const { wallet, pub, account } = getEvmClients();
  try {
    const hash = await wallet.writeContract({
      account,
      chain: baseSepolia,
      address: BASE_SEPOLIA.messageTransmitterV2,
      abi: MESSAGE_TRANSMITTER_V2_ABI,
      functionName: "receiveMessage",
      args: [p.message, p.attestation],
    });
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error(`receiveMessage reverted: ${hash}`);
    log.info({ hash }, "USDC minted on Base Sepolia");
    return { txHash: hash, explorerUrl: baseTxUrl(hash) };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (/nonce already used|Nonce already used/i.test(msg)) {
      log.warn("message already relayed by a third party");
      return { txHash: "already-relayed", explorerUrl: baseTxUrl(""), relayedByOther: true };
    }
    throw err;
  }
}
