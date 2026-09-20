import { startOnramp } from "@pera/anchor";
import { createDepositOrder, getOpenDepositOrder } from "@pera/db";
import { loadContext } from "../context";

/** IBAN + reference the human uses to top the wallet up (reuses an open deposit order when there is one). */
export async function fundingInstructions(userId: string) {
  const open = await getOpenDepositOrder(userId);
  if (open) return { iban: open.iban, bankName: open.bankName, reference: open.reference, anchorTxId: open.anchorTxId, minTry: 50, maxTry: 3000, createdAt: open.createdAt };
  const ctx = await loadContext(userId);
  const start = await startOnramp({ accountSecret: ctx.treasurySecret, amountTry: "3000", userId: ctx.userId, silent: true });
  if (!start.instructions.iban || !start.instructions.memo) throw Object.assign(new Error("the anchor returned no bank instructions"), { statusCode: 502, code: "ANCHOR_ERROR" });
  const order = await createDepositOrder({ reference: start.instructions.memo, userId, anchorTxId: start.id, iban: start.instructions.iban, bankName: start.instructions.bankName });
  return { iban: order.iban, bankName: order.bankName, reference: order.reference, anchorTxId: order.anchorTxId, minTry: start.minAmountTry ?? 50, maxTry: 3000, createdAt: order.createdAt };
}
