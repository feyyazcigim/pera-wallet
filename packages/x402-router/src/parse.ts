import type { PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { BASE_SEPOLIA_CAIP2, microToUsdc, STELLAR_CAIP2, stroopsToUsdc, type Caip2Network } from "@pera/core";

export interface Offer {
  scheme: string;
  network: Caip2Network;
  asset: string;
  /** raw atomic amount as advertised (7 dp on Stellar, 6 dp on EVM USDC) */
  amount: string;
  amountUsdc: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
  requirements: PaymentRequirements;
}

export type Preference = "auto" | "stellar" | "evm";

export const SUPPORTED: readonly Caip2Network[] = [STELLAR_CAIP2, BASE_SEPOLIA_CAIP2];

export function offerAmountUsdc(o: { network: string; amount: string }): string {
  if (o.network === STELLAR_CAIP2) return stroopsToUsdc(BigInt(o.amount));
  if (o.network.startsWith("eip155:")) return microToUsdc(BigInt(o.amount));
  return o.amount;
}

/** Offers we can pay, in the order advertised by the server. */
export function offersFrom(pr: PaymentRequired): Offer[] {
  return pr.accepts
    .filter((a) => a.scheme === "exact" && (SUPPORTED as string[]).includes(a.network))
    .map((a) => ({
      scheme: a.scheme,
      network: a.network as Caip2Network,
      asset: a.asset,
      amount: a.amount,
      amountUsdc: offerAmountUsdc(a),
      payTo: a.payTo,
      maxTimeoutSeconds: a.maxTimeoutSeconds,
      extra: a.extra ?? {},
      requirements: a,
    }));
}

/** Stellar first unless the caller prefers EVM. */
export function pickOffer(offers: Offer[], prefer: Preference = "auto"): Offer {
  if (offers.length === 0) throw new Error("no supported network in 402 accepts");
  const want = prefer === "evm" ? BASE_SEPOLIA_CAIP2 : STELLAR_CAIP2;
  const preferred = offers.find((o) => o.network === want);
  if (preferred) return preferred;
  if (prefer === "auto") return offers[0]!;
  const fallback = offers[0]!;
  return fallback;
}

/** Narrow a PaymentRequired to a single offer so the scheme client cannot pick another one. */
export function narrowTo(pr: PaymentRequired, offer: Offer): PaymentRequired {
  return { ...pr, accepts: [offer.requirements] };
}
