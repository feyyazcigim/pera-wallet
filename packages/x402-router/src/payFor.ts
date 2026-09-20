import { FeeBumpTransaction, TransactionBuilder } from "@stellar/stellar-sdk";
import type { PaymentPayload, PaymentRequired } from "@x402/core/types";
import { baseTxUrl, BASE_SEPOLIA_CAIP2, childLogger, cmpUsdc, events, maxUsdc, NETWORK_PASSPHRASE, STELLAR_CAIP2, stellarTxUrl, subUsdc, type Caip2Network, loadEnv } from "@pera/core";
import { bridgeToBase } from "@pera/cctp";
import { getBaseUsdcBalance, type EvmWalletRef } from "@pera/evm";
import { httpClientFor } from "./client";
import { ensureFloat, type FloatCtx, type FloatPlan } from "./ensureFloat";
import { narrowTo, offersFrom, pickOffer, type Offer, type Preference } from "./parse";

const log = childLogger("router.pay");

/** A user-set agent rule (allowed chains, max per call, weekly limit) refused this payment before anything was signed. */
export class RuleViolationError extends Error {
  constructor(
    message: string,
    readonly rule: "allowed_chains" | "max_per_call" | "weekly_limit",
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "RuleViolationError";
  }
}

/** A payment above the user's approval threshold needs a human decision in the dashboard first (Stripe-style). */
export class ApprovalRequiredError extends Error {
  constructor(
    readonly approvalId: string,
    readonly approveUrl: string,
    readonly amountUsdc: string,
    readonly network: string,
    readonly expiresAt: string,
    readonly url: string,
  ) {
    super(`payment of ${amountUsdc} USDC to ${url} needs the owner's approval (approval ${approvalId}); approve it at ${approveUrl} and retry with approval_id`);
    this.name = "ApprovalRequiredError";
  }
}

export class PaywallError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "PaywallError";
  }
}

export interface PayResult {
  url: string;
  paid: boolean;
  status: number;
  body: unknown;
  network?: Caip2Network;
  amountUsdc?: string;
  payTo?: string;
  txHash?: string;
  explorerUrl?: string;
  payer?: string;
  float?: FloatPlan;
  bridged?: { burnTxHash: string; mintTxHash: string; amountUsdc: string };
  offers?: Array<Pick<Offer, "network" | "amountUsdc" | "payTo">>;
}

export type PayCtx = FloatCtx & { evmWallet?: EvmWalletRef };

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface Quote {
  url: string;
  /** HTTP status of the probe: 402 = paywalled, 200 = free, anything else = error */
  status: number;
  paywalled: boolean;
  offers: Array<Pick<Offer, "network" | "amountUsdc" | "payTo" | "asset">>;
  /** The offer the router would pay (after allowedNetworks + preference). */
  offer?: Offer;
  /** Offers the paywall advertised but the rules exclude. */
  excludedNetworks: string[];
  body?: unknown;
  resource?: { url?: string; description?: string; mimeType?: string };
}

/**
 * Probes `url` and parses the 402 without funding or signing anything: what would it cost, on which
 * network, to whom. Used by `quote_payment` and as the first step of `payFor`.
 */
export async function quoteFor(ctx: PayCtx, url: string, o: { prefer?: Preference; init?: RequestInit; allowedNetworks?: string[] } = {}): Promise<Quote & { paymentRequired?: PaymentRequired; probeBody?: unknown }> {
  const probe = await fetch(url, o.init);
  if (probe.status !== 402) {
    const body = await readBody(probe);
    if (!probe.ok) throw new PaywallError(`${o.init?.method ?? "GET"} ${url} → ${probe.status}`, probe.status, body);
    return { url, status: probe.status, paywalled: false, offers: [], excludedNetworks: [], body };
  }
  const probeBody = await readBody(probe);
  const decoder = httpClientFor(STELLAR_CAIP2, ctx);
  const paymentRequired = decoder.getPaymentRequiredResponse((n) => probe.headers.get(n), probeBody);
  let offers = offersFrom(paymentRequired);
  if (!ctx.evmWallet) offers = offers.filter((x) => x.network !== BASE_SEPOLIA_CAIP2);
  const advertised = offers.map((x) => x.network);
  if (o.allowedNetworks) offers = offers.filter((x) => o.allowedNetworks!.includes(x.network));
  const excludedNetworks = advertised.filter((n) => !offers.some((x) => x.network === n));
  const offer = offers.length > 0 ? pickOffer(offers, o.prefer ?? "auto") : undefined;
  const resource = (paymentRequired as { resource?: { url?: string; description?: string; mimeType?: string } }).resource;
  return {
    url,
    status: 402,
    paywalled: true,
    offers: offers.map((x) => ({ network: x.network, amountUsdc: x.amountUsdc, payTo: x.payTo, asset: x.asset })),
    offer,
    excludedNetworks,
    resource,
    paymentRequired,
    probeBody,
  };
}

