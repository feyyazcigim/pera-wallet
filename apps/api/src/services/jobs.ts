import { randomUUID } from "node:crypto";
import { childLogger, events, type WalletEvent } from "@pera/core";
import type { PayResult } from "@pera/x402-router";

const log = childLogger("api.jobs");

/**
 * Background payment jobs. A Base payment bridges USDC via CCTP first (burn → attestation → mint, 1–3 min), longer
 * than any HTTP hop in front of the API tolerates (Cloudflare cuts origins at 100 s; MCP clients have their own tool
 * timeouts). So a payment runs here, callers wait inline for a bounded time and then poll `waitForPayJob`.
 * In-memory: one API process; jobs are forgotten an hour after they finish.
 */
export interface PayJob {
  id: string;
  userId: string;
  url: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  finishedAt?: string;
  result?: PayResult;
  error?: unknown;
  /** wallet events emitted for this user while the job ran (bridge.burned, bridge.attested, x402.paid, …) */
  steps: string[];
}

type Entry = PayJob & { done: Promise<void> };
const jobs = new Map<string, Entry>();
const TTL_MS = 60 * 60_000;
const stepLabel = (e: WalletEvent) => `${e.type}${e.amountUsdc ? ` ${e.amountUsdc} USDC` : ""}${e.txHash ? ` (${e.txHash.slice(0, 8)}…)` : ""}`;

export function startPayJob(userId: string, url: string, run: () => Promise<PayResult>): PayJob {
  const id = `job_${randomUUID()}`;
  const job: Entry = { id, userId, url, status: "running", startedAt: new Date().toISOString(), steps: [], done: Promise.resolve() };
  const unsub = events.subscribe((e) => job.steps.push(stepLabel(e)), userId);
  job.done = run()
    .then(
      (r) => {
        job.status = "done";
        job.result = r;
      },
      (err: unknown) => {
        job.status = "failed";
        job.error = err;
        log.warn({ jobId: id, userId, url, err: (err as Error).message }, "payment job failed");
      },
    )
    .finally(() => {
      job.finishedAt = new Date().toISOString();
      unsub();
      setTimeout(() => jobs.delete(id), TTL_MS).unref();
    });
  jobs.set(id, job);
  return job;
}

export function getPayJob(id: string, userId: string): PayJob | null {
  const job = jobs.get(id);
  return job && job.userId === userId ? job : null;
}

/** Resolves when the job finishes or after `ms`, whichever comes first (the job keeps running). */
export async function waitForPayJob(id: string, userId: string, ms: number): Promise<PayJob | null> {
  const job = jobs.get(id);
  if (!job || job.userId !== userId) return null;
  if (job.status === "running" && ms > 0) await Promise.race([job.done, new Promise((r) => setTimeout(r, ms))]);
  return job;
}

/** JSON view without the raw error object. */
export function jobView(job: PayJob) {
  const err = job.error as (Error & { code?: string }) | undefined;
  return { jobId: job.id, status: job.status === "done" ? "paid" : job.status, url: job.url, startedAt: job.startedAt, finishedAt: job.finishedAt ?? null, steps: job.steps, result: job.result ?? null, error: err ? { code: err.code ?? "ERROR", message: err.message } : null };
}
