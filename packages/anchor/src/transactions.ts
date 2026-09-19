
import { getAuthed } from "./client";

/** Normalised SEP-6 transaction (the anchor returns snake_case JSON). */
export interface AnchorTx {
  id: string;
  kind: "deposit" | "withdrawal";
  status: string;
  statusEta?: number;
  message?: string;
  amountIn?: string;
  amountInAsset?: string;
  amountOut?: string;
  amountOutAsset?: string;
  amountFee?: string;
  stellarTransactionId?: string;
  externalTransactionId?: string;
  claimableBalanceId?: string;
  moreInfoUrl?: string;
  startedAt?: string;
  completedAt?: string;
  raw: Record<string, unknown>;
}

export const TERMINAL_OK = ["completed"];
export const TERMINAL_ERROR = ["error", "refunded", "expired", "no_market", "too_small", "too_large"];

export function normaliseTx(raw: Record<string, unknown>): AnchorTx {
  const s = (k: string) => (raw[k] === undefined || raw[k] === null ? undefined : String(raw[k]));
  return {
    id: String(raw.id),
    kind: raw.kind === "withdrawal" ? "withdrawal" : "deposit",
    status: String(raw.status),
    statusEta: typeof raw.status_eta === "number" ? raw.status_eta : undefined,
    message: s("message"),
    amountIn: s("amount_in"),
    amountInAsset: s("amount_in_asset"),
    amountOut: s("amount_out"),
    amountOutAsset: s("amount_out_asset"),
    amountFee: s("amount_fee"),
    stellarTransactionId: s("stellar_transaction_id"),
    externalTransactionId: s("external_transaction_id"),
    claimableBalanceId: s("claimable_balance_id"),
    moreInfoUrl: s("more_info_url"),
    startedAt: s("started_at"),
    completedAt: s("completed_at"),
    raw,
  };
}

export async function getAnchorTx(p: { accountSecret: string; id: string }): Promise<AnchorTx> {
  const { anchor, authToken } = await getAuthed(p.accountSecret);
  const tx = await anchor.sep6().getTransactionBy({ authToken, id: p.id });
  return normaliseTx(tx as unknown as Record<string, unknown>);
}

/**
 * Polls the anchor until the transaction reaches a terminal state. Calls `onStatus` on every
 * status change so callers (smoke scripts, API) can narrate progress.
 */
export async function waitForStatus(p: {
  accountSecret: string;
  id: string;
  timeoutMs?: number;
  intervalMs?: number;
  onStatus?: (tx: AnchorTx) => void;
}): Promise<AnchorTx> {
  const started = Date.now();
  const timeout = p.timeoutMs ?? 180_000;
  const interval = p.intervalMs ?? 4_000;
  let last = "";
  for (;;) {
    const tx = await getAnchorTx({ accountSecret: p.accountSecret, id: p.id });
    if (tx.status !== last) {
      last = tx.status;
      p.onStatus?.(tx);
    }
    if (TERMINAL_OK.includes(tx.status)) return tx;
    if (TERMINAL_ERROR.includes(tx.status)) {
      throw new Error(`anchor transaction ${p.id} ended with status "${tx.status}": ${tx.message ?? ""}`);
    }
    if (Date.now() - started > timeout) throw new Error(`timeout waiting for anchor transaction ${p.id} (last status ${tx.status})`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

