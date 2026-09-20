import type { FastifyInstance, FastifyRequest } from "fastify";
import { loadEnv } from "@pera/core";
import { getAgentTokenUser, getSessionUser, ALL_SCOPES, type AgentScope, type User } from "@pera/db";

// "/bank/" is the sandbox bank rail: like a real wire, anyone who knows the IBAN + reference can pay in.
const PUBLIC_PREFIXES = ["/auth/", "/bank/", "/status", "/health", "/openapi.yaml"];

declare module "fastify" {
  interface FastifyRequest {
    user?: User;
    isAdmin?: boolean;
    /** Scopes of the presented credential. Passkey sessions hold every scope plus owner-only routes. */
    scopes?: AgentScope[];
    /** True for passkey sessions (`ps_…`); false for agent tokens (`pat_…`). */
    isOwnerSession?: boolean;
    agentTokenId?: string;
  }
}

/**
 * Three credentials:
 *  - `ps_…` passkey session (owner: everything),
 *  - `pat_…` scoped agent token (AI agents / CLI: `read`, `pay`, `fund`, `admin`),
 *  - the static admin bearer (`API_BEARER_TOKEN`) for `/admin/*`.
 * `/events/stream` (and `/mcp` GET) also accept `?token=` for clients that cannot set headers.
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
    const token = bearer ?? (path.endsWith("/stream") || path === "/mcp" ? query : undefined);
    if (!token) return reply.status(401).send({ error: "unauthorized", code: "UNAUTHORIZED" });
    if (token === env.API_BEARER_TOKEN) {
      req.isAdmin = true;
      if (path.startsWith("/admin")) return;
    }
    if (token.startsWith("ps_")) {
      const user = await getSessionUser(token);
      if (!user) return reply.status(401).send({ error: "session expired or invalid", code: "UNAUTHORIZED" });
      req.user = user;
      req.scopes = [...ALL_SCOPES];
      req.isOwnerSession = true;
      return;
    }
    if (token.startsWith("pat_")) {
      const found = await getAgentTokenUser(token);
      if (!found) return reply.status(401).send({ error: "agent token unknown, revoked or expired", code: "UNAUTHORIZED" });
      req.user = found.user;
      req.scopes = found.token.scopes;
      req.isOwnerSession = false;
      req.agentTokenId = found.token.id;
      return;
    }
    if (req.isAdmin) return;
    return reply.status(401).send({ error: "unauthorized", code: "UNAUTHORIZED" });
  });
}

export function requireUser(req: FastifyRequest): User {
  if (req.user) return req.user;
  throw Object.assign(new Error("a user session or agent token is required"), { statusCode: 401, code: "UNAUTHORIZED" });
}

/** Agent tokens must carry the scope; passkey sessions always pass. */
export function requireScope(req: FastifyRequest, scope: AgentScope): User {
  const user = requireUser(req);
  if (req.isOwnerSession) return user;
  if (!req.scopes?.includes(scope)) {
    throw Object.assign(new Error(`this agent token lacks the "${scope}" scope`), { statusCode: 403, code: "INSUFFICIENT_SCOPE", scope });
  }
  return user;
}

/** Owner-only actions (rules, approvals, tokens, off-ramp, EVM transfers) need the passkey session itself. */
export function requireOwner(req: FastifyRequest): User {
  const user = requireUser(req);
  if (!req.isOwnerSession) throw Object.assign(new Error("this action requires the owner's passkey session, not an agent token"), { statusCode: 403, code: "OWNER_ONLY" });
  return user;
}
