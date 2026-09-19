import { createPublicClient, createWalletClient, formatUnits, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { BASE_SEPOLIA, loadEnv, microToUsdc } from "@pera/core";

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  {
    type: "function",
    name: "transferWithAuthorization",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

function makePublicClient() {
  return createPublicClient({ chain: baseSepolia, transport: http() });
}
let pub: ReturnType<typeof makePublicClient> | undefined;
export function publicClient(): ReturnType<typeof makePublicClient> {
  if (!pub) pub = makePublicClient();
  return pub;
}

/** Backend hot wallet on Base Sepolia (pays gas for relayed calls; also the CCTP recipient in the legacy demo). */
export function sponsorAccount() {
  const env = loadEnv();
  if (!env.EVM_SPONSOR_PRIVATE_KEY) throw new Error("EVM_SPONSOR_PRIVATE_KEY missing");
  return privateKeyToAccount(env.EVM_SPONSOR_PRIVATE_KEY as Hex);
}

export function sponsorWalletClient() {
  return createWalletClient({ account: sponsorAccount(), chain: baseSepolia, transport: http() });
}

export function sponsorAddress(): string | undefined {
  const env = loadEnv();
  return env.EVM_SPONSOR_PRIVATE_KEY ? privateKeyToAccount(env.EVM_SPONSOR_PRIVATE_KEY as Hex).address : undefined;
}

export async function getBaseUsdcBalance(address: string): Promise<string> {
  const raw = await publicClient().readContract({ address: BASE_SEPOLIA.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [address as Hex] });
  return microToUsdc(raw);
}

export async function getBaseEthBalance(address: string): Promise<string> {
  return formatUnits(await publicClient().getBalance({ address: address as Hex }), 18);
}

export async function hasCode(address: string): Promise<boolean> {
  const code = await publicClient().getCode({ address: address as Hex });
  return Boolean(code && code !== "0x");
}

export async function waitForReceipt(hash: Hex, timeout = 180_000) {
  return publicClient().waitForTransactionReceipt({ hash, timeout });
}
