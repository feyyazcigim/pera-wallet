import { CCTP, childLogger } from "@pera/core";

const log = childLogger("cctp.fees");

/** Minimum fee (bps) for Stellar → Base Sepolia at the standard finality threshold; 0 on testnet today. */
export async function getBurnFeeBps(): Promise<number> {
  try {
    const res = await fetch(`${CCTP.irisUrl}/v2/burn/USDC/fees/${CCTP.stellarDomain}/${CCTP.baseSepoliaDomain}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`fees ${res.status}`);
    const list = (await res.json()) as Array<{ finalityThreshold: number; minimumFee: number }>;
    const entry = list.find((e) => e.finalityThreshold === CCTP.minFinalityThreshold) ?? list[0];
    return entry ? Number(entry.minimumFee) : 0;
  } catch (err) {
    log.warn({ err: (err as Error).message }, "fee lookup failed; assuming 0 bps");
    return 0;
  }
}

/** ceil(amount × bps / 10 000) in the same units as `amount`. */
export function feeFromBps(amount: bigint, bps: number): bigint {
  const num = amount * BigInt(Math.ceil(bps * 100)); // bps may be fractional (e.g. 1.3)
  const den = 10_000n * 100n;
  return (num + den - 1n) / den;
}
