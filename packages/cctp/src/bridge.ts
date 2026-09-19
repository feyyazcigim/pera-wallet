import { BASE_SEPOLIA_CAIP2, childLogger, events, loadEnv, STELLAR_CAIP2 } from "@pera/core";
import { getBaseEthBalance, getBaseUsdcBalance, getEvmClients, receiveOnBase } from "./evm";
import { savePending } from "./pending";
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

  // Never burn what we cannot mint: receiveMessage on Base needs gas from the EVM sponsor.
  const eth = await getBaseEthBalance();
  if (Number(eth) <= 0) {
    throw new Error(`EVM sponsor ${account.address} has no Base Sepolia ETH to pay for receiveMessage; refusing to burn USDC on Stellar. Fund it from a Base Sepolia faucet.`);
  }

  say(`burning ${p.amountUsdc} USDC on Stellar for ${account.address}`);
  const burn = await approveAndBurn({ callerSecret: env.AGENT_SECRET, sponsorSecret: env.SPONSOR_SECRET, amountUsdc: p.amountUsdc, evmRecipient: account.address });
  events.emit({ type: "bridge.burned", amountUsdc: burn.amountUsdc, network: STELLAR_CAIP2, txHash: burn.burnTxHash, explorerUrl: burn.explorerUrl, detail: { approveTxHash: burn.approveTxHash, recipient: account.address } });

  say("waiting for Circle attestation");
  const att = await waitForAttestation(burn.burnTxHash, { onPoll: (s) => p.onProgress?.(`iris: ${s}`) });
  events.emit({ type: "bridge.attested", amountUsdc: burn.amountUsdc, network: STELLAR_CAIP2, txHash: burn.burnTxHash, detail: { eventNonce: att.eventNonce } });

  say("minting on Base Sepolia");
  let mint;
  try {
    mint = await receiveOnBase({ message: att.message, attestation: att.attestation });
  } catch (err) {
    savePending({ burnTxHash: burn.burnTxHash, amountUsdc: burn.amountUsdc, recipient: account.address, createdAt: new Date().toISOString(), lastError: (err as Error).message.slice(0, 300) });
    throw new Error(`USDC burned on Stellar (${burn.burnTxHash}) and attested, but the Base Sepolia mint failed: ${(err as Error).message.split("\n")[0]}. The bridge is recorded as pending; run \`pnpm bridge:resume\` to complete it.`);
  }
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
