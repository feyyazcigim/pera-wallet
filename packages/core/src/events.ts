import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveEventsFile } from "./config";
import { addUsdc } from "./amount";
import { logger } from "./logger";
import type { Caip2Network } from "./constants";

export type EventType =
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
  amountUsdc?: string;
  network?: Caip2Network;
  txHash?: string;
  explorerUrl?: string;
  detail?: Record<string, unknown>;
}

export type EventInput = Omit<WalletEvent, "id" | "ts">;
type Listener = (e: WalletEvent) => void;

/**
 * In-memory ring buffer + append-only JSONL file. Every mutation in the system emits exactly
 * one event here; the API's `/events` and SSE stream are fed from this bus.
 */
export class EventBus {
  private ring: WalletEvent[] = [];
  private listeners = new Set<Listener>();
  private initialised = false;
  private file?: string;

  constructor(
    private readonly opts: { file?: string; ringSize?: number } = {},
  ) {}

  private ensureInit(): void {
    if (this.initialised) return;
    this.initialised = true;
    this.file = this.opts.file ?? resolveEventsFile();
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      if (existsSync(this.file)) {
        const lines = readFileSync(this.file, "utf8").split("\n").filter(Boolean);
        const size = this.opts.ringSize ?? 2000;
        for (const line of lines.slice(-size)) {
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
    if (this.file) {
      try {
        appendFileSync(this.file, `${JSON.stringify(event)}\n`);
      } catch (err) {
        logger.warn({ err }, "failed to append event");
      }
    }
    logger.info({ event: event.type, amountUsdc: event.amountUsdc, txHash: event.txHash }, "event");
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        logger.warn({ err }, "event listener threw");
      }
    }
    return event;
  }

  /** Newest first. */
  recent(limit = 200): WalletEvent[] {
    this.ensureInit();
    return this.ring.slice(-limit).reverse();
  }

  subscribe(fn: Listener): () => void {
    this.ensureInit();
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Decimal USDC sum of `amountUsdc` over events of `type` newer than `sinceMs` epoch. */
  sumSince(type: EventType, sinceMs: number): string {
    this.ensureInit();
    let total = "0";
    for (const e of this.ring) {
      if (e.type === type && e.amountUsdc && Date.parse(e.ts) >= sinceMs) total = addUsdc(total, e.amountUsdc);
    }
    return total;
  }
}

export const events = new EventBus();
