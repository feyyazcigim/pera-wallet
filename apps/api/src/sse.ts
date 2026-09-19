import type { FastifyReply, FastifyRequest } from "fastify";
import { events, type WalletEvent } from "@pera/core";

/** Server-Sent Events feed of the wallet event bus (backlog of the last 20, then live). */
export function streamEvents(req: FastifyRequest, reply: FastifyReply): void {
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
  const send = (e: WalletEvent) => res.write(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
  for (const e of events.recent(20).reverse()) send(e);
  const unsubscribe = events.subscribe(send);
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  req.raw.on("close", () => {
    clearInterval(ping);
    unsubscribe();
  });
}
