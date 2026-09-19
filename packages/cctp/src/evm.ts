import { encodeFunctionData, type Hex } from "viem";
import { BASE_SEPOLIA, baseTxUrl, childLogger } from "@pera/core";
import { sendCallFor, type EvmWalletRef } from "@pera/evm";

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

export { getBaseEthBalance, getBaseUsdcBalance } from "@pera/evm";

/**
 * Submits the attested CCTP message to MessageTransmitterV2 on Base Sepolia (mints USDC to the
 * message's recipient). Sent from the user's Privy wallet with gas sponsorship — `receiveMessage`
 * is permissionless, so any sender works.
 */
export async function receiveOnBase(p: { message: Hex; attestation: Hex; wallet: EvmWalletRef }): Promise<{ txHash: string; explorerUrl: string; relayedByOther?: boolean }> {
  const data = encodeFunctionData({ abi: MESSAGE_TRANSMITTER_V2_ABI, functionName: "receiveMessage", args: [p.message, p.attestation] });
  try {
    const sent = await sendCallFor(p.wallet, { to: BASE_SEPOLIA.messageTransmitterV2, data, label: "cctp receiveMessage" });
    log.info({ hash: sent.hash }, "USDC minted on Base Sepolia");
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
