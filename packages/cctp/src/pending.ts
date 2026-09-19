import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BASE_SEPOLIA_CAIP2, childLogger, events, resolveEventsFile } from "@pera/core";
import { getBaseUsdcBalance, receiveOnBase } from "./evm";
import { waitForAttestation } from "./iris";

const log = childLogger("cctp.pending");

/** A burn that was attested (or is being attested) but not yet minted on Base — e.g. the EVM sponsor ran out of gas. */
export interface PendingBridge {
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
  log.warn({ burnTxHash: p.burnTxHash, amountUsdc: p.amountUsdc }, "bridge left pending; run `pnpm bridge:resume` once the EVM sponsor has Base Sepolia ETH");
}

export function removePending(burnTxHash: string): void {
  save(listPending().filter((x) => x.burnTxHash !== burnTxHash));
}

export interface ResumeResult {
  burnTxHash: string;
  amountUsdc: string;
  mintTxHash?: string;
  mintExplorerUrl?: string;
  error?: string;
}

/** Re-fetches the attestation for every pending burn and completes the mint on Base Sepolia. */
export async function resumePendingBridges(onProgress?: (m: string) => void): Promise<ResumeResult[]> {
  const results: ResumeResult[] = [];
  for (const p of listPending()) {
    onProgress?.(`resuming burn ${p.burnTxHash} (${p.amountUsdc} USDC)`);
    try {
      const att = await waitForAttestation(p.burnTxHash, { timeoutMs: 120_000, onPoll: (s) => onProgress?.(`iris: ${s}`) });
      const mint = await receiveOnBase({ message: att.message, attestation: att.attestation });
      const baseUsdcAfter = await getBaseUsdcBalance();
      events.emit({ type: "bridge.minted", amountUsdc: p.amountUsdc, network: BASE_SEPOLIA_CAIP2, txHash: mint.txHash, explorerUrl: mint.explorerUrl, detail: { recipient: p.recipient, baseUsdcAfter, resumed: true, burnTxHash: p.burnTxHash } });
      removePending(p.burnTxHash);
      results.push({ burnTxHash: p.burnTxHash, amountUsdc: p.amountUsdc, mintTxHash: mint.txHash, mintExplorerUrl: mint.explorerUrl });
    } catch (err) {
      const msg = (err as Error).message;
      savePending({ ...p, lastError: msg.slice(0, 300) });
      results.push({ burnTxHash: p.burnTxHash, amountUsdc: p.amountUsdc, error: msg });
    }
  }
  return results;
}
