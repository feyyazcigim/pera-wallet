import { BASE_SEPOLIA_CAIP2, childLogger, events, loadEnv, STELLAR_CAIP2, type UserWalletContext } from "@pera/core";
import { getBaseEthBalance, getBaseUsdcBalance, sponsorAddress, type EvmWalletRef } from "@pera/evm";
import { receiveOnBase } from "./evm";
import { waitForAttestation } from "./iris";
import { savePending } from "./pending";
import { approveAndBurn } from "./stellar";

const log = childLogger("cctp.bridge");

export interface BridgeResult {
  amountUsdc: string;
  burnTxHash: string;
  burnExplorerUrl: string;
  attestationNonce?: string;
  mintTxHash: string;
  mintExplorerUrl: string;
  recipient: string;
  baseUsdcAfter: string;
}

export type BridgeCtx = Pick<UserWalletContext, "userId" | "agentSecret" | "agentPub"> & { evmWallet: EvmWalletRef };

/**
 * Stellar (user's agent float) → Base Sepolia (user's EVM wallet) via Circle CCTP V2:
 * burn on Stellar → Iris attestation → receiveMessage on Base. Emits three timeline events.
 */
export async function bridgeToBase(ctx: BridgeCtx, p: { amountUsdc: string; onProgress?: (msg: string) => void }): Promise<BridgeResult> {
  const env = loadEnv();
  const recipient = ctx.evmWallet.address;
  const say = (m: string) => {
    log.info({ userId: ctx.userId }, m);
    p.onProgress?.(m);
  };

  // Never burn what we cannot mint: local wallets rely on the sponsor EOA's gas.
  if (ctx.evmWallet.provider === "local") {
    const s = sponsorAddress();
    const eth = s ? await getBaseEthBalance(s) : "0";
    if (Number(eth) <= 0) throw new Error(`EVM sponsor ${s} has no Base Sepolia ETH to relay receiveMessage; refusing to burn USDC on Stellar.`);
  }

  say(`burning ${p.amountUsdc} USDC on Stellar for ${recipient}`);
  const burn = await approveAndBurn({ callerSecret: ctx.agentSecret, sponsorSecret: env.SPONSOR_SECRET, amountUsdc: p.amountUsdc, evmRecipient: recipient });
  events.emit({ type: "bridge.burned", userId: ctx.userId, amountUsdc: burn.amountUsdc, network: STELLAR_CAIP2, txHash: burn.burnTxHash, explorerUrl: burn.explorerUrl, detail: { approveTxHash: burn.approveTxHash, recipient } });

  say("waiting for Circle attestation");
  const att = await waitForAttestation(burn.burnTxHash, { onPoll: (s) => p.onProgress?.(`iris: ${s}`) });
  events.emit({ type: "bridge.attested", userId: ctx.userId, amountUsdc: burn.amountUsdc, network: STELLAR_CAIP2, txHash: burn.burnTxHash, detail: { eventNonce: att.eventNonce } });

  say("minting on Base Sepolia");
  let mint;
  try {
    mint = await receiveOnBase({ message: att.message, attestation: att.attestation, wallet: ctx.evmWallet });
  } catch (err) {
    savePending({ userId: ctx.userId, burnTxHash: burn.burnTxHash, amountUsdc: burn.amountUsdc, recipient, createdAt: new Date().toISOString(), lastError: (err as Error).message.slice(0, 300) });
    throw new Error(`USDC burned on Stellar (${burn.burnTxHash}) and attested, but the Base Sepolia mint failed: ${(err as Error).message.split("\n")[0]}. Recorded as pending; run \`pnpm bridge:resume\`.`);
  }
  const baseUsdcAfter = await getBaseUsdcBalance(recipient);
  events.emit({ type: "bridge.minted", userId: ctx.userId, amountUsdc: burn.amountUsdc, network: BASE_SEPOLIA_CAIP2, txHash: mint.txHash, explorerUrl: mint.explorerUrl, detail: { recipient, baseUsdcAfter } });
  return { amountUsdc: burn.amountUsdc, burnTxHash: burn.burnTxHash, burnExplorerUrl: burn.explorerUrl, attestationNonce: att.eventNonce, mintTxHash: mint.txHash, mintExplorerUrl: mint.explorerUrl, recipient, baseUsdcAfter };
}
