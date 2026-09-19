import { Keypair } from "@stellar/stellar-sdk";
import { CCTP, childLogger, getLatestLedger, invokeContract, roundDownToCctp, sc, stellarTxUrl, stroopsToUsdc, USDC_SAC, usdcToStroops, withAccountLock } from "@pera/core";
import { feeFromBps, getBurnFeeBps } from "./fees";

const log = childLogger("cctp.stellar");

/** 20-byte EVM address → 32-byte left-padded buffer (CCTP mint_recipient / destination_caller). */
export function evmAddressToBytes32(addr: string): Buffer {
  const hex = addr.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{40}$/.test(hex)) throw new Error(`invalid EVM address ${addr}`);
  return Buffer.concat([Buffer.alloc(12), Buffer.from(hex, "hex")]);
}

export interface BurnResult {
  approveTxHash: string;
  burnTxHash: string;
  explorerUrl: string;
  /** amount actually burned (rounded down to 6 dp) */
  amountUsdc: string;
  maxFee: string;
}

/**
 * `approve` + `deposit_for_burn` on the Stellar TokenMessengerMinter. The caller (agent float) is
 * the inner tx source, so its signature satisfies `caller.require_auth()`; SPONSOR fee-bumps.
 */
export async function approveAndBurn(p: { callerSecret: string; sponsorSecret: string; amountUsdc: string; evmRecipient: string }): Promise<BurnResult> {
  const caller = Keypair.fromSecret(p.callerSecret);
  const stroops = roundDownToCctp(usdcToStroops(p.amountUsdc));
  if (stroops <= 0n) throw new Error("amount too small for CCTP (needs ≥ 0.000001 USDC)");
  const bps = await getBurnFeeBps();
  const maxFee = feeFromBps(stroops, bps);
  const expiration = (await getLatestLedger()) + 1000;

  return withAccountLock(caller.publicKey(), async () => {
    const approve = await invokeContract({
      contractId: USDC_SAC,
      method: "approve",
      args: [sc.scAddress(caller.publicKey()), sc.scAddress(CCTP.tokenMessengerMinter), sc.scI128(stroops), sc.scU32(expiration)],
      sourceSecret: p.callerSecret,
      sponsorSecret: p.sponsorSecret,
    });
    log.info({ hash: approve.hash }, "approved TokenMessengerMinter");
    const burn = await invokeContract({
      contractId: CCTP.tokenMessengerMinter,
      method: "deposit_for_burn",
      args: [
        sc.scAddress(caller.publicKey()),
        sc.scI128(stroops),
        sc.scU32(CCTP.baseSepoliaDomain),
        sc.scBytes32(evmAddressToBytes32(p.evmRecipient)),
        sc.scAddress(USDC_SAC),
        sc.scBytes32(Buffer.alloc(32)),
        sc.scI128(maxFee),
        sc.scU32(CCTP.minFinalityThreshold),
      ],
      sourceSecret: p.callerSecret,
      sponsorSecret: p.sponsorSecret,
    });
    log.info({ hash: burn.hash, amountUsdc: stroopsToUsdc(stroops) }, "USDC burned for Base Sepolia");
    return { approveTxHash: approve.hash, burnTxHash: burn.hash, explorerUrl: stellarTxUrl(burn.hash), amountUsdc: stroopsToUsdc(stroops), maxFee: stroopsToUsdc(maxFee) };
  });
}
