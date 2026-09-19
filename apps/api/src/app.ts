import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { events, loadEnv, repoRoot } from "@pera/core";
import { insertEvent, migrate } from "@pera/db";
import { registerAuth } from "./auth";
import { registerErrorHandler } from "./errors";
import { agentRoutes } from "./routes/agent";
import { approvalRoutes } from "./routes/approvals";
import { tokenRoutes } from "./routes/tokens";
import { mcpRoutes } from "./mcp/route";
import { anchorRoutes } from "./routes/anchor";
import { authRoutes } from "./routes/auth";
import { eventRoutes } from "./routes/events";
import { meRoutes } from "./routes/me";
import { statusRoutes } from "./routes/status";
import { yieldRoutes } from "./routes/yield";

export async function buildApp(): Promise<FastifyInstance> {
  loadEnv();
  await migrate();
  events.setSink((e) => insertEvent({ id: e.id, userId: e.userId ?? null, ts: e.ts, type: e.type, amountUsdc: e.amountUsdc, network: e.network, txHash: e.txHash, explorerUrl: e.explorerUrl, detail: e.detail }));

  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info", base: undefined }, disableRequestLogging: true, bodyLimit: 256 * 1024 });
  await app.register(cors, { origin: true, credentials: true, exposedHeaders: ["*"], methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"] }); // PUT: /agent/rules, DELETE: /agent/tokens/:id and MCP session teardown
  registerAuth(app);
  registerErrorHandler(app);

  app.get("/", async () => ({
    service: "pera-api",
    docs: "/openapi.yaml",
    auth: "passkey: POST /auth/register, POST /auth/login/options, POST /auth/login/verify; agents: scoped pat_ tokens from POST /agent/tokens",
    mcp: { url: "/mcp", transport: "streamable-http", auth: "Authorization: Bearer pat_…", tools: ["wallet_info", "get_balances", "get_spending_policy", "list_services", "quote_payment", "pay_url", "list_payments", "request_funding"] },
    routes: ["/status", "/me", "/cli/token", "/balances", "/onramp", "/onramp/instructions", "/bank/transfer", "/onramp/:id", "/offramp", "/yield/deposit", "/yield/withdraw", "/yield/position", "/agent/policy", "/agent/authorize/build", "/agent/authorize", "/agent/policy/build", "/agent/rules", "/agent/quote", "/agent/services", "/agent/tokens", "/agent/connect/hermes", "/approvals", "/stellar/submit", "/agent/pay", "/agent/pay/over-cap-demo", "/evm/transfer", "/events", "/events/stream", "/admin/events"],
  }));
  app.get("/openapi.yaml", async (_req, reply) => {
    const file = path.join(repoRoot(), "openapi.yaml");
    if (!existsSync(file)) return reply.status(404).send({ error: "openapi.yaml not generated (pnpm gen:openapi)" });
    return reply.type("application/yaml").send(readFileSync(file, "utf8"));
  });

  await app.register(statusRoutes);
  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(anchorRoutes);
  await app.register(yieldRoutes);
  await app.register(agentRoutes);
  await app.register(tokenRoutes);
  await app.register(approvalRoutes);
  await app.register(eventRoutes);
  await app.register(mcpRoutes);
  return app;
}
