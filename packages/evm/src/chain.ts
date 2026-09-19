import { createPublicClient, formatUnits, http, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { BASE_SEPOLIA, microToUsdc } from "@pera/core";

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

function makePublicClient() {
  return createPublicClient({ chain: baseSepolia, transport: http() });
}
let pub: ReturnType<typeof makePublicClient> | undefined;
export function publicClient(): ReturnType<typeof makePublicClient> {
  if (!pub) pub = makePublicClient();
  return pub;
}

export async function getBaseUsdcBalance(address: string): Promise<string> {
  const raw = await publicClient().readContract({ address: BASE_SEPOLIA.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [address as Hex] });
  return microToUsdc(raw);
}

export async function getBaseEthBalance(address: string): Promise<string> {
  return formatUnits(await publicClient().getBalance({ address: address as Hex }), 18);
}

/** True once a Privy wallet has been gas-sponsored (EIP-7702 delegation leaves code at the address). */
export async function hasCode(address: string): Promise<boolean> {
  const code = await publicClient().getCode({ address: address as Hex });
  return Boolean(code && code !== "0x");
}
