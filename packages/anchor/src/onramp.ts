import { ANCHOR, events, stellarTxUrl, USDC_CODE, childLogger } from "@pera/core";
import { getAuthed, publicKeyOf } from "./client";
import { type AnchorTx, waitForStatus } from "./transactions";

const log = childLogger("anchor.onramp");

export interface OnrampInstructions {
  bankName?: string;
  iban?: string;
  memo?: string;
}

export interface OnrampStart {
  id: string;
  amountTry: string;
  instructions: OnrampInstructions;
  how?: string;
  eta?: number;
  feePercent?: number;
  minAmountTry?: number;
  maxAmountTry?: number;
}

/**
 * SEP-6 deposit: the anchor returns bank instructions (IBAN + reference). In the sandbox the "wire"
 * is simulated with `simulateBankTransfer`.
 */
export async function startOnramp(p: { accountSecret: string; amountTry: string; userId?: string; silent?: boolean }): Promise<OnrampStart> {
  const { anchor, authToken } = await getAuthed(p.accountSecret);
  const account = publicKeyOf(p.accountSecret);
  const res = await anchor.sep6().deposit({
    authToken,
    params: {
      asset_code: USDC_CODE,
      account,
      amount: p.amountTry,
      type: "bank_account",
      // The anchor expects funding_method; the SDK type only knows `type`, so pass both.
      ...({ funding_method: "bank_account" } as Record<string, string>),
      claimable_balance_supported: "true",
    },
  });
  if (!("id" in res) || !res.id) {
    throw new Error(`anchor did not start the deposit: ${JSON.stringify(res)}`);
  }
  const instr = (res.instructions ?? {}) as Record<string, { value: string; description?: string }>;
  const r = res as unknown as Record<string, unknown>;
  const start: OnrampStart = {
    id: res.id,
    amountTry: p.amountTry,
    instructions: {
      bankName: instr.bank_name?.value,
      iban: instr.bank_account_number?.value,
      memo: instr.external_transfer_memo?.value,
    },
    how: res.how,
    eta: res.eta,
    feePercent: res.fee_percent,
    minAmountTry: typeof r.min_amount === "number" ? (r.min_amount as number) : undefined,
    maxAmountTry: res.max_amount,
  };
  if (!p.silent) events.emit({ type: "onramp.started", userId: p.userId, detail: { anchorTxId: start.id, amountTry: p.amountTry, iban: start.instructions.iban, memo: start.instructions.memo } });
  log.info({ id: start.id, amountTry: p.amountTry }, "onramp started");
  return start;
}

/** Sandbox-only: plays the bank. No SEP-10 token required. */
export async function simulateBankTransfer(id: string, amountTry: string): Promise<void> {
  const res = await fetch(`${ANCHOR.baseUrl}/sep6/tx/${encodeURIComponent(id)}/simulate-bank-transfer`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ amount: amountTry }),
  });
  if (!res.ok) throw new Error(`simulate-bank-transfer failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  log.info({ id, amountTry }, "bank transfer simulated");
}

/** Full sandbox on-ramp: start → simulate wire → wait for `completed` → emit `onramp.completed`. */
export async function onrampTryToUsdc(p: {
  accountSecret: string;
  amountTry: string;
  userId?: string;
  onStatus?: (tx: AnchorTx) => void;
}): Promise<{ start: OnrampStart; tx: AnchorTx }> {
  const start = await startOnramp(p);
  await simulateBankTransfer(start.id, p.amountTry);
  const tx = await waitForStatus({ accountSecret: p.accountSecret, id: start.id, onStatus: p.onStatus });
  events.emit({
    type: "onramp.completed",
    userId: p.userId,
    amountUsdc: tx.amountOut,
    network: "stellar:testnet",
    txHash: tx.stellarTransactionId,
    explorerUrl: tx.stellarTransactionId ? stellarTxUrl(tx.stellarTransactionId) : undefined,
    detail: { anchorTxId: tx.id, amountTry: tx.amountIn, feeUsdc: tx.amountFee, claimableBalanceId: tx.claimableBalanceId },
  });
  return { start, tx };
}
