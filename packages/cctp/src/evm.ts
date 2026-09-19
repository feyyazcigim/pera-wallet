import { encodeFunctionData, type Hex } from "viem";
import { BASE_SEPOLIA, baseTxUrl, childLogger } from "@pera/core";
import { getBaseEthBalance as ethBalance, getBaseUsdcBalance as usdcBalance, sendCallFor, sponsorAddress, type EvmWalletRef } from "@pera/evm";

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

/** Legacy single-user demo recipient = the backend EVM sponsor. */
export function getEvmAddress(): string | undefined {
  return sponsorAddress();
}

export async function getBaseUsdcBalance(address?: string): Promise<string> {
  const a = address ?? sponsorAddress();
  if (!a) throw new Error("no EVM address");
  return usdcBalance(a);
}

export async function getBaseEthBalance(address?: string): Promise<string> {
  const a = address ?? sponsorAddress();
  if (!a) throw new Error("no EVM address");
  return ethBalance(a);
}

/**
 * Submits the attested CCTP message to MessageTransmitterV2 on Base Sepolia (mints USDC to the
 * message's recipient). Sent from the user's wallet through its provider (Privy sponsored, or the
 * sponsor EOA for local wallets) — `receiveMessage` is permissionless, so any sender works.
 */
export async function receiveOnBase(p: { message: Hex; attestation: Hex; wallet: EvmWalletRef }): Promise<{ txHash: string; explorerUrl: string; relayedByOther?: boolean }> {
  const data = encodeFunctionData({ abi: MESSAGE_TRANSMITTER_V2_ABI, functionName: "receiveMessage", args: [p.message, p.attestation] });
  try {
    const sent = await sendCallFor(p.wallet, { to: BASE_SEPOLIA.messageTransmitterV2, data, label: "cctp receiveMessage" });
    log.info({ hash: sent.hash, provider: p.wallet.provider }, "USDC minted on Base Sepolia");
    return { txHash: sent.hash, explorerUrl: sent.explorerUrl };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (/nonce already used/i.test(msg)) {
      log.warn("message already relayed by a third party");
      return { txHash: "already-relayed", explorerUrl: baseTxUrl(""), relayedByOther: true };
    }
    throw err;
  }
}
