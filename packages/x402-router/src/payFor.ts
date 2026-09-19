import { FeeBumpTransaction, TransactionBuilder } from "@stellar/stellar-sdk";
import type { PaymentPayload } from "@x402/core/types";
import { baseTxUrl, BASE_SEPOLIA_CAIP2, childLogger, cmpUsdc, events, loadEnv, maxUsdc, NETWORK_PASSPHRASE, STELLAR_CAIP2, stellarTxUrl, subUsdc, type Caip2Network } from "@pera/core";
import { bridgeToBase, getBaseUsdcBalance } from "@pera/cctp";
import { httpClientFor } from "./client";
import { ensureFloat, type FloatPlan } from "./ensureFloat";
import { narrowTo, offersFrom, pickOffer, type Offer, type Preference } from "./parse";

const log = childLogger("router.pay");

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

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Fetches `url`; on HTTP 402 selects a supported offer, funds the payer just in time and retries
 * with a signed payment. Stellar offers are paid from the agent float (fees sponsored by the
 * facilitator); EVM offers are paid on Base Sepolia after a CCTP bridge when the balance is short.
 */
export async function payFor(url: string, o: { prefer?: Preference; bridgeMinUsdc?: string; init?: RequestInit } = {}): Promise<PayResult> {
  const probe = await fetch(url, o.init);
  if (probe.status !== 402) {
    const body = await readBody(probe);
    if (!probe.ok) throw new PaywallError(`GET ${url} → ${probe.status}`, probe.status, body);
    return { url, paid: false, status: probe.status, body };
  }
  const probeBody = await readBody(probe);
  const http = httpClientFor(STELLAR_CAIP2); // decoding is network-agnostic
  const paymentRequired = http.getPaymentRequiredResponse((n) => probe.headers.get(n), probeBody);
  const offers = offersFrom(paymentRequired);
  const offer = pickOffer(offers, o.prefer ?? "auto");
  events.emit({
    type: "x402.402",
    amountUsdc: offer.amountUsdc,
    network: offer.network,
    detail: { url, payTo: offer.payTo, offers: offers.map((x) => ({ network: x.network, amountUsdc: x.amountUsdc })) },
  });
  log.info({ url, network: offer.network, amountUsdc: offer.amountUsdc }, "402 received");

  const result: PayResult = { url, paid: false, status: 402, body: probeBody, network: offer.network, amountUsdc: offer.amountUsdc, payTo: offer.payTo, offers: offers.map((x) => ({ network: x.network, amountUsdc: x.amountUsdc, payTo: x.payTo })) };

  if (offer.network === STELLAR_CAIP2) {
    result.float = await ensureFloat({ neededUsdc: offer.amountUsdc });
  } else {
    const have = await getBaseUsdcBalance();
    if (cmpUsdc(have, offer.amountUsdc) < 0) {
      const bridgeAmt = maxUsdc(subUsdc(offer.amountUsdc, have), o.bridgeMinUsdc ?? "1");
      result.float = await ensureFloat({ neededUsdc: bridgeAmt });
      const b = await bridgeToBase({ amountUsdc: bridgeAmt });
      result.bridged = { burnTxHash: b.burnTxHash, mintTxHash: b.mintTxHash, amountUsdc: b.amountUsdc };
    }
  }

  const client = httpClientFor(offer.network);
  let payload = await client.createPaymentPayload(narrowTo(paymentRequired, offer));
  if (offer.network === STELLAR_CAIP2) payload = withMinimalFee(payload);
  const headers = client.encodePaymentSignatureHeader(payload);

  const paid = await fetch(url, { ...o.init, headers: { ...(o.init?.headers as Record<string, string> | undefined), ...headers } });
  const body = await readBody(paid);
  if (!paid.ok) throw new PaywallError(`payment rejected by ${url} (${paid.status})`, paid.status, body);
  const settle = client.getPaymentSettleResponse((n) => paid.headers.get(n));
  const explorerUrl = offer.network === STELLAR_CAIP2 ? stellarTxUrl(settle.transaction) : baseTxUrl(settle.transaction);
  events.emit({ type: "x402.paid", amountUsdc: offer.amountUsdc, network: offer.network, txHash: settle.transaction, explorerUrl, detail: { url, payTo: offer.payTo, payer: settle.payer } });
  log.info({ url, network: offer.network, tx: settle.transaction }, "paid");
  return { ...result, paid: true, status: paid.status, body, txHash: settle.transaction, explorerUrl, payer: settle.payer };
}

/**
 * Mirrors the official Stellar x402 quickstart: rebuild the payer-signed transaction with a 1-stroop
 * inclusion fee so the fee-sponsoring testnet facilitator does not reject it for exceeding its
 * fee ceiling. Auth entries (the payer's signature) are preserved by `cloneFrom`.
 */
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

export { BASE_SEPOLIA_CAIP2 };
