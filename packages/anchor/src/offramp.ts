import { events, sendClassicPayment, stellarTxUrl, USDC_CODE, childLogger } from "@pera/core";
import { getAuthed } from "./client";
import { type AnchorTx, waitForStatus } from "./transactions";

const log = childLogger("anchor.offramp");

export interface OfframpStart {
  id: string;
  accountId: string;
  memo: string;
  memoType: string;
  amountUsdc: string;
  eta?: number;
  feePercent?: number;
  paymentUri?: string;
}

/** SEP-6 withdraw: returns the anchor's treasury account and the id memo to attach to the USDC payment. */
export async function startOfframp(p: { accountSecret: string; amountUsdc: string }): Promise<OfframpStart> {
  const { anchor, authToken } = await getAuthed(p.accountSecret);
  const res = await anchor.sep6().withdraw({
    authToken,
    params: { asset_code: USDC_CODE, type: "bank_account", amount: p.amountUsdc },
  });
  if (!("account_id" in res) || !res.account_id || !res.memo || !res.id) {
    throw new Error(`anchor did not start the withdrawal: ${JSON.stringify(res)}`);
  }
  const extra = (res.extra_info ?? {}) as Record<string, unknown>;
  return {
    id: res.id,
    accountId: res.account_id,
    memo: res.memo,
    memoType: res.memo_type ?? "id",
    amountUsdc: p.amountUsdc,
    eta: res.eta,
    feePercent: res.fee_percent,
    paymentUri: typeof extra.payment_uri === "string" ? extra.payment_uri : undefined,
  };
}

/** Full off-ramp: withdraw request → USDC payment with id memo → wait for `completed` → emit event. */
export async function offrampUsdcToTry(p: {
  accountSecret: string;
  amountUsdc: string;
  onStatus?: (tx: AnchorTx) => void;
}): Promise<{ start: OfframpStart; paymentTxHash: string; tx: AnchorTx }> {
  const start = await startOfframp(p);
  if (start.memoType !== "id") throw new Error(`unexpected memo type from anchor: ${start.memoType}`);
  const payment = await sendClassicPayment({
    sourceSecret: p.accountSecret,
    destination: start.accountId,
    amountUsdc: p.amountUsdc,
    memoId: start.memo,
  });
  log.info({ id: start.id, hash: payment.hash }, "USDC sent to anchor treasury");
  const tx = await waitForStatus({ accountSecret: p.accountSecret, id: start.id, onStatus: p.onStatus });
  events.emit({
    type: "offramp.completed",
    amountUsdc: p.amountUsdc,
    network: "stellar:testnet",
    txHash: payment.hash,
    explorerUrl: stellarTxUrl(payment.hash),
    detail: { anchorTxId: tx.id, amountTry: tx.amountOut, feeUsdc: tx.amountFee },
  });
  return { start, paymentTxHash: payment.hash, tx };
}
