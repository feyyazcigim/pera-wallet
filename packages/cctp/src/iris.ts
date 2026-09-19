import { CCTP, childLogger } from "@pera/core";

const log = childLogger("cctp.iris");

export interface Attestation {
  message: `0x${string}`;
  attestation: `0x${string}`;
  eventNonce?: string;
  status: string;
}

/** Polls Circle's Iris sandbox until the burn message is attested (404 while pending). */
export async function waitForAttestation(stellarTxHash: string, o: { intervalMs?: number; timeoutMs?: number; onPoll?: (status: string) => void } = {}): Promise<Attestation> {
  const url = `${CCTP.irisUrl}/v2/messages/${CCTP.stellarDomain}?transactionHash=${encodeURIComponent(stellarTxHash)}`;
  const started = Date.now();
  const timeout = o.timeoutMs ?? 240_000;
  const interval = o.intervalMs ?? 5_000;
  for (;;) {
    let status = "pending";
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const data = (await res.json()) as { messages?: Array<{ status: string; message: string; attestation: string; eventNonce?: string }> };
        const m = data.messages?.[0];
        if (m) {
          status = m.status;
          if (m.status === "complete" && m.attestation && m.attestation !== "PENDING") {
            log.info({ nonce: m.eventNonce, ms: Date.now() - started }, "attestation complete");
            return { message: m.message as `0x${string}`, attestation: m.attestation as `0x${string}`, eventNonce: m.eventNonce, status: m.status };
          }
        }
      } else if (res.status !== 404) {
        status = `http ${res.status}`;
      }
    } catch (err) {
      status = `error ${(err as Error).message}`;
    }
    o.onPoll?.(status);
    if (Date.now() - started > timeout) throw new Error(`timeout waiting for Iris attestation of ${stellarTxHash} (last: ${status})`);
    await new Promise((r) => setTimeout(r, interval));
  }
}