/**
 * Fetches `url` for the user; on HTTP 402 selects a supported offer, funds the payer just in time and
 * retries with a signed payment. Stellar offers are paid from the user's agent float (fees sponsored by
 * the facilitator); EVM offers are paid from the user's EVM wallet after a CCTP bridge when short.
 */
export async function payFor(
  ctx: PayCtx,
  url: string,
  o: { prefer?: Preference; bridgeMinUsdc?: string; init?: RequestInit; allowedNetworks?: string[]; beforePay?: (offer: Offer) => Promise<void> | void } = {},
): Promise<PayResult> {
  const q = await quoteFor(ctx, url, { prefer: o.prefer, init: o.init, allowedNetworks: o.allowedNetworks });
  if (!q.paywalled) return { url, paid: false, status: q.status, body: q.body };
  const paymentRequired = q.paymentRequired!;
  const probeBody = q.probeBody;
  if (!q.offer) {
    if (q.excludedNetworks.length > 0) {
      throw new RuleViolationError(`this paywall only accepts ${q.excludedNetworks.join(", ")}, which your rules do not allow`, "allowed_chains", { url, offered: q.excludedNetworks, allowed: o.allowedNetworks });
    }
    throw new Error("no supported network in 402 accepts");
  }
  const offer = q.offer;
  const offers = q.offers;
  await o.beforePay?.(offer);
  events.emit({ type: "x402.402", userId: ctx.userId, amountUsdc: offer.amountUsdc, network: offer.network, detail: { url, payTo: offer.payTo, offers } });
  log.info({ userId: ctx.userId, url, network: offer.network, amountUsdc: offer.amountUsdc }, "402 received");

  const result: PayResult = { url, paid: false, status: 402, body: probeBody, network: offer.network, amountUsdc: offer.amountUsdc, payTo: offer.payTo, offers: offers.map((x) => ({ network: x.network, amountUsdc: x.amountUsdc, payTo: x.payTo })) };

  if (offer.network === STELLAR_CAIP2) {
    result.float = await ensureFloat(ctx, { neededUsdc: offer.amountUsdc });
  } else {
    const wallet = ctx.evmWallet!;
    const have = await getBaseUsdcBalance(wallet.address);
    if (cmpUsdc(have, offer.amountUsdc) < 0) {
      const bridgeAmt = maxUsdc(subUsdc(offer.amountUsdc, have), o.bridgeMinUsdc ?? loadEnv().BASE_BRIDGE_MIN_USDC);
      result.float = await ensureFloat(ctx, { neededUsdc: bridgeAmt });
      const b = await bridgeToBase({ userId: ctx.userId, agentSecret: ctx.agentSecret, agentPub: ctx.agentPub, evmWallet: wallet }, { amountUsdc: bridgeAmt });
      result.bridged = { burnTxHash: b.burnTxHash, mintTxHash: b.mintTxHash, amountUsdc: b.amountUsdc };
    }
  }

  const client = httpClientFor(offer.network, ctx);
  let payload = await client.createPaymentPayload(narrowTo(paymentRequired, offer));
  if (offer.network === STELLAR_CAIP2) payload = withMinimalFee(payload);
  const headers = client.encodePaymentSignatureHeader(payload);

  const paid = await fetch(url, { ...o.init, headers: { ...(o.init?.headers as Record<string, string> | undefined), ...headers } });
  const body = await readBody(paid);
  if (!paid.ok) throw new PaywallError(`payment rejected by ${url} (${paid.status})`, paid.status, body);
  const settle = client.getPaymentSettleResponse((n) => paid.headers.get(n));
  const explorerUrl = offer.network === STELLAR_CAIP2 ? stellarTxUrl(settle.transaction) : baseTxUrl(settle.transaction);
  events.emit({ type: "x402.paid", userId: ctx.userId, amountUsdc: offer.amountUsdc, network: offer.network, txHash: settle.transaction, explorerUrl, detail: { url, payTo: offer.payTo, payer: settle.payer } });
  log.info({ userId: ctx.userId, url, network: offer.network, tx: settle.transaction }, "paid");
  return { ...result, paid: true, status: paid.status, body, txHash: settle.transaction, explorerUrl, payer: settle.payer };
}

/** Mirrors the official Stellar x402 quickstart: 1-stroop inclusion fee so the fee-sponsoring facilitator accepts it. */
function withMinimalFee(payload: PaymentPayload): PaymentPayload {
  const xdrTx = (payload.payload as { transaction?: string }).transaction;
  if (!xdrTx) return payload;
  const tx = TransactionBuilder.fromXDR(xdrTx, NETWORK_PASSPHRASE);
  if (tx instanceof FeeBumpTransaction) return payload;
  const sorobanData = tx.toEnvelope().v1()?.tx()?.ext()?.sorobanData();
  if (!sorobanData) return payload;
  const rebuilt = TransactionBuilder.cloneFrom(tx, { fee: "1", sorobanData, networkPassphrase: NETWORK_PASSPHRASE }).build();
  return { ...payload, payload: { ...payload.payload, transaction: rebuilt.toXDR() } };
}
