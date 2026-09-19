import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BASE_SEPOLIA_CAIP2, childLogger, events, resolveEventsFile } from "@pera/core";
import { getBaseUsdcBalance, type EvmWalletRef } from "@pera/evm";
import { receiveOnBase } from "./evm";
import { waitForAttestation } from "./iris";

const log = childLogger("cctp.pending");

/** A burn that was attested but not yet minted on Base — e.g. the relayer had no gas. */
export interface PendingBridge {
  userId?: string;
  burnTxHash: string;
  amountUsdc: string;
  recipient: string;
  createdAt: string;
  lastError?: string;
}

function file(): string {
  return path.join(path.dirname(resolveEventsFile()), "pending-bridges.json");
}

export function listPending(): PendingBridge[] {
  const f = file();
  if (!existsSync(f)) return [];
  try {
    return JSON.parse(readFileSync(f, "utf8")) as PendingBridge[];
  } catch {
    return [];
  }
}

function save(list: PendingBridge[]): void {
  const f = file();
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(list, null, 2));
}

export function savePending(p: PendingBridge): void {
  const list = listPending().filter((x) => x.burnTxHash !== p.burnTxHash);
  list.push(p);
  save(list);
  log.warn({ burnTxHash: p.burnTxHash, amountUsdc: p.amountUsdc }, "bridge left pending; run `pnpm bridge:resume` once gas is available");
}

export function removePending(burnTxHash: string): void {
  save(listPending().filter((x) => x.burnTxHash !== burnTxHash));
}

export interface ResumeResult {
  burnTxHash: string;
  amountUsdc: string;
  recipient: string;
  mintTxHash?: string;
  mintExplorerUrl?: string;
  error?: string;
}

/** Re-fetches the attestation for every pending burn and completes the mint with the given relayer wallet. */
export async function resumePendingBridges(relayer: (p: PendingBridge) => Promise<EvmWalletRef>, onProgress?: (m: string) => void): Promise<ResumeResult[]> {
  const results: ResumeResult[] = [];
  for (const p of listPending()) {
    onProgress?.(`resuming burn ${p.burnTxHash} (${p.amountUsdc} USDC → ${p.recipient})`);
    try {
      const wallet = await relayer(p);
      const att = await waitForAttestation(p.burnTxHash, { timeoutMs: 120_000, onPoll: (s) => onProgress?.(`iris: ${s}`) });
      const mint = await receiveOnBase({ message: att.message, attestation: att.attestation, wallet });
      const baseUsdcAfter = await getBaseUsdcBalance(p.recipient);
      events.emit({ type: "bridge.minted", userId: p.userId, amountUsdc: p.amountUsdc, network: BASE_SEPOLIA_CAIP2, txHash: mint.txHash, explorerUrl: mint.explorerUrl, detail: { recipient: p.recipient, baseUsdcAfter, resumed: true, burnTxHash: p.burnTxHash } });
      removePending(p.burnTxHash);
      results.push({ burnTxHash: p.burnTxHash, amountUsdc: p.amountUsdc, recipient: p.recipient, mintTxHash: mint.txHash, mintExplorerUrl: mint.explorerUrl });
    } catch (err) {
      const msg = (err as Error).message;
      savePending({ ...p, lastError: msg.slice(0, 300) });
      results.push({ burnTxHash: p.burnTxHash, amountUsdc: p.amountUsdc, recipient: p.recipient, error: msg });
    }
  }
  return results;
}
