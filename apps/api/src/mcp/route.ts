import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { childLogger, loadEnv } from "@pera/core";
import { requireUser } from "../auth";
import { buildMcpServer } from "./server";

const log = childLogger("api.mcp");

/**
 * Remote MCP endpoint (Streamable HTTP, stateless: every POST carries the bearer and gets its own server
 * instance bound to that user and token scopes). Works with Hermes (`mcp_servers.<name>.url`), Claude Code,
 * Cursor, etc. GET/DELETE (session streams) are not offered in stateless mode → 405.
 */
export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  const env = loadEnv();
  const allowedOrigins = new Set(env.PASSKEY_ORIGINS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));

  const originAllowed = (origin: string | undefined): boolean => {
    if (!origin) return true; // non-browser agents (Hermes, the shim, curl) send no Origin
    const o = origin.toLowerCase();
    return allowedOrigins.has(o) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
  };

  app.post("/mcp", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!originAllowed(req.headers.origin)) return reply.status(403).send({ error: `origin ${req.headers.origin} not allowed`, code: "ORIGIN_FORBIDDEN" });
    const user = requireUser(req);
    const server = buildMcpServer({ user, scopes: req.scopes ?? [], isOwnerSession: Boolean(req.isOwnerSession), tokenId: req.agentTokenId });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.once("close", () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (err) {
      log.error({ err }, "mcp request failed");
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "content-type": "application/json" });
        reply.raw.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "internal error" }, id: null }));
      } else reply.raw.end();
    }
  });

  const notAllowed = async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.status(405).header("allow", "POST").send({ jsonrpc: "2.0", error: { code: -32000, message: "stateless MCP endpoint: use POST" }, id: null });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
