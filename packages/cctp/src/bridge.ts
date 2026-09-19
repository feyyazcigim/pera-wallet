import { BASE_SEPOLIA_CAIP2, childLogger, events, loadEnv, STELLAR_CAIP2 } from "@pera/core";
import { getBaseUsdcBalance, getEvmClients, receiveOnBase } from "./evm";
import { waitForAttestation } from "./iris";
import { approveAndBurn } from "./stellar";

const log = childLogger("cctp.bridge");

export interface BridgeResult {
  amountUsdc: string;
  burnTxHash: string;
  burnExplorerUrl: string;
  attestationNonce?: string;
  mintTxHash: string;
  mintExplorerUrl: string;
  baseUsdcAfter: string;
}

/**
 * Stellar (agent float) → Base Sepolia (EVM sponsor) via Circle CCTP V2:
 * burn on Stellar → Iris attestation → receiveMessage on Base. Emits three timeline events.
 */
export async function bridgeToBase(p: { amountUsdc: string; onProgress?: (msg: string) => void }): Promise<BridgeResult> {
  const env = loadEnv();
  const { account } = getEvmClients();
  const say = (m: string) => {
    log.info(m);
    p.onProgress?.(m);
  };

  say(`burning ${p.amountUsdc} USDC on Stellar for ${account.address}`);
  const burn = await approveAndBurn({ callerSecret: env.AGENT_SECRET, sponsorSecret: env.SPONSOR_SECRET, amountUsdc: p.amountUsdc, evmRecipient: account.address });
  events.emit({ type: "bridge.burned", amountUsdc: burn.amountUsdc, network: STELLAR_CAIP2, txHash: burn.burnTxHash, explorerUrl: burn.explorerUrl, detail: { approveTxHash: burn.approveTxHash, recipient: account.address } });

  say("waiting for Circle attestation");
  const att = await waitForAttestation(burn.burnTxHash, { onPoll: (s) => p.onProgress?.(`iris: ${s}`) });
  events.emit({ type: "bridge.attested", amountUsdc: burn.amountUsdc, network: STELLAR_CAIP2, txHash: burn.burnTxHash, detail: { eventNonce: att.eventNonce } });

  say("minting on Base Sepolia");
  const mint = await receiveOnBase({ message: att.message, attestation: att.attestation });
  const baseUsdcAfter = await getBaseUsdcBalance();
  events.emit({ type: "bridge.minted", amountUsdc: burn.amountUsdc, network: BASE_SEPOLIA_CAIP2, txHash: mint.txHash, explorerUrl: mint.explorerUrl, detail: { recipient: account.address, baseUsdcAfter } });
  return {
    amountUsdc: burn.amountUsdc,
    burnTxHash: burn.burnTxHash,
    burnExplorerUrl: burn.explorerUrl,
    attestationNonce: att.eventNonce,
    mintTxHash: mint.txHash,
    mintExplorerUrl: mint.explorerUrl,
    baseUsdcAfter,
  };
}
