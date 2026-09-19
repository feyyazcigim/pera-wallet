import type { FastifyInstance } from "fastify";
import { listEvents } from "@pera/db";
import { requireScope } from "../auth";
import { streamEvents } from "../sse";

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  app.get("/events", async (req) => {
    const user = requireScope(req, "read");
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 200) || 200, 1000);
    return listEvents({ userId: user.id, limit });
  });
  app.get("/events/stream", (req, reply) => streamEvents(req, reply, requireScope(req, "read").id));

  // Admin-wide views for the operator dashboard.
  app.get("/admin/events", async (req) => {
    if (!req.isAdmin) throw Object.assign(new Error("admin token required"), { statusCode: 403 });
    const limit = Math.min(Number((req.query as { limit?: string }).limit ?? 200) || 200, 1000);
    return listEvents({ limit });
  });
  app.get("/admin/events/stream", (req, reply) => {
    if (!req.isAdmin) throw Object.assign(new Error("admin token required"), { statusCode: 403 });
    return streamEvents(req, reply);
  });
}
