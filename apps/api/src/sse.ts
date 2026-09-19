import type { FastifyReply, FastifyRequest } from "fastify";
import { events, type WalletEvent } from "@pera/core";
import { listEvents } from "@pera/db";

/** Server-Sent Events feed (per user, or global for admins): backlog of the last 20, then live. */
export async function streamEvents(req: FastifyRequest, reply: FastifyReply, userId?: string): Promise<void> {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": (req.headers.origin as string | undefined) ?? "*",
    "Access-Control-Allow-Credentials": "true",
  });
  res.write("retry: 3000\n\n");
  const send = (e: object) => res.write(`id: ${(e as WalletEvent).id}\nevent: ${(e as WalletEvent).type}\ndata: ${JSON.stringify(e)}\n\n`);
  try {
    const backlog = await listEvents({ userId: userId ?? null, limit: 20 });
    for (const e of backlog.reverse()) send(e);
  } catch {
    for (const e of events.recent(20, userId).reverse()) send(e);
  }
  const unsubscribe = events.subscribe(send, userId);
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  req.raw.on("close", () => {
    clearInterval(ping);
    unsubscribe();
  });
}
