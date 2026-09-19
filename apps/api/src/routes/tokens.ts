import type { FastifyInstance } from "fastify";
import { createAgentToken, listAgentTokens, revokeAgentToken } from "@pera/db";
import { requireOwner } from "../auth";
import { CreateTokenBody } from "../schemas";

/**
 * Scoped, revocable agent tokens (`pat_…`) for external AI runtimes (Hermes, Claude, Cursor, the CLI).
 * Owner-only: minted from the passkey session, shown once, stored hashed.
 */
export async function tokenRoutes(app: FastifyInstance): Promise<void> {
  app.post("/agent/tokens", async (req, reply) => {
    const user = requireOwner(req);
    const body = CreateTokenBody.parse(req.body ?? {});
    const { token, secret } = await createAgentToken({ userId: user.id, name: body.name, scopes: body.scopes, ttlDays: body.ttlDays ?? 90 });
    return reply.status(201).send({ id: token.id, name: token.name, scopes: token.scopes, expiresAt: token.expiresAt, token: secret });
  });
  app.get("/agent/tokens", async (req) => listAgentTokens(requireOwner(req).id));
  app.delete("/agent/tokens/:id", async (req, reply) => {
    const user = requireOwner(req);
    const ok = await revokeAgentToken(user.id, (req.params as { id: string }).id);
    if (!ok) return reply.status(404).send({ error: "token not found or already revoked", code: "NOT_FOUND" });
    return { ok: true };
  });
}
