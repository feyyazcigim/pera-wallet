import type { FastifyInstance } from "fastify";
import { events } from "@pera/core";
import { streamEvents } from "../sse";

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get("/events", async (req) => {
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 200) || 200, 1000);
    return events.recent(limit);
  });
  app.get("/events/stream", (req, reply) => streamEvents(req, reply));
}
