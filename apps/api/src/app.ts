import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { loadEnv, repoRoot } from "@pera/core";
import { registerAuth } from "./auth";
import { registerErrorHandler } from "./errors";
import { agentRoutes } from "./routes/agent";
import { anchorRoutes } from "./routes/anchor";
import { eventRoutes } from "./routes/events";
import { statusRoutes } from "./routes/status";
import { yieldRoutes } from "./routes/yield";

export async function buildApp(): Promise<FastifyInstance> {
  loadEnv();
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info", base: undefined }, disableRequestLogging: true, bodyLimit: 64 * 1024 });
  await app.register(cors, { origin: true, credentials: true, exposedHeaders: ["*"] });
  registerAuth(app);
  registerErrorHandler(app);

  app.get("/", async () => ({
    service: "pera-api",
    docs: "/openapi.yaml",
    routes: ["/status", "/balances", "/onramp", "/onramp/:id", "/offramp", "/yield/deposit", "/yield/withdraw", "/yield/position", "/agent/policy", "/agent/pay", "/agent/pay/over-cap-demo", "/events", "/events/stream"],
  }));
  app.get("/openapi.yaml", async (_req, reply) => {
    const file = path.join(repoRoot(), "openapi.yaml");
    if (!existsSync(file)) return reply.status(404).send({ error: "openapi.yaml not generated (pnpm gen:openapi)" });
    return reply.type("application/yaml").send(readFileSync(file, "utf8"));
  });

  await app.register(statusRoutes);
  await app.register(anchorRoutes);
  await app.register(yieldRoutes);
  await app.register(agentRoutes);
  await app.register(eventRoutes);
  return app;
}
