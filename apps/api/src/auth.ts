import type { FastifyInstance, FastifyRequest } from "fastify";
import { loadEnv } from "@pera/core";
import { getSessionUser, type User } from "@pera/db";

const PUBLIC_PREFIXES = ["/auth/", "/status", "/health", "/openapi.yaml"];

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
    isAdmin?: boolean;
  }
}

/**
 * Two credentials: a per-user session token (`ps_…`, from passkey login) and the static admin bearer
 * (`API_BEARER_TOKEN`) for operations/dashboard-wide views. `/events/stream` also accepts `?token=`.
 */
export function registerAuth(app: FastifyInstance): void {
  const env = loadEnv();
  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "OPTIONS") return;
    const path = req.url.split("?")[0] ?? "";
    if (path === "/" || PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p))) return;
    const header = req.headers.authorization;
    const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    const query = (req.query as Record<string, string | undefined>)?.token;
    const token = bearer ?? (path.endsWith("/stream") ? query : undefined);
    if (!token) return reply.status(401).send({ error: "unauthorized", code: "UNAUTHORIZED" });
    if (token === env.API_BEARER_TOKEN) {
      req.isAdmin = true;
      if (path.startsWith("/admin")) return;
    }
    if (token.startsWith("ps_")) {
      const user = await getSessionUser(token);
      if (!user) return reply.status(401).send({ error: "session expired or invalid", code: "UNAUTHORIZED" });
      req.user = user;
      return;
    }
    if (req.isAdmin) return; // admin may call user routes only when they carry ?userId= (handled per route)
    return reply.status(401).send({ error: "unauthorized", code: "UNAUTHORIZED" });
  });
}

export function requireUser(req: FastifyRequest): User {
  if (req.user) return req.user;
  throw Object.assign(new Error("a user session is required"), { statusCode: 401, code: "UNAUTHORIZED" });
}
