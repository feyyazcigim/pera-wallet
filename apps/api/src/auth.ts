import type { FastifyInstance } from "fastify";
import { loadEnv } from "@pera/core";

const PUBLIC = new Set(["/status", "/health", "/openapi.yaml", "/"]);

/** Single static bearer token. `/events/stream` also accepts `?token=` because EventSource cannot set headers. */
export function registerAuth(app: FastifyInstance): void {
  const env = loadEnv();
  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "OPTIONS") return;
    const path = req.url.split("?")[0] ?? "";
    if (PUBLIC.has(path)) return;
    const header = req.headers.authorization;
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const query = (req.query as Record<string, string | undefined>)?.token;
    const token = bearer ?? (path === "/events/stream" ? query : undefined);
    if (token !== env.API_BEARER_TOKEN) {
      reply.status(401).send({ error: "unauthorized", code: "UNAUTHORIZED" });
    }
  });
}
