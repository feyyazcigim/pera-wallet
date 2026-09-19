import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveEventsFile } from "./config";
import { addUsdc } from "./amount";
import { logger } from "./logger";
import type { Caip2Network } from "./constants";

export type EventType =
  | "user.registered"
  | "wallet.provisioned"
  | "agent.authorized"
  | "onramp.started"
  | "onramp.completed"
  | "yield.deposited"
  | "yield.withdrawn"
  | "float.topup"
  | "float.topup.rejected"
  | "x402.402"
  | "x402.paid"
  | "bridge.burned"
  | "bridge.attested"
  | "bridge.minted"
  | "offramp.completed";

export interface WalletEvent {
  id: string;
  ts: string;
  type: EventType;
  userId?: string;
  amountUsdc?: string;
  network?: Caip2Network;
  txHash?: string;
  explorerUrl?: string;
  detail?: Record<string, unknown>;
}

export type EventInput = Omit<WalletEvent, "id" | "ts">;
type Listener = (e: WalletEvent) => void;
export type EventSink = (e: WalletEvent) => Promise<void> | void;

/**
 * Process-wide event bus: in-memory ring buffer for SSE fan-out + a persistence sink. The API
 * installs a database sink; without one, events are appended to a JSONL file.
 */
export class EventBus {
  private ring: WalletEvent[] = [];
  private listeners = new Set<Listener>();
  private sink?: EventSink;
  private initialised = false;
  private file?: string;

  constructor(private readonly opts: { file?: string; ringSize?: number } = {}) {}

  /** Replace the JSONL fallback with a custom persistence sink (e.g. Postgres). */
  setSink(sink: EventSink): void {
    this.sink = sink;
  }

  private ensureInit(): void {
    if (this.initialised) return;
    this.initialised = true;
    if (this.sink) return;
    this.file = this.opts.file ?? resolveEventsFile();
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      if (existsSync(this.file)) {
        const size = this.opts.ringSize ?? 2000;
        for (const line of readFileSync(this.file, "utf8").split("\n").filter(Boolean).slice(-size)) {
          try {
            this.ring.push(JSON.parse(line) as WalletEvent);
          } catch {
            /* skip corrupt line */
          }
        }
      }
    } catch (err) {
      logger.warn({ err, file: this.file }, "event store unavailable; running in memory only");
      this.file = undefined;
    }
  }

  emit(input: EventInput): WalletEvent {
    this.ensureInit();
    const event: WalletEvent = { id: randomUUID(), ts: new Date().toISOString(), ...input };
    this.ring.push(event);
    const size = this.opts.ringSize ?? 2000;
    if (this.ring.length > size) this.ring.splice(0, this.ring.length - size);
    if (this.sink) {
      Promise.resolve(this.sink(event)).catch((err) => logger.warn({ err }, "event sink failed"));
    } else if (this.file) {
      try {
        appendFileSync(this.file, `${JSON.stringify(event)}\n`);
      } catch (err) {
        logger.warn({ err }, "failed to append event");
      }
    }
    logger.info({ event: event.type, userId: event.userId, amountUsdc: event.amountUsdc, txHash: event.txHash }, "event");
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        logger.warn({ err }, "event listener threw");
      }
    }
    return event;
  }

  /** Newest first, optionally filtered by user (from the in-memory ring). */
  recent(limit = 200, userId?: string): WalletEvent[] {
    this.ensureInit();
    const src = userId ? this.ring.filter((e) => e.userId === userId) : this.ring;
    return src.slice(-limit).reverse();
  }

  subscribe(fn: Listener, userId?: string): () => void {
    this.ensureInit();
    const wrapped: Listener = userId ? (e) => { if (e.userId === userId) fn(e); } : fn;
    this.listeners.add(wrapped);
    return () => this.listeners.delete(wrapped);
  }

  sumSince(type: EventType, sinceMs: number, userId?: string): string {
    this.ensureInit();
    let total = "0";
    for (const e of this.ring) {
      if (e.type === type && e.amountUsdc && Date.parse(e.ts) >= sinceMs && (!userId || e.userId === userId)) total = addUsdc(total, e.amountUsdc);
    }
    return total;
  }
}

export const events = new EventBus();
